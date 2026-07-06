# Changelog

All notable changes to `@andrewpopov/prisma-tools`. Versions are git tags
(`vX.Y.Z`); see STANDARDS.md.

## 0.2.3

- Renamed package scope `@andrewvpopov/*` -> `@andrewpopov/*` after consolidating the GitHub org into the `andrewpopov` user. No runtime or API change; update imports and the `github:` install path to `andrewpopov/prisma-tools`.

## 0.2.2

Release-process hardening (from a Codex review of the pilot). No runtime API
change; only `engines` is new for consumers.

- CI now runs on `v*` tags with a `release-guard` job asserting the tag matches
  `package.json` version and has a CHANGELOG entry — tags are the shipped
  artifact, so they are gated.
- CI runs on the engines floor (Node 20); added `engines.node >=20`.
- `verify-pack` now asserts the declared `types` file actually ships and wraps
  `npm pack` in the cleanup path so a failed run leaves no stray tarball.
- Added a `resolveMode` blank-primary-key regression test alongside the
  provider one.

## 0.2.1

- Fix `firstEnvValue` to use truthy fallback: a primary env key that is defined
  but blank (`""`) now falls through to the next key instead of short-circuiting,
  matching `env.A || env.B`. Restores the exact fallback behavior consumers that
  layer a primary var over a secondary (e.g. bewks' `BEWKS_ENV` over `PRISMA_ENV`)
  depend on. Caught in the bewks adoption review (BWK-87). No effect on non-blank
  values.

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
