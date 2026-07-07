import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  absoluteSqliteUrl,
  appendSchemaArg,
  buildExecEnv,
  defaultSqliteUrl,
  ensureSqliteDatabaseFile,
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
} = require('../index.js') as typeof import('../index');

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-tools-'));
  tempDirs.push(dir);
  return dir;
}

function writeProjectEnv(cwd: string, envFiles: Record<string, string>) {
  for (const [fileName, contents] of Object.entries(envFiles)) {
    fs.writeFileSync(path.join(cwd, fileName), contents);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('@andrewvpopov/prisma-tools', () => {
  it('resolves dev SQLite context from project env files without overriding caller env', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, {
      '.env': 'DATABASE_URL=file:./base.db\n',
      '.env.local': 'DATABASE_URL=file:./dev.db\nNODE_ENV=development\n',
    });
    const env = { DATABASE_URL: 'file:./caller.db' };

    const context = resolveContext({ argv: ['generate'], cwd, env });

    expect(context).toMatchObject({
      mode: 'dev',
      provider: 'sqlite',
      schema: 'prisma/schema.prisma',
      migrations: 'prisma/migrations',
      databaseUrl: 'file:./caller.db',
    });
    expect(env).toMatchObject({
      PRISMA_TOOLS_ENV: 'dev',
      PRISMA_TOOLS_DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: 'file:./caller.db',
    });
  });

  it('resolves production PostgreSQL context from the production env file', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, {
      '.env.production': 'DATABASE_URL=postgresql://user:secret@db.example/bewks\n',
    });
    const env = {};

    const context = resolveContext({ argv: ['--prod', 'migrate', 'deploy'], cwd, env });

    expect(context).toMatchObject({
      mode: 'prod',
      provider: 'postgresql',
      schema: 'prisma/postgres/schema.prisma',
      migrations: 'prisma/postgres/migrations',
      databaseUrl: 'postgresql://user:secret@db.example/bewks',
    });
  });

  it('detects supported database providers', () => {
    expect(providerFromUrl(undefined, {})).toBe('sqlite');
    expect(providerFromUrl('file:./dev.db', {})).toBe('sqlite');
    expect(providerFromUrl('postgres://user@host/db', {})).toBe('postgresql');
    expect(providerFromUrl('postgresql://user@host/db', {})).toBe('postgresql');
    expect(providerFromUrl('file:./dev.db', { DATABASE_PROVIDER: 'postgres' })).toBe('postgresql');
  });

  it('falls through a blank primary env key to the secondary (truthy fallback)', () => {
    // A primary key set to "" must not short-circuit; it should defer to the
    // next key, matching `env.PRIMARY || env.SECONDARY`.
    const envKeys = ['APP_DATABASE_PROVIDER', 'DATABASE_PROVIDER'];
    expect(
      providerFromUrl('file:./dev.db', { APP_DATABASE_PROVIDER: '', DATABASE_PROVIDER: 'postgresql' }, envKeys),
    ).toBe('postgresql');
    // Blank across all keys falls back to URL detection.
    expect(providerFromUrl('file:./dev.db', { APP_DATABASE_PROVIDER: '' }, envKeys)).toBe('sqlite');
  });

  it('resolveMode falls through a blank primary mode key to the secondary', () => {
    const envKeys = ['APP_ENV', 'PRISMA_ENV'];
    // Blank primary must defer to the secondary, not short-circuit to the default.
    expect(resolveMode(undefined, { APP_ENV: '', PRISMA_ENV: 'prod' }, envKeys)).toBe('prod');
    expect(resolveMode(undefined, { APP_ENV: '', PRISMA_ENV: 'dev' }, envKeys)).toBe('dev');
    // Blank across all keys falls back to NODE_ENV.
    expect(resolveMode(undefined, { APP_ENV: '', NODE_ENV: 'production' }, envKeys)).toBe('prod');
  });

  it('appends the resolved schema for schema-aware Prisma commands', () => {
    expect(appendSchemaArg(['generate'], 'prisma/schema.prisma')).toEqual([
      'generate',
      '--schema',
      'prisma/schema.prisma',
    ]);
    expect(appendSchemaArg(['migrate', 'deploy'], 'prisma/postgres/schema.prisma')).toEqual([
      'migrate',
      'deploy',
      '--schema',
      'prisma/postgres/schema.prisma',
    ]);
    expect(appendSchemaArg(['db', 'push'], 'prisma/schema.prisma')).toEqual([
      'db',
      'push',
      '--schema',
      'prisma/schema.prisma',
    ]);
  });

  it('does not append duplicate or unsupported schema args', () => {
    expect(appendSchemaArg(['generate', '--schema', 'custom.prisma'], 'prisma/schema.prisma')).toEqual([
      'generate',
      '--schema',
      'custom.prisma',
    ]);
    expect(appendSchemaArg(['generate', '--schema=custom.prisma'], 'prisma/schema.prisma')).toEqual([
      'generate',
      '--schema=custom.prisma',
    ]);
    expect(appendSchemaArg(['--help'], 'prisma/schema.prisma')).toEqual(['--help']);
    expect(appendSchemaArg(['migrate', 'diff'], 'prisma/schema.prisma')).toEqual(['migrate', 'diff']);
  });

  it('allows consuming apps to customize env input and output names', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, {
      '.env.local': 'DATABASE_URL=file:./dev.db\n',
    });
    const env = { BEWKS_ENV: 'production', BEWKS_DATABASE_PROVIDER: 'postgres' };

    const context = resolveContext({
      argv: ['generate'],
      cwd,
      env,
      config: {
        envKeys: {
          mode: ['BEWKS_ENV', 'PRISMA_TOOLS_ENV'],
          provider: ['BEWKS_DATABASE_PROVIDER', 'DATABASE_PROVIDER'],
        },
        outputEnv: {
          mode: 'BEWKS_ENV',
          provider: 'BEWKS_DATABASE_PROVIDER',
        },
      },
    });

    expect(context).toMatchObject({
      mode: 'prod',
      provider: 'postgresql',
    });
    expect(env.BEWKS_ENV).toBe('prod');
    expect(env.BEWKS_DATABASE_PROVIDER).toBe('postgresql');
  });

  it('normalizes relative SQLite URLs while preserving absolute and memory URLs', () => {
    const cwd = makeTempDir();

    expect(absoluteSqliteUrl('file:./prisma/dev.db?connection_limit=1', cwd)).toBe(
      `file:${path.join(cwd, 'prisma/dev.db')}?connection_limit=1`
    );
    expect(absoluteSqliteUrl('file:/var/lib/app.db', cwd)).toBe('file:/var/lib/app.db');
    expect(absoluteSqliteUrl('file::memory:', cwd)).toBe('file::memory:');
    expect(absoluteSqliteUrl('postgresql://user@host/db', cwd)).toBe('postgresql://user@host/db');
  });

  it('runs next build with production NODE_ENV and an absolute SQLite URL', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, {
      '.env.local': 'DATABASE_URL=file:./prisma/dev.db\nNODE_ENV=development\n',
    });
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];

    const status = runCli(['exec', 'npx', 'next', 'build'], {
      cwd,
      env: {},
      spawnSync: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ command, args, env: options.env });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: 'npx', args: ['next', 'build'] });
    expect(calls[0].env.NODE_ENV).toBe('production');
    expect(calls[0].env.PRISMA_TOOLS_ENV).toBe('dev');
    expect(calls[0].env.DATABASE_URL).toBe(`file:${path.join(cwd, 'prisma/dev.db')}`);
  });

  it('does not rewrite env for non-Next exec commands', () => {
    const env = { NODE_ENV: 'development', DATABASE_URL: 'file:./prisma/dev.db' };

    expect(isNextBuildCommand(['node', '-e', 'true'])).toBe(false);
    expect(buildExecEnv(['node', '-e', 'true'], '/tmp/app', env)).toBe(env);
  });

  it('creates a missing SQLite file before migrate deploy/status', () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, 'prisma'), { recursive: true });
    writeProjectEnv(cwd, {
      '.env.local': 'DATABASE_URL=file:./dev.db\n',
    });
    const databasePath = path.join(cwd, 'prisma', 'dev.db');

    const status = runCli(['migrate', 'deploy'], {
      cwd,
      env: {},
      spawnSync: () => ({ status: 0 }),
      stdout: { write: () => undefined },
    });

    expect(status).toBe(0);
    expect(fs.existsSync(databasePath)).toBe(true);
  });

  it('runs Prisma with the schema resolved from the selected provider', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, {
      '.env.production': 'DATABASE_URL=postgresql://user:secret@db.example/app\n',
    });
    const calls: Array<{ command: string; args: string[] }> = [];

    const status = runCli(['--prod', 'migrate', 'deploy'], {
      cwd,
      env: {},
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['prisma', 'migrate', 'deploy', '--schema', 'prisma/postgres/schema.prisma']);
  });
});

