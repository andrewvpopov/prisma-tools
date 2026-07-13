const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse } = require('dotenv');

const DEFAULT_CONFIG = {
  envFiles: {
    base: '.env',
    dev: '.env.local',
    prod: '.env.production',
  },
  sqliteSchema: 'prisma/schema.prisma',
  postgresSchema: 'prisma/postgres/schema.prisma',
  sqliteMigrations: 'prisma/migrations',
  postgresMigrations: 'prisma/postgres/migrations',
  defaultSqlitePath: 'prisma/dev.db',
  envKeys: {
    mode: ['PRISMA_TOOLS_ENV', 'PRISMA_ENV'],
    provider: ['PRISMA_TOOLS_DATABASE_PROVIDER', 'DATABASE_PROVIDER'],
  },
  outputEnv: {
    mode: 'PRISMA_TOOLS_ENV',
    provider: 'PRISMA_TOOLS_DATABASE_PROVIDER',
  },
};

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    envFiles: {
      ...DEFAULT_CONFIG.envFiles,
      ...(config.envFiles || {}),
    },
    envKeys: {
      mode: config.envKeys?.mode || DEFAULT_CONFIG.envKeys.mode,
      provider: config.envKeys?.provider || DEFAULT_CONFIG.envKeys.provider,
    },
    outputEnv: {
      ...DEFAULT_CONFIG.outputEnv,
      ...(config.outputEnv || {}),
    },
  };
}

function loadEnvFile(filePath, { env, originalEnvKeys, override = false, fsImpl = fs } = {}) {
  if (!fsImpl.existsSync(filePath)) {
    return false;
  }

  const parsed = parse(fsImpl.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (originalEnvKeys.has(key)) {
      continue;
    }

    if (override || env[key] === undefined) {
      env[key] = value;
    }
  }

  return true;
}

function parseArgs(argv = []) {
  const options = {
    mode: null,
    quiet: false,
    prismaArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--prod' || arg === '--production') {
      options.mode = 'prod';
      continue;
    }

    if (arg === '--dev' || arg === '--development') {
      options.mode = 'dev';
      continue;
    }

    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }

    options.prismaArgs = argv.slice(index);
    break;
  }

  if (options.prismaArgs.length === 0) {
    options.prismaArgs = ['--help'];
  }

  return options;
}

