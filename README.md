# @andrewpopov/prisma-tools

Reusable Prisma environment and command wrapper utilities for apps that need a
predictable way to run Prisma against SQLite in development and PostgreSQL in
production.

This package is intentionally small. It is not an ORM abstraction and it does
not replace Prisma. It wraps Prisma commands with consistent environment-file
loading, database-provider detection, schema selection, and build-time SQLite
normalization.

## What It Does

- Resolves `dev` or `prod` mode from CLI flags or environment.
- Loads `.env`, `.env.local`, and `.env.production` in a predictable order.
- Detects `sqlite` or `postgresql` from `DATABASE_URL` or an explicit provider
  env var.
- Selects the matching Prisma schema and migration directory.
- Runs Prisma commands through the local project Prisma binary with the
  selected schema path.
- Provides an `exec` command for child processes such as `next build`.
- Converts relative SQLite URLs to absolute `file:` URLs for `next build`.
- Forces `NODE_ENV=production` for `next build` without forcing production DB
  mode.
- Creates the missing SQLite file before `migrate deploy` or `migrate status`.
- Allows consuming apps to keep their own env var names through config.

## Install From GitHub

Pin a released tag. That keeps consuming apps reproducible without publishing
this package to npm, and tags are immutable (see STANDARDS.md).

```sh
npm install github:andrewpopov/prisma-tools#v0.4.1
```

For deployment environments that should not require Git/SSH credentials, pin
the public GitHub archive URL for the same tag instead:

```sh
npm install https://github.com/andrewpopov/prisma-tools/archive/refs/tags/v0.4.1.tar.gz
```

## Expected Project Layout

The defaults assume this structure:

```text
.
├── .env
├── .env.local
├── .env.production
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   ├── dev.db
│   └── postgres/
│       ├── schema.prisma
│       └── migrations/
└── package.json
```

SQLite uses `prisma/schema.prisma` and `prisma/migrations`.
PostgreSQL uses `prisma/postgres/schema.prisma` and
`prisma/postgres/migrations`.

These paths can be changed with config.

## Environment Rules

Mode resolution:

- `--prod` or `--production` means production mode.
- `--dev` or `--development` means development mode.
- `PRISMA_TOOLS_ENV=prod` or `PRISMA_ENV=prod` means production mode.
- `PRISMA_TOOLS_ENV=dev` or `PRISMA_ENV=dev` means development mode.
- If no explicit mode is set, `NODE_ENV=production` means production mode.
- Otherwise the default mode is development.

An explicit mode outside `dev`, `development`, `prod`, or `production` is a
configuration error; it never silently falls back to another environment.

Env file loading:

- `.env` is loaded first.
- `.env.local` is loaded in development mode.
- `.env.production` is loaded in production mode.
- Existing caller-provided environment variables are not overwritten.
- Mode-specific env files can override values loaded from `.env`.
- `PRISMA_ENV_FILE` can point at a custom mode-specific env file.

Provider resolution:

- `PRISMA_TOOLS_DATABASE_PROVIDER=sqlite` forces SQLite.
- `PRISMA_TOOLS_DATABASE_PROVIDER=postgresql` or `postgres` forces PostgreSQL.
- `DATABASE_PROVIDER` works the same way.
- `DATABASE_URL=file:...` selects SQLite.
- `DATABASE_URL=postgres://...` or `postgresql://...` selects PostgreSQL.
- Missing `DATABASE_URL` defaults to SQLite for `format`, `generate`,
  `validate`, and `exec`.

The resolved mode and provider are written back to `PRISMA_TOOLS_ENV` and
`PRISMA_TOOLS_DATABASE_PROVIDER` by default.

## CLI Usage

Run Prisma through the wrapper:

```sh
npx prisma-tools generate
npx prisma-tools validate
npx prisma-tools migrate dev
npx prisma-tools migrate status
npx prisma-tools --prod migrate deploy
```

For schema-aware Prisma commands, the wrapper appends `--schema <path>` using
the selected provider. If the command already includes `--schema`, the wrapper
keeps the caller-provided value.

Run a child command through the wrapper:

```sh
npx prisma-tools exec npx next build
npx prisma-tools exec npm run some-script
```

`exec npx next build` gets special handling:

- `NODE_ENV` is set to `production`.
- Relative SQLite `file:` URLs are rewritten to absolute paths.
- Database mode remains controlled by flags/env, so local SQLite builds do not
  accidentally become production PostgreSQL builds.

Use `--quiet` to hide the wrapper summary line:

```sh
npx prisma-tools --quiet generate
```

## Package Scripts

For a Next.js app, a typical setup looks like this:

```json
{
  "scripts": {
    "build": "prisma-tools generate && prisma-tools exec npx next build",
    "db:setup": "prisma-tools generate && prisma-tools migrate dev",
    "db:migrate:prod": "prisma-tools --prod migrate deploy",
    "db:studio": "prisma-tools studio"
  }
}
```

If your app needs compatibility env names or app-specific config, create a local
shim instead of calling the binary directly.

## App Compatibility Wrapper

This is the recommended pattern for apps that already expose their own env var
names:

```js
#!/usr/bin/env node

const { runCli } = require('@andrewpopov/prisma-tools');

const config = {
  envKeys: {
    mode: ['MY_APP_ENV', 'PRISMA_TOOLS_ENV', 'PRISMA_ENV'],
    provider: [
      'MY_APP_DATABASE_PROVIDER',
      'PRISMA_TOOLS_DATABASE_PROVIDER',
      'DATABASE_PROVIDER',
    ],
  },
  outputEnv: {
    mode: 'MY_APP_ENV',
    provider: 'MY_APP_DATABASE_PROVIDER',
  },
};

try {
  const status = runCli(process.argv.slice(2), { config });
  process.exit(status);
} catch (error) {
  console.error(`[prisma-db] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
```

Then use the shim in `package.json`:

```json
{
  "scripts": {
    "build": "node scripts/tools/prisma-db.js generate && node scripts/tools/prisma-db.js exec npx next build",
    "db:setup": "node scripts/tools/prisma-db.js generate && node scripts/tools/prisma-db.js migrate dev",
    "db:migrate:prod": "node scripts/tools/prisma-db.js --prod migrate deploy"
  }
}
```

## Configuration

All config fields are optional:

```js
const config = {
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
```

Set `outputEnv.mode` or `outputEnv.provider` to `null` if the wrapper should not
write those resolved values back into the command environment.

## Programmatic API

```js
const {
  absoluteSqliteUrl,
  buildExecEnv,
  parseArgs,
  providerFromUrl,
  resolveContext,
  resolveMode,
  runCli,
} = require('@andrewpopov/prisma-tools');
```

Common uses:

- `runCli(argv, runtime)`: run the wrapper and return the child exit status.
- `resolveContext(options)`: inspect mode, provider, schema, migrations, and
  database URL without spawning Prisma.
- `providerFromUrl(databaseUrl, env, envKeys)`: detect SQLite vs PostgreSQL.
- `resolveMode(explicitMode, env, envKeys)`: detect dev vs prod mode.
- `absoluteSqliteUrl(databaseUrl, cwd)`: rewrite relative SQLite `file:` URLs.

The `runtime` object accepted by `runCli` is primarily for tests and shims:

```js
runCli(['generate'], {
  cwd: process.cwd(),
  env: process.env,
  config,
});
```

### Contract: `resolveContext`/`runCli` mutate the passed `env`

`resolveContext` (and, through it, `runCli`) **mutates the `env` object you
pass in.** It loads values from `.env` / the mode-specific env file into `env`,
and writes the resolved `mode` and `provider` back onto `env` (via
`config.outputEnv.mode` / `config.outputEnv.provider`, unless you set those to
`null`). This is intentional: it lets a caller inspect the resolved
mode/provider afterward and lets child processes started later in the same
process (e.g. via `exec`) see the loaded env values. If you need to keep the
caller's original env untouched, pass a copy (`{ ...process.env }`) instead of
the live object.

## Non-goals

This package intentionally does not try to do everything a full Prisma
tooling layer might:

- **No MySQL support.** Only `sqlite` and `postgresql`/`postgres` are
  recognized providers; anything else throws.
- **No `migrate diff` schema handling.** `migrate diff` is deliberately
  excluded from schema-arg auto-appending (see `shouldAppendSchemaArg`) since
  its schema semantics differ from the other `migrate` subcommands.
- **No monorepo / multi-schema support.** One SQLite schema and one PostgreSQL
  schema per config; apps with more complex layouts should wrap this package
  rather than ask it to grow that capability.

## Notes For Consumers

## Verify locally

```bash
npm ci
npm run verify
```

- Keep the dependency pinned to a released tag (`#vX.Y.Z`) or the matching
  archive URL.
- Re-run `npm install` in each consuming app after changing the pin.
- Prefer a local shim when an app needs stable compatibility env names.
- Keep schema and migration paths explicit in config if your project layout does
  not match the defaults.
- This package expects Prisma to be installed in the consuming project.

## Project policies

See [Contributing](./CONTRIBUTING.md), [Support](./SUPPORT.md), and the
[Security Policy](./SECURITY.md). This package is licensed under [MIT](./LICENSE).