describe('parseArgs', () => {
  it('treats flags appearing after the command as prismaArgs, not options', () => {
    const parsed = parseArgs(['migrate', 'dev', '--prod']);
    expect(parsed.mode).toBeNull();
    expect(parsed.prismaArgs).toEqual(['migrate', 'dev', '--prod']);
  });

  it('defaults to --help for empty argv', () => {
    expect(parseArgs([]).prismaArgs).toEqual(['--help']);
  });

  it('parses --quiet --prod migrate', () => {
    const parsed = parseArgs(['--quiet', '--prod', 'migrate']);
    expect(parsed.quiet).toBe(true);
    expect(parsed.mode).toBe('prod');
    expect(parsed.prismaArgs).toEqual(['migrate']);
  });

  it('maps bare --dev/--development and --prod/--production', () => {
    expect(parseArgs(['--dev', 'generate']).mode).toBe('dev');
    expect(parseArgs(['--development', 'generate']).mode).toBe('dev');
    expect(parseArgs(['--prod', 'generate']).mode).toBe('prod');
    expect(parseArgs(['--production', 'generate']).mode).toBe('prod');
  });
});

describe('providerFromUrl additional cases', () => {
  it('throws on an unsupported DATABASE_URL scheme', () => {
    expect(() => providerFromUrl('mysql://user@host/db', {})).toThrow(/Unsupported DATABASE_URL/);
  });

  it('maps an explicit postgres provider to postgresql', () => {
    expect(providerFromUrl(undefined, { DATABASE_PROVIDER: 'postgres' })).toBe('postgresql');
  });

  it('honors an explicit sqlite provider', () => {
    expect(providerFromUrl('postgresql://user@host/db', { DATABASE_PROVIDER: 'sqlite' })).toBe('sqlite');
  });

  it('throws on a set-but-unrecognized explicit provider (does not silently fall back to sqlite)', () => {
    expect(() => providerFromUrl('file:./dev.db', { DATABASE_PROVIDER: 'mongo' })).toThrow(
      /Unsupported explicit database provider "mongo"/,
    );
  });
});

