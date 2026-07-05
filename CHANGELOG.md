# Changelog

All notable changes to `@andrewvpopov/prisma-tools`. Versions are git tags
(`vX.Y.Z`); see STANDARDS.md.

## 0.2.0

Established as the reconciled source of truth over the bewks vendored copy
(`packages/prisma-tools`), which was an older fork that hardcoded `BEWKS_*` env
names and lacked schema-arg appending. This version is a strict superset:

- Configurable env var names via `config.envKeys` / `config.outputEnv`, so a
  consumer can keep its own compatibility names (e.g. bewks passes
  `BEWKS_ENV` / `BEWKS_DATABASE_PROVIDER`).
- Automatic `--schema` appending for the resolved schema on the Prisma commands
  that accept it (`generate`, `validate`, `format`, `studio`, `migrate
  deploy/dev/reset/resolve/status`, `db pull/push`), via `appendSchemaArg` /
  `shouldAppendSchemaArg` / `hasSchemaArg`.
- Added `firstEnvValue` helper.

### Release infrastructure (BWK-92)

- Added `.github/workflows/ci.yml`: `npm ci` → `npm test` → `verify:pack`.
- Added `scripts/verify-pack.mjs`: packs the tarball, installs it into a
  throwaway project, and requires it as a consumer would.
- Added STANDARDS.md documenting the shared-package release loop, immutable-tag
  rule, and the plain-JS-vs-committed-dist policy. This repo is the pilot.

## 0.1.0

Initial extraction from bewks `scripts/tools/prisma-db.js`: mode/env resolution,
SQLite/Postgres schema selection, wrapped Prisma commands, Next build env
normalization, `runCli` CLI.
