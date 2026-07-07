// Consumer-side type contract for src/index.d.ts. This file is NOT run — it is
// type-checked by `npm run verify:types` (tsc --noEmit). If the hand-written
// declarations drift from the JS surface, this fails to compile in CI.
//
// It exercises the public API the way a real consumer (bewks, sano, …) does.
import {
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
  type ParsedPrismaToolsArgs,
  type PrismaToolsConfig,
  type PrismaToolsRuntime,
  type ResolvedPrismaToolsContext,
} from '../src/index';

// parseArgs / firstEnvValue / mergeConfig.
const parsed: ParsedPrismaToolsArgs = parseArgs(['--prod', 'migrate', 'deploy']);
const envValue: string | undefined = firstEnvValue(process.env, ['APP_ENV', 'PRISMA_ENV']);
const config: Required<PrismaToolsConfig> = mergeConfig({
  envKeys: { mode: ['APP_ENV'], provider: ['APP_DATABASE_PROVIDER'] },
  outputEnv: { mode: 'APP_ENV', provider: null },
});

// resolveMode / providerFromUrl.
const mode: 'dev' | 'prod' = resolveMode(parsed.mode, process.env, config.envKeys.mode);
const provider: 'sqlite' | 'postgresql' = providerFromUrl('file:./dev.db', process.env, config.envKeys.provider);

// Schema-arg helpers.
const hasSchema: boolean = hasSchemaArg(parsed.prismaArgs);
const shouldAppend: boolean = shouldAppendSchemaArg(parsed.prismaArgs);
const withSchema: string[] = appendSchemaArg(parsed.prismaArgs, config.sqliteSchema);

// SQLite URL / path helpers.
const absoluteUrl: string | undefined = absoluteSqliteUrl('file:./dev.db?a=1', process.cwd());
const defaultUrl: string = defaultSqliteUrl(process.cwd(), config);
const dbPath: string | null = sqliteDatabasePath('file:./dev.db', config.sqliteSchema);
ensureSqliteDatabaseFile('file:./dev.db', config.sqliteSchema);

// exec env + next-build detection.
const isNextBuild: boolean = isNextBuildCommand(['npx', 'next', 'build']);
const execEnv: NodeJS.ProcessEnv = buildExecEnv(['npx', 'next', 'build'], process.cwd(), process.env);

// loadEnvFile.
const loaded: boolean = loadEnvFile('.env', {
  env: process.env,
  originalEnvKeys: new Set(Object.keys(process.env)),
  override: false,
});

// resolveContext returns the parsed options alongside the resolved context.
const context: ResolvedPrismaToolsContext = resolveContext({
  argv: ['migrate', 'deploy'],
  cwd: process.cwd(),
  env: process.env,
  config,
});

// runCli accepts a fully typed PrismaToolsRuntime, including the DI seams used
// by tests (fake spawnSync/fs/stdout) and the platform override.
const runtime: PrismaToolsRuntime = {
  cwd: process.cwd(),
  env: process.env,
  fs: undefined,
  spawnSync: (_command, _args, _options) => ({ status: 0 }),
  stdout: { write: () => undefined },
  config,
  platform: 'win32',
};
const status: number = runCli(['migrate', 'deploy'], runtime);

// Reference the values so tsc doesn't prune the imports as unused.
export const _contract = {
  parsed,
  envValue,
  config,
  mode,
  provider,
  hasSchema,
  shouldAppend,
  withSchema,
  absoluteUrl,
  defaultUrl,
  dbPath,
  isNextBuild,
  execEnv,
  loaded,
  context,
  status,
};