describe('sqliteDatabasePath', () => {
  it('resolves a relative file: url against the schema directory, stripping the query', () => {
    const schemaPath = path.resolve('project', 'prisma', 'schema.prisma');
    expect(sqliteDatabasePath('file:./x.db?connection_limit=1', schemaPath)).toBe(
      path.resolve('project', 'prisma', 'x.db'),
    );
  });

  it('returns null for :memory: and empty file paths', () => {
    const schemaPath = path.resolve('project', 'prisma', 'schema.prisma');
    expect(sqliteDatabasePath('file::memory:', schemaPath)).toBeNull();
    expect(sqliteDatabasePath('file:', schemaPath)).toBeNull();
  });

  it('returns an already-absolute path as-is', () => {
    const schemaPath = path.resolve('project', 'prisma', 'schema.prisma');
    const absoluteDbPath = path.resolve('var', 'lib', 'app.db');
    expect(sqliteDatabasePath(`file:${absoluteDbPath}`, schemaPath)).toBe(absoluteDbPath);
  });

  it('returns null for a non-file url', () => {
    expect(sqliteDatabasePath('postgresql://user@host/db', path.resolve('project', 'prisma', 'schema.prisma'))).toBeNull();
  });
});

describe('defaultSqliteUrl', () => {
  it('returns file:<abs cwd/prisma/dev.db> by default', () => {
    const cwd = makeTempDir();
    expect(defaultSqliteUrl(cwd)).toBe(`file:${path.resolve(cwd, 'prisma', 'dev.db')}`);
  });

  it('respects a custom defaultSqlitePath via config', () => {
    const cwd = makeTempDir();
    expect(defaultSqliteUrl(cwd, { defaultSqlitePath: path.join('data', 'custom.db') })).toBe(
      `file:${path.resolve(cwd, 'data', 'custom.db')}`,
    );
  });

  it('is defensive against a partial config object instead of crashing', () => {
    const cwd = makeTempDir();
    expect(() => defaultSqliteUrl(cwd, {})).not.toThrow();
    expect(defaultSqliteUrl(cwd, {})).toBe(`file:${path.resolve(cwd, 'prisma', 'dev.db')}`);
  });
});

