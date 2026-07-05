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
  for (const key of keys) {
    if (env[key] !== undefined) {
      return env[key];
    }
  }

  return undefined;
}

function resolveMode(explicitMode, env = process.env, envKeys = DEFAULT_CONFIG.envKeys.mode) {
  if (explicitMode) {
    return explicitMode;
  }

  const envMode = firstEnvValue(env, envKeys);
  if (envMode === 'prod' || envMode === 'production') {
    return 'prod';
  }
  if (envMode === 'dev' || envMode === 'development') {
    return 'dev';
  }

  return env.NODE_ENV === 'production' ? 'prod' : 'dev';
}

function providerFromUrl(databaseUrl, env = process.env, envKeys = DEFAULT_CONFIG.envKeys.provider) {
  const explicitProvider = firstEnvValue(env, envKeys);
  if (explicitProvider === 'sqlite' || explicitProvider === 'postgresql' || explicitProvider === 'postgres') {
    return explicitProvider === 'postgres' ? 'postgresql' : explicitProvider;
  }

  if (!databaseUrl || databaseUrl.startsWith('file:')) {
    return 'sqlite';
  }

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return 'postgresql';
  }

  throw new Error('Unsupported DATABASE_URL scheme. Expected file:, postgres://, or postgresql://.');
}

function resolvePrismaBin(cwd, fsImpl = fs) {
  const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const localBin = path.resolve(cwd, 'node_modules', '.bin', binName);
  if (fsImpl.existsSync(localBin)) {
    return { command: localBin, argsPrefix: [] };
  }

  return { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', argsPrefix: ['prisma'] };
}

function defaultSqliteUrl(cwd, config = DEFAULT_CONFIG) {
  return `file:${path.resolve(cwd, config.defaultSqlitePath)}`;
}

function sqliteDatabasePath(databaseUrl, schemaPath) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) {
    return null;
  }

  const rawPath = databaseUrl.slice('file:'.length).split('?')[0];
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

  const [rawPath, queryString] = databaseUrl.slice('file:'.length).split('?', 2);
  if (!rawPath || rawPath === ':memory:' || path.isAbsolute(rawPath)) {
    return databaseUrl;
  }

  const query = queryString === undefined ? '' : `?${queryString}`;
  return `file:${path.resolve(cwd, rawPath)}${query}`;
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

function runCli(argv = process.argv.slice(2), runtime = {}) {
  const cwd = runtime.cwd || process.cwd();
  const env = runtime.env || process.env;
  const fsImpl = runtime.fs || fs;
  const spawn = runtime.spawnSync || spawnSync;
  const stdout = runtime.stdout || process.stdout;
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

    if (result.error) {
      throw result.error;
    }

    return result.status ?? 1;
  }

  const prisma = resolvePrismaBin(cwd, fsImpl);
  const prismaArgs = appendSchemaArg(options.prismaArgs, schema);
  const result = spawn(prisma.command, [...prisma.argsPrefix, ...prismaArgs], {
    cwd,
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

module.exports = {
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
