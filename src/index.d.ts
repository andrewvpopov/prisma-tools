export type PrismaToolsMode = 'dev' | 'prod';
export type PrismaProvider = 'sqlite' | 'postgresql';

export interface PrismaToolsConfig {
  envFiles?: {
    base?: string;
    dev?: string;
    prod?: string;
  };
  sqliteSchema?: string;
  postgresSchema?: string;
  sqliteMigrations?: string;
  postgresMigrations?: string;
  defaultSqlitePath?: string;
  envKeys?: {
    mode?: string[];
    provider?: string[];
  };
  outputEnv?: {
    mode?: string | null;
    provider?: string | null;
  };
}

export interface ParsedPrismaToolsArgs {
  mode: PrismaToolsMode | null;
  quiet: boolean;
  prismaArgs: string[];
}

export interface ResolvedPrismaToolsContext {
  mode: PrismaToolsMode;
  provider: PrismaProvider;
  schema: string;
  migrations: string;
  schemaPath: string;
  databaseUrl?: string;
}

export function parseArgs(argv: string[]): ParsedPrismaToolsArgs;
export function firstEnvValue(env: NodeJS.ProcessEnv, keys?: string[]): string | undefined;
export function mergeConfig(config?: PrismaToolsConfig): Required<PrismaToolsConfig>;
export function resolveMode(explicitMode?: string | null, env?: NodeJS.ProcessEnv, envKeys?: string[]): PrismaToolsMode;
export function providerFromUrl(databaseUrl?: string, env?: NodeJS.ProcessEnv, envKeys?: string[]): PrismaProvider;
export function absoluteSqliteUrl(databaseUrl: string | undefined, cwd: string): string | undefined;
export function isNextBuildCommand(commandArgs: string[]): boolean;
export function buildExecEnv(commandArgs: string[], cwd: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function resolveContext(options?: {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  config?: PrismaToolsConfig;
}): ResolvedPrismaToolsContext;
export function runCli(argv?: string[], runtime?: object): number;