function firstEnvValue(env, keys = []) {
  // Truthy fallback, matching `env.A || env.B`: a key that is defined but blank
  // ("") must fall through to the next key, not short-circuit. Consumers rely on
  // this to layer a primary var over a secondary (e.g. BEWKS_ENV over PRISMA_ENV).
  for (const key of keys) {
    const value = env[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}

function resolveMode(explicitMode, env = process.env, envKeys = DEFAULT_CONFIG.envKeys.mode) {
  if (explicitMode === 'prod' || explicitMode === 'production') {
    return 'prod';
  }
  if (explicitMode === 'dev' || explicitMode === 'development') {
    return 'dev';
  }
  if (explicitMode) {
    throw new Error(`Unsupported explicit Prisma mode "${explicitMode}". Expected dev, development, prod, or production.`);
  }

  const envMode = firstEnvValue(env, envKeys);
  if (envMode === 'prod' || envMode === 'production') {
    return 'prod';
  }
  if (envMode === 'dev' || envMode === 'development') {
    return 'dev';
  }
  if (envMode) {
    throw new Error(`Unsupported explicit Prisma mode "${envMode}". Expected dev, development, prod, or production.`);
  }

  return env.NODE_ENV === 'production' ? 'prod' : 'dev';
}

function providerFromUrl(databaseUrl, env = process.env, envKeys = DEFAULT_CONFIG.envKeys.provider) {
  // firstEnvValue already applies the truthy-fallback rule across envKeys, so a
  // blank ('') explicit provider falls through to the next key and, if every
  // key is blank/unset, explicitProvider is undefined here (URL detection
  // below). Only a SET-BUT-UNRECOGNIZED explicit value throws.
  const explicitProvider = firstEnvValue(env, envKeys);
  if (explicitProvider) {
    if (explicitProvider === 'sqlite' || explicitProvider === 'postgresql' || explicitProvider === 'postgres') {
      return explicitProvider === 'postgres' ? 'postgresql' : explicitProvider;
    }

    throw new Error(
      `Unsupported explicit database provider "${explicitProvider}". Expected sqlite, postgres, or postgresql.`,
    );
  }

  if (!databaseUrl || databaseUrl.startsWith('file:')) {
    return 'sqlite';
  }

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return 'postgresql';
  }

  throw new Error('Unsupported DATABASE_URL scheme. Expected file:, postgres://, or postgresql://.');
}

function resolvePrismaBin(cwd, fsImpl = fs, platform = process.platform) {
  const binName = platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const localBin = path.resolve(cwd, 'node_modules', '.bin', binName);
  if (fsImpl.existsSync(localBin)) {
    return { command: localBin, argsPrefix: [] };
  }

  return { command: platform === 'win32' ? 'npx.cmd' : 'npx', argsPrefix: ['prisma'] };
}

function defaultSqliteUrl(cwd, config = DEFAULT_CONFIG) {
  // Defensive: tolerate a partial config object (e.g. `{}`) instead of crashing
  // on `path.resolve(cwd, undefined)`.
  const defaultSqlitePath = (config && config.defaultSqlitePath) || DEFAULT_CONFIG.defaultSqlitePath;
  return `file:${path.resolve(cwd, defaultSqlitePath)}`;
}

// Internal helper shared by absoluteSqliteUrl and sqliteDatabasePath. Splits a
// `file:` URL's remainder on `?`, treating the first segment as the path and
// rejoining everything after it (including any further `?`) as the query, so a
// second `?` in the query string is preserved rather than dropped.
function parseSqliteFileUrl(databaseUrl) {
  const [rawPath, ...queryParts] = databaseUrl.slice('file:'.length).split('?');
  return {
    rawPath,
    query: queryParts.length > 0 ? queryParts.join('?') : undefined,
  };
}

function sqliteDatabasePath(databaseUrl, schemaPath) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) {
    return null;
  }

  const { rawPath } = parseSqliteFileUrl(databaseUrl);
  if (!rawPath || rawPath === ':memory:') {
    return null;
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(path.dirname(schemaPath), rawPath);
}

function ensureSqliteDatabaseFile(databaseUrl, schemaPath, fsImpl = fs) {
  const databasePath = sqliteDatabasePath(databaseUrl, schemaPath);
  if (!databasePath || fsImpl.existsSync(databasePath)) {
    return;
  }

  fsImpl.mkdirSync(path.dirname(databasePath), { recursive: true });
  fsImpl.closeSync(fsImpl.openSync(databasePath, 'a'));
}

function isNextBuildCommand(commandArgs) {
  if (commandArgs.length < 2) {
    return false;
  }

  const commandName = path.basename(commandArgs[0]);
  if (commandName === 'next' || commandName === 'next.cmd') {
    return commandArgs[1] === 'build';
  }

  return (
    (commandName === 'npx' || commandName === 'npx.cmd') &&
    commandArgs[1] === 'next' &&
    commandArgs[2] === 'build'
  );
}

function hasSchemaArg(prismaArgs) {
  return prismaArgs.some((arg, index) => arg === '--schema' || arg.startsWith('--schema=') || prismaArgs[index - 1] === '--schema');
}

function shouldAppendSchemaArg(prismaArgs) {
  const [command, subcommand] = prismaArgs;
  if (!command || command.startsWith('-') || hasSchemaArg(prismaArgs)) {
    return false;
  }

  if (command === 'generate' || command === 'validate' || command === 'format' || command === 'studio') {
    return true;
  }

  if (command === 'migrate') {
    return ['deploy', 'dev', 'reset', 'resolve', 'status'].includes(subcommand);
  }

  if (command === 'db') {
    return ['pull', 'push'].includes(subcommand);
  }

  return false;
}

