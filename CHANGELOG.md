# Changelog

## 0.4.1

- Reject unrecognized explicit Prisma modes from programmatic configuration or
  configured environment keys rather than silently falling back to a default.
- Add `npm run verify` for the local release gate.

All notable changes to `@andrewpopov/prisma-tools`. Versions are git tags
(`vX.Y.Z`); see STANDARDS.md.

## 0.4.0

Conformance with the shared package standards
(`agent_tools/knowledge/shared-package-standards.md`), standard 3: **bound every
external command with a timeout.**

- **Fix — spawned commands are now bounded.** Neither `prisma-tools exec <cmd>`
  nor the `prisma` invocation passed a process timeout, so a hung
  `prisma migrate deploy` or `next build` blocked a deploy indefinitely —
  `deploy-kit` drives both from its migrate/build hooks on the Pi. The bound is
  injected once at the single `spawnSync` choke point rather than at each call
  site. Default **30 minutes** (`next build` on a Pi is legitimately slow),
  `killSignal: 'SIGKILL'`; configurable via `runtime.commandTimeoutMs` and
  `PRISMA_TOOLS_COMMAND_TIMEOUT_MS`. An explicit per-call option still wins.
- **Fix — a timed-out command now says so.** `spawnSync` reports a timeout as
  `result.error` with code `ETIMEDOUT`, which both call sites rethrew raw,
  telling the operator nothing about which command hung. Both now go through one
  handler that names the command and the bound. Non-timeout spawn errors are
  rethrown unchanged.

No CLI flag: `prisma-tools` passes unrecognized arguments through to `prisma`, so
a new flag could collide with a prisma option.

## 0.3.0

Maturation pass: complete type coverage, a type-contract CI check, a
Windows/Node compat matrix, and several small robustness fixes surfaced while
writing tests for the previously-untested half of the surface. Additive and
back-compatible.

- **Fix:** `absoluteSqliteUrl` no longer truncates a `DATABASE_URL` query
  string at a second `?` (e.g. `file:./x.db?a=1?b=2&c=3`). Both
  `absoluteSqliteUrl` and `sqliteDatabasePath` now share one internal
  `parseSqliteFileUrl` helper; `sqliteDatabasePath` behavior is unchanged
  (it only ever used the first segment).
- **Fix:** `providerFromUrl` now throws a clear error
  (`Unsupported explicit database provider "<x>". Expected sqlite, postgres,
  or postgresql.`) for an explicit provider env value that is set but
  unrecognized (e.g. `DATABASE_PROVIDER=mongo`), instead of silently falling
  through to URL detection. A blank (`""`) explicit value still falls through
  as before.
- **Fix:** `defaultSqliteUrl` no longer risks crashing on a partial config
  object (e.g. `{}`); it now falls back to
  `DEFAULT_CONFIG.defaultSqlitePath` when `config.defaultSqlitePath` is unset.
- **Change:** `resolveMode` now normalizes `production`→`prod` and
  `development`→`dev` for an explicit mode, and passes `prod`/`dev` through
  unchanged. Any other explicit value (e.g. a typo) is no longer returned
  verbatim as a mode — it falls through to env/`NODE_ENV` resolution.
  `parseArgs` already only ever produced `dev`/`prod`, so this only affects
  direct programmatic callers of `resolveMode`.
- `resolvePrismaBin` (internal, not exported) is now platform-injectable:
  `runCli`'s `runtime.platform` (defaulting to `process.platform`) selects the
  `.cmd` binary names on Windows, making the Windows code path testable and
  exercised in CI.
- Completed `src/index.d.ts`: added the previously-missing
  `defaultSqliteUrl`, `ensureSqliteDatabaseFile`, `loadEnvFile`, and
  `sqliteDatabasePath` declarations; added `options` to
  `ResolvedPrismaToolsContext`; replaced the untyped `runCli` runtime
  parameter with a real `PrismaToolsRuntime` interface. No exports were
  removed or changed.
- Added `npm run verify:types` (`tsc --noEmit` against
  `scripts/types-consumer.ts`), a consumer-style contract test that fails CI
  if `src/index.d.ts` drifts from the JS surface. Added `typescript` as a
  devDependency. `verify:types` runs inside the required `test` CI job.
- CI: added a `compat` job (Ubuntu Node 20/22/24 + one Windows Node 20 leg)
  and a `ci-success` aggregation job. `compat`/`ci-success` are advisory for
  now — promote `ci-success` to the required branch-protection check (and
  drop `test`) if/when the full matrix should gate merges.
- Substantially expanded `src/__tests__/index.test.ts` to cover
  `parseArgs`, `sqliteDatabasePath`, `defaultSqliteUrl`,
  `ensureSqliteDatabaseFile`, `loadEnvFile`, `mergeConfig`, `hasSchemaArg`/
  `shouldAppendSchemaArg`, the `resolveContext` mutation/`PRISMA_ENV_FILE`/
  default-`DATABASE_URL` contract, `runCli`'s `exec` error paths, and
  `resolvePrismaBin`'s platform branches (indirectly, via `runCli`).
- README: install instructions now lead with a tag pin
  (`github:andrewpopov/prisma-tools#vX.Y.Z`); the archive-URL fallback (for
  environments without Git/SSH credentials) now points at a tag archive
  instead of a commit SHA. Documented the `resolveContext`/`runCli` env
  mutation contract and added a **Non-goals** section (no MySQL, no
  `migrate diff` schema handling, no monorepo/multi-schema support).

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