describe('ensureSqliteDatabaseFile', () => {
  it('creates the missing directory and file', () => {
    const cwd = makeTempDir();
    const schemaPath = path.resolve(cwd, 'prisma', 'schema.prisma');
    const expectedDbPath = path.resolve(cwd, 'prisma', 'dev.db');
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const fakeFs = {
      existsSync: (p: string) => {
        calls.push({ fn: 'existsSync', args: [p] });
        return false;
      },
      mkdirSync: (dir: string, opts: unknown) => {
        calls.push({ fn: 'mkdirSync', args: [dir, opts] });
      },
      openSync: (file: string, flag: string) => {
        calls.push({ fn: 'openSync', args: [file, flag] });
        return 42;
      },
      closeSync: (fd: number) => {
        calls.push({ fn: 'closeSync', args: [fd] });
      },
    };

    ensureSqliteDatabaseFile('file:./dev.db', schemaPath, fakeFs);

    expect(calls).toContainEqual({ fn: 'mkdirSync', args: [path.dirname(expectedDbPath), { recursive: true }] });
    expect(calls).toContainEqual({ fn: 'openSync', args: [expectedDbPath, 'a'] });
    expect(calls).toContainEqual({ fn: 'closeSync', args: [42] });
  });

  it('skips creation when the file already exists', () => {
    const cwd = makeTempDir();
    const schemaPath = path.resolve(cwd, 'prisma', 'schema.prisma');
    const calls: string[] = [];
    const fakeFs = {
      existsSync: () => true,
      mkdirSync: () => calls.push('mkdirSync'),
      openSync: () => calls.push('openSync'),
      closeSync: () => calls.push('closeSync'),
    };

    ensureSqliteDatabaseFile('file:./dev.db', schemaPath, fakeFs);

    expect(calls).toHaveLength(0);
  });

  it('is a no-op for :memory: and a null/undefined database url', () => {
    const cwd = makeTempDir();
    const schemaPath = path.resolve(cwd, 'prisma', 'schema.prisma');
    const calls: string[] = [];
    const fakeFs = {
      existsSync: () => {
        calls.push('existsSync');
        return false;
      },
      mkdirSync: () => calls.push('mkdirSync'),
      openSync: () => calls.push('openSync'),
      closeSync: () => calls.push('closeSync'),
    };

    ensureSqliteDatabaseFile('file::memory:', schemaPath, fakeFs);
    ensureSqliteDatabaseFile(undefined, schemaPath, fakeFs);

    expect(calls).toHaveLength(0);
  });
});