function appendSchemaArg(prismaArgs, schema) {
  if (!shouldAppendSchemaArg(prismaArgs)) {
    return prismaArgs;
  }

  return [...prismaArgs, '--schema', schema];
}

function absoluteSqliteUrl(databaseUrl, cwd) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const { rawPath, query } = parseSqliteFileUrl(databaseUrl);
  if (!rawPath || rawPath === ':memory:' || path.isAbsolute(rawPath)) {
    return databaseUrl;
  }

  const queryPart = query === undefined ? '' : `?${query}`;
  return `file:${path.resolve(cwd, rawPath)}${queryPart}`;
}

function buildExecEnv(commandArgs, cwd, env = process.env) {
  if (!isNextBuildCommand(commandArgs)) {
    return env;
  }

  return {
    ...env,
    DATABASE_URL: absoluteSqliteUrl(env.DATABASE_URL, cwd),
    NODE_ENV: 'production',
  };
}

function resolveContext({ argv = [], cwd = process.cwd(), env = process.env, config } = {}) {
  const resolvedConfig = mergeConfig(config);
  const options = parseArgs(argv);
  const originalEnvKeys = new Set(Object.keys(env));
  const mode = resolveMode(options.mode, env, resolvedConfig.envKeys.mode);
  const modeEnvFile = env.PRISMA_ENV_FILE || (mode === 'prod' ? resolvedConfig.envFiles.prod : resolvedConfig.envFiles.dev);

  loadEnvFile(path.resolve(cwd, resolvedConfig.envFiles.base), { env, originalEnvKeys });
  loadEnvFile(path.resolve(cwd, modeEnvFile), { env, originalEnvKeys, override: true });

  const commandWithoutConnection = new Set(['format', 'generate', 'validate']);
  if (!env.DATABASE_URL && (commandWithoutConnection.has(options.prismaArgs[0]) || options.prismaArgs[0] === 'exec')) {
    env.DATABASE_URL = defaultSqliteUrl(cwd, resolvedConfig);
  }

  const provider = providerFromUrl(env.DATABASE_URL, env, resolvedConfig.envKeys.provider);
  const schema = provider === 'postgresql' ? resolvedConfig.postgresSchema : resolvedConfig.sqliteSchema;
  const migrations = provider === 'postgresql' ? resolvedConfig.postgresMigrations : resolvedConfig.sqliteMigrations;

  if (resolvedConfig.outputEnv.mode) {
    env[resolvedConfig.outputEnv.mode] = mode;
  }
  if (resolvedConfig.outputEnv.provider) {
    env[resolvedConfig.outputEnv.provider] = provider;
  }

  return {
    mode,
    provider,
    schema,
    migrations,
    schemaPath: path.resolve(cwd, schema),
    databaseUrl: env.DATABASE_URL,
    options,
  };
}

// `next build` on a Pi is legitimately slow, so the default bound is generous.
// Tune with `runtime.commandTimeoutMs` or PRISMA_TOOLS_COMMAND_TIMEOUT_MS.
// No CLI flag: prisma-tools passes unrecognized args through to prisma, so a new
// flag could collide with a prisma option.
const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

function resolveCommandTimeoutMs(value, env = process.env) {
  const read = (raw, label) => {
    if (raw === undefined || raw === null || raw === '') {
      return null;
    }
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) {
      throw new Error(`${label} must be an integer >= 1 (milliseconds)`);
    }
    const parsed = Number.parseInt(text, 10);
    if (parsed < 1) {
      throw new Error(`${label} must be an integer >= 1 (milliseconds)`);
    }
    return parsed;
  };

  return (
    read(value, 'commandTimeoutMs') ??
    read(env.PRISMA_TOOLS_COMMAND_TIMEOUT_MS, 'PRISMA_TOOLS_COMMAND_TIMEOUT_MS') ??
    DEFAULT_COMMAND_TIMEOUT_MS
  );
}

