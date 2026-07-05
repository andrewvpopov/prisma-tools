# @andrewvpopov/prisma-tools

Reusable Prisma environment and command wrapper utilities for Next.js apps that
need to switch safely between SQLite and PostgreSQL.

## Responsibilities

- Resolve `dev`/`prod` mode from flags or environment.
- Load `.env`, `.env.local`, and `.env.production` predictably.
- Detect SQLite vs PostgreSQL from `DATABASE_URL`.
- Select the matching Prisma schema and migrations directory.
- Run Prisma commands with the correct generated schema.
- Run child commands through `exec`, including `next build`.
- Normalize relative SQLite URLs for build workers.
- Keep `next build` in production `NODE_ENV` without forcing production DB mode.

## Install From GitHub

```sh
npm install github:andrewvpopov/prisma-tools#<commit-sha>
```

## CLI

```sh
prisma-tools generate
prisma-tools migrate dev
prisma-tools --prod migrate deploy
prisma-tools exec npx next build
```

By default the wrapper reads `PRISMA_TOOLS_ENV`, `PRISMA_ENV`,
`PRISMA_TOOLS_DATABASE_PROVIDER`, and `DATABASE_PROVIDER`, then writes resolved
values back to `PRISMA_TOOLS_ENV` and `PRISMA_TOOLS_DATABASE_PROVIDER`.

Consumers can pass config to keep their own compatibility env names:

```js
const { runCli } = require('@andrewvpopov/prisma-tools');

runCli(process.argv.slice(2), {
  config: {
    envKeys: {
      mode: ['MY_APP_ENV', 'PRISMA_TOOLS_ENV'],
      provider: ['MY_APP_DATABASE_PROVIDER', 'DATABASE_PROVIDER'],
    },
    outputEnv: {
      mode: 'MY_APP_ENV',
      provider: 'MY_APP_DATABASE_PROVIDER',
    },
  },
});
```