describe('loadEnvFile', () => {
  it('returns false when the file is missing', () => {
    const cwd = makeTempDir();
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFile(path.join(cwd, '.env'), { env, originalEnvKeys: new Set() });
    expect(result).toBe(false);
  });

  it('parses the file and sets keys, returning true', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, { '.env': 'FOO=bar\nBAZ=qux\n' });
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFile(path.join(cwd, '.env'), { env, originalEnvKeys: new Set() });
    expect(result).toBe(true);
    expect(env).toMatchObject({ FOO: 'bar', BAZ: 'qux' });
  });

  it('originalEnvKeys protects a caller-set key from being clobbered even with override', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, { '.env': 'FOO=fromfile\n' });
    const env: NodeJS.ProcessEnv = { FOO: 'fromcaller' };
    const originalEnvKeys = new Set(Object.keys(env));
    loadEnvFile(path.join(cwd, '.env'), { env, originalEnvKeys, override: true });
    expect(env.FOO).toBe('fromcaller');
  });

  it('override:false does not overwrite an already-defined env key', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, { '.env': 'FOO=fromfile\nBAR=fromfile\n' });
    const env: NodeJS.ProcessEnv = { FOO: 'existing' };
    loadEnvFile(path.join(cwd, '.env'), { env, originalEnvKeys: new Set(), override: false });
    expect(env.FOO).toBe('existing');
    expect(env.BAR).toBe('fromfile');
  });
});

describe('mergeConfig', () => {
  it('deep-merges envFiles/outputEnv and falls back to defaults otherwise', () => {
    const merged = mergeConfig({ envFiles: { dev: '.env.custom' }, outputEnv: { mode: null } });
    expect(merged.envFiles).toEqual({ base: '.env', dev: '.env.custom', prod: '.env.production' });
    expect(merged.outputEnv).toEqual({ mode: null, provider: 'PRISMA_TOOLS_DATABASE_PROVIDER' });
    expect(merged.envKeys).toEqual({
      mode: ['PRISMA_TOOLS_ENV', 'PRISMA_ENV'],
      provider: ['PRISMA_TOOLS_DATABASE_PROVIDER', 'DATABASE_PROVIDER'],
    });
  });

  it('replaces envKeys.mode/provider arrays wholesale when provided', () => {
    const merged = mergeConfig({ envKeys: { mode: ['APP_ENV'] } });
    expect(merged.envKeys.mode).toEqual(['APP_ENV']);
    expect(merged.envKeys.provider).toEqual(['PRISMA_TOOLS_DATABASE_PROVIDER', 'DATABASE_PROVIDER']);
  });
});

describe('hasSchemaArg / shouldAppendSchemaArg', () => {
  it('detects --schema in its various forms', () => {
    expect(hasSchemaArg(['generate', '--schema', 'x.prisma'])).toBe(true);
    expect(hasSchemaArg(['generate', '--schema=x.prisma'])).toBe(true);
    expect(hasSchemaArg(['generate'])).toBe(false);
  });

  it('covers every should-append branch', () => {
    expect(shouldAppendSchemaArg(['generate'])).toBe(true);
    expect(shouldAppendSchemaArg(['validate'])).toBe(true);
    expect(shouldAppendSchemaArg(['format'])).toBe(true);
    expect(shouldAppendSchemaArg(['studio'])).toBe(true);
    expect(shouldAppendSchemaArg(['migrate', 'deploy'])).toBe(true);
    expect(shouldAppendSchemaArg(['migrate', 'dev'])).toBe(true);
    expect(shouldAppendSchemaArg(['migrate', 'reset'])).toBe(true);
    expect(shouldAppendSchemaArg(['migrate', 'resolve'])).toBe(true);
    expect(shouldAppendSchemaArg(['migrate', 'status'])).toBe(true);
    expect(shouldAppendSchemaArg(['migrate', 'diff'])).toBe(false);
    expect(shouldAppendSchemaArg(['db', 'pull'])).toBe(true);
    expect(shouldAppendSchemaArg(['db', 'push'])).toBe(true);
    expect(shouldAppendSchemaArg(['db', 'execute'])).toBe(false);
    expect(shouldAppendSchemaArg(['--help'])).toBe(false);
    expect(shouldAppendSchemaArg(['generate', '--schema', 'x.prisma'])).toBe(false);
  });
});

