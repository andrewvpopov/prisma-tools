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
  options: ParsedPrismaToolsArgs;
}

// Runtime dependency-injection seam accepted by `runCli` (and, via
// `runCli`, by `resolveContext`). All fields are optional; each defaults to
// the corresponding real Node.js global when omitted.
export interface PrismaToolsRuntime {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fs?: unknown;
  spawnSync?: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      stdio: 'inherit';
      env: NodeJS.ProcessEnv;
      /** Injected by runCli: every spawned command is bounded. */
      timeout: number;
      killSignal: 'SIGKILL';
    },
  ) => { status?: number | null; error?: NodeJS.ErrnoException };
  stdout?: { write(chunk: string): void };
  config?: PrismaToolsConfig;
  platform?: NodeJS.Platform;
  /** Process timeout applied to every spawned command. Overrides
   * `PRISMA_TOOLS_COMMAND_TIMEOUT_MS`; defaults to `DEFAULT_COMMAND_TIMEOUT_MS`. */
  commandTimeoutMs?: number | string | null;
}

/** Default bound on every spawned command (30 minutes). Generous because
 * `next build` on a Raspberry Pi is legitimately slow. */
export const DEFAULT_COMMAND_TIMEOUT_MS: number;

export function resolveCommandTimeoutMs(
  value?: number | string | null,
  env?: NodeJS.ProcessEnv,
): number;

export function parseArgs(argv: string[]): ParsedPrismaToolsArgs;
export function firstEnvValue(env: NodeJS.ProcessEnv, keys?: string[]): string | undefined;
export function mergeConfig(config?: PrismaToolsConfig): Required<PrismaToolsConfig>;
export function resolveMode(explicitMode?: string | null, env?: NodeJS.ProcessEnv, envKeys?: string[]): PrismaToolsMode;
export function providerFromUrl(databaseUrl?: string, env?: NodeJS.ProcessEnv, envKeys?: string[]): PrismaProvider;
export function absoluteSqliteUrl(databaseUrl: string | undefined, cwd: string): string | undefined;
export function defaultSqliteUrl(cwd: string, config?: PrismaToolsConfig): string;
export function ensureSqliteDatabaseFile(databaseUrl: string | undefined, schemaPath: string, fsImpl?: unknown): void;
export function loadEnvFile(
  filePath: string,
  options: { env: NodeJS.ProcessEnv; originalEnvKeys: Set<string>; override?: boolean; fsImpl?: unknown },
): boolean;
export function sqliteDatabasePath(databaseUrl: string | undefined, schemaPath: string): string | null;
export function isNextBuildCommand(commandArgs: string[]): boolean;
export function hasSchemaArg(prismaArgs: string[]): boolean;
export function shouldAppendSchemaArg(prismaArgs: string[]): boolean;
export function appendSchemaArg(prismaArgs: string[], schema: string): string[];
export function buildExecEnv(commandArgs: string[], cwd: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function resolveContext(options?: {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  config?: PrismaToolsConfig;
}): ResolvedPrismaToolsContext;
export function runCli(argv?: string[], runtime?: PrismaToolsRuntime): number;
