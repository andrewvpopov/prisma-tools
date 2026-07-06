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
  isNextBuildCommand,
  providerFromUrl,
  resolveContext,
  runCli,
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