describe('resolveMode explicit-mode normalization', () => {
  it('normalizes production/development to prod/dev and passes prod/dev through', () => {
    expect(resolveMode('production')).toBe('prod');
    expect(resolveMode('development')).toBe('dev');
    expect(resolveMode('prod')).toBe('prod');
    expect(resolveMode('dev')).toBe('dev');
  });

  it('falls an unrecognized explicit mode through to env/NODE_ENV resolution', () => {
    expect(resolveMode('staging', { NODE_ENV: 'production' })).toBe('prod');
    expect(resolveMode('staging', {})).toBe('dev');
    expect(resolveMode('staging', { PRISMA_ENV: 'prod' })).toBe('prod');
  });
});

describe('resolveContext additional contract tests', () => {
  it('PRISMA_ENV_FILE (set on the passed env) overrides the mode file', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, {
      '.env.local': 'DATABASE_URL=file:./dev.db\n',
      '.env.custom': 'DATABASE_URL=file:./custom.db\n',
    });
    // PRISMA_ENV_FILE must be set on the env object itself: resolveContext reads
    // env.PRISMA_ENV_FILE before loading any .env file, so a .env file cannot
    // define it.
    const env: NodeJS.ProcessEnv = { PRISMA_ENV_FILE: '.env.custom' };

    const context = resolveContext({ argv: ['generate'], cwd, env });

    expect(context.databaseUrl).toBe('file:./custom.db');
  });

  it('injects a default DATABASE_URL for format/generate/validate/exec but not for migrate', () => {
    const cwd = makeTempDir();

    const envGenerate: NodeJS.ProcessEnv = {};
    const contextGenerate = resolveContext({ argv: ['generate'], cwd, env: envGenerate });
    expect(contextGenerate.databaseUrl).toBe(defaultSqliteUrl(cwd, mergeConfig()));

    const envMigrate: NodeJS.ProcessEnv = {};
    const contextMigrate = resolveContext({ argv: ['migrate', 'dev'], cwd, env: envMigrate });
    expect(contextMigrate.databaseUrl).toBeUndefined();
  });

  it('outputEnv:{mode:null} suppresses the mode write-back', () => {
    const cwd = makeTempDir();
    const env: NodeJS.ProcessEnv = {};

    resolveContext({ argv: ['generate'], cwd, env, config: { outputEnv: { mode: null } } });

    expect(env.PRISMA_TOOLS_ENV).toBeUndefined();
    expect(env.PRISMA_TOOLS_DATABASE_PROVIDER).toBe('sqlite');
  });

  it('mutates the passed env object: mode/provider written back, dotenv values loaded', () => {
    const cwd = makeTempDir();
    writeProjectEnv(cwd, { '.env': 'SOME_KEY=fromfile\n' });
    const env: NodeJS.ProcessEnv = {};

    resolveContext({ argv: ['generate'], cwd, env });

    expect(env.SOME_KEY).toBe('fromfile');
    expect(env.PRISMA_TOOLS_ENV).toBe('dev');
    expect(env.PRISMA_TOOLS_DATABASE_PROVIDER).toBe('sqlite');
  });
});