// spawnSync reports a timeout as result.error with code ETIMEDOUT — rethrowing it
// raw gives the operator no idea which command hung or what the bound was.
function assertSpawnSucceeded(result, command, commandTimeoutMs) {
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(
        `\`${command}\` exceeded the ${commandTimeoutMs}ms command timeout and was killed. ` +
          `Raise it with PRISMA_TOOLS_COMMAND_TIMEOUT_MS if the command is legitimately slow.`
      );
    }
    throw result.error;
  }
}

function runCli(argv = process.argv.slice(2), runtime = {}) {
  const cwd = runtime.cwd || process.cwd();
  const env = runtime.env || process.env;
  const fsImpl = runtime.fs || fs;
  const stdout = runtime.stdout || process.stdout;

  // Bound every spawned command. A hung `prisma migrate deploy` or `next build`
  // would otherwise block a deploy forever — deploy-kit drives both from its
  // migrate/build hooks on the Pi. The bound is injected once, here, rather than
  // at each call site: a call site that forgets it is the failure being fixed.
  const commandTimeoutMs = resolveCommandTimeoutMs(runtime.commandTimeoutMs, env);
  const baseSpawn = runtime.spawnSync || spawnSync;
  const spawn = (command, args, options = {}) =>
    baseSpawn(command, args, { timeout: commandTimeoutMs, killSignal: 'SIGKILL', ...options });
  const context = resolveContext({ argv, cwd, env, config: runtime.config });
  const { options, provider, schema, migrations, schemaPath, mode } = context;

  const shouldEnsureSqliteDatabase =
    provider === 'sqlite' &&
    options.prismaArgs[0] === 'migrate' &&
    (options.prismaArgs[1] === 'deploy' || options.prismaArgs[1] === 'status');

  if (shouldEnsureSqliteDatabase) {
    ensureSqliteDatabaseFile(env.DATABASE_URL, schemaPath, fsImpl);
  }

  if (!options.quiet) {
    stdout.write(`[prisma-tools] mode=${mode} provider=${provider} schema=${schema} migrations=${migrations}\n`);
  }

  if (options.prismaArgs[0] === 'exec') {
    const commandArgs = options.prismaArgs.slice(1).filter((arg, index) => !(index === 0 && arg === '--'));
    if (commandArgs.length === 0) {
      throw new Error('exec requires a command to run.');
    }

    const result = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd,
      stdio: 'inherit',
      env: buildExecEnv(commandArgs, cwd, env),
    });

    assertSpawnSucceeded(result, commandArgs.join(' '), commandTimeoutMs);

    return result.status ?? 1;
  }

  const prisma = resolvePrismaBin(cwd, fsImpl, runtime.platform || process.platform);
  const prismaArgs = appendSchemaArg(options.prismaArgs, schema);
  const result = spawn(prisma.command, [...prisma.argsPrefix, ...prismaArgs], {
    cwd,
    stdio: 'inherit',
    env,
  });

  assertSpawnSucceeded(result, [prisma.command, ...prisma.argsPrefix, ...prismaArgs].join(' '), commandTimeoutMs);

  return result.status ?? 1;
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  resolveCommandTimeoutMs,
  absoluteSqliteUrl,
  appendSchemaArg,
  buildExecEnv,
  defaultSqliteUrl,
  ensureSqliteDatabaseFile,
  firstEnvValue,
  hasSchemaArg,
  isNextBuildCommand,
  loadEnvFile,
  mergeConfig,
  parseArgs,
  providerFromUrl,
  resolveContext,
  resolveMode,
  runCli,
  shouldAppendSchemaArg,
  sqliteDatabasePath,
};