describe('runCli exec paths', () => {
  it('throws when exec has no command to run', () => {
    const cwd = makeTempDir();
    expect(() =>
      runCli(['exec'], {
        cwd,
        env: {},
        spawnSync: () => ({ status: 0 }),
        stdout: { write: () => undefined },
      }),
    ).toThrow(/exec requires a command/);
  });

  it('strips the leading -- from exec -- <command>', () => {
    const cwd = makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    runCli(['exec', '--', 'echo', 'hi'], {
      cwd,
      env: {},
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(calls[0]).toMatchObject({ command: 'echo', args: ['hi'] });
  });

  it('rethrows a spawn result.error', () => {
    const cwd = makeTempDir();
    const spawnError = new Error('spawn failed');

    expect(() =>
      runCli(['exec', 'echo', 'hi'], {
        cwd,
        env: {},
        spawnSync: () => ({ status: null, error: spawnError }),
        stdout: { write: () => undefined },
      }),
    ).toThrow(spawnError);
  });

  it('returns 1 when the child status is null', () => {
    const cwd = makeTempDir();

    const status = runCli(['exec', 'echo', 'hi'], {
      cwd,
      env: {},
      spawnSync: () => ({ status: null }),
      stdout: { write: () => undefined },
    });

    expect(status).toBe(1);
  });

  it('propagates a non-zero exit status', () => {
    const cwd = makeTempDir();

    const status = runCli(['exec', 'echo', 'hi'], {
      cwd,
      env: {},
      spawnSync: () => ({ status: 7 }),
      stdout: { write: () => undefined },
    });

    expect(status).toBe(7);
  });

  it('--quiet suppresses the [prisma-tools] summary line', () => {
    const cwd = makeTempDir();
    const writes: string[] = [];

    runCli(['--quiet', 'exec', 'echo', 'hi'], {
      cwd,
      env: {},
      spawnSync: () => ({ status: 0 }),
      stdout: { write: (chunk: string) => writes.push(chunk) },
    });

    expect(writes.some((chunk) => chunk.includes('[prisma-tools]'))).toBe(false);
  });
});

describe('resolvePrismaBin (indirect via runCli)', () => {
  it('uses the local node_modules/.bin/prisma when present, with an empty argsPrefix', () => {
    const cwd = makeTempDir();
    const localBinPath = path.resolve(cwd, 'node_modules', '.bin', 'prisma');
    const calls: Array<{ command: string; args: string[] }> = [];

    const status = runCli(['generate'], {
      cwd,
      env: {},
      fs: { existsSync: (p: string) => p === localBinPath },
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(status).toBe(0);
    expect(calls).toEqual([{ command: localBinPath, args: ['generate', '--schema', 'prisma/schema.prisma'] }]);
  });

  it('falls back to npx prisma when no local bin exists', () => {
    const cwd = makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    runCli(['generate'], {
      cwd,
      env: {},
      fs: { existsSync: () => false },
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(calls).toEqual([{ command: 'npx', args: ['prisma', 'generate', '--schema', 'prisma/schema.prisma'] }]);
  });

  it('uses the .cmd binary names when runtime.platform is injected as win32', () => {
    const cwd = makeTempDir();
    const localBinPath = path.resolve(cwd, 'node_modules', '.bin', 'prisma.cmd');
    const calls: Array<{ command: string; args: string[] }> = [];

    runCli(['generate'], {
      cwd,
      env: {},
      fs: { existsSync: (p: string) => p === localBinPath },
      platform: 'win32',
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(calls).toEqual([{ command: localBinPath, args: ['generate', '--schema', 'prisma/schema.prisma'] }]);

    const fallbackCalls: Array<{ command: string; args: string[] }> = [];
    runCli(['generate'], {
      cwd,
      env: {},
      fs: { existsSync: () => false },
      platform: 'win32',
      spawnSync: (command: string, args: string[]) => {
        fallbackCalls.push({ command, args });
        return { status: 0 };
      },
      stdout: { write: () => undefined },
    });

    expect(fallbackCalls).toEqual([
      { command: 'npx.cmd', args: ['prisma', 'generate', '--schema', 'prisma/schema.prisma'] },
    ]);
  });
});

describe('absoluteSqliteUrl second-? bug fix (parseSqliteFileUrl)', () => {
  it('preserves a query containing a second ? after absolutizing', () => {
    const cwd = makeTempDir();
    expect(absoluteSqliteUrl('file:./x.db?a=1?b=2&c=3', cwd)).toBe(`file:${path.resolve(cwd, 'x.db')}?a=1?b=2&c=3`);
  });
});
