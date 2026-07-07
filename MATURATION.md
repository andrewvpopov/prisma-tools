# Maturation Spec: @andrewpopov/prisma-tools

Roadmap from v0.2.3 to a stable v1.0. Grounded in the actual source as of
`fb771d5` (scope rename PR #3). This package is the **pilot** for the shared
`andrewpopov/*` package standards (STANDARDS.md, BWK-92), so its maturation
also matures the template every other package copies.

## 1. Current maturity

**Version:** 0.2.3, tags `v0.2.0`–`v0.2.3`, distributed as
`github:andrewpopov/prisma-tools#vX.Y.Z` (no npm registry, no build step —
plain JS + hand-written `src/index.d.ts` per STANDARDS "trivial glue" shape).

**What it is:** a Prisma *command wrapper*, not an ORM helper library. One
module (`src/index.js`, ~376 lines), one bin (`src/cli.js`), one runtime dep
(`dotenv`, used only for `.env` parsing). It provides:

- **Mode resolution** (`resolveMode`, `parseArgs`): `--prod`/`--dev` flags →
  configurable env keys (`PRISMA_TOOLS_ENV`, `PRISMA_ENV`) → `NODE_ENV`.
- **Layered env-file loading** (`loadEnvFile`, inside `resolveContext`):
  `.env` first, then `.env.local`/`.env.production` (or `PRISMA_ENV_FILE`)
  with override — but never clobbering vars the caller already had set.
- **Provider detection** (`providerFromUrl`): explicit provider env var, else
  `file:` → sqlite, `postgres(ql)://` → postgresql, else throw.
- **Schema/migrations selection**: sqlite → `prisma/schema.prisma` +
  `prisma/migrations`; postgres → `prisma/postgres/*`. Auto-appends
  `--schema` on the Prisma commands that accept it (`appendSchemaArg` /
  `shouldAppendSchemaArg` / `hasSchemaArg`).
- **SQLite URL/path handling**: `absoluteSqliteUrl` (relative `file:` →
  absolute, preserving `?query` and `:memory:`), `sqliteDatabasePath`,
  `ensureSqliteDatabaseFile` (touch the db file before
  `migrate deploy/status`), `defaultSqliteUrl` (fallback `DATABASE_URL` for
  connection-less commands: `format`/`generate`/`validate`/`exec`).
- **`exec` subcommand** (`runCli`, `buildExecEnv`, `isNextBuildCommand`):
  runs a child command with the resolved env; `exec npx next build` gets
  `NODE_ENV=production` + absolutized SQLite URL without flipping DB mode.
- **Config injection** (`mergeConfig`): consumers rename env keys/paths —
  this is how bewks keeps `BEWKS_ENV`/`BEWKS_DATABASE_PROVIDER`.

**Solid:** CI (`npm ci` → vitest → `verify:pack` on the Node 20 engines
floor), tag-triggered `release-guard` (tag == package.json version + CHANGELOG
entry), branch protection, immutable-tag policy, a genuinely good 278-line
README, dependency-injected internals (`fs`/`spawnSync`/`stdout` overridable)
that make the code very testable.

**Missing:** test coverage for roughly half the exported surface (§2), four
exports absent from `index.d.ts` (§3), a stale install section in the README
(§3), zero Windows coverage despite win32-specific code paths (§5), and only
**one adopter** — bewks, via its `scripts/tools/prisma-db.js` shim pinned to
`#v0.2.3` (§7).

## 2. Testing

12 tests (`src/__tests__/index.test.ts`) cover the happy paths well:
resolveContext dev/prod, provider detection, blank-env-key fallback
(the 0.2.1 regression), schema appending/dedup, custom env names, SQLite URL
normalization, next-build env rewrite, migrate-deploy file creation. Concrete
gaps, by utility:

**Untested exports (zero direct coverage):** `parseArgs`, `loadEnvFile`,
`sqliteDatabasePath`, `ensureSqliteDatabaseFile`, `defaultSqliteUrl`,
`firstEnvValue` (only via resolveMode/providerFromUrl), `mergeConfig`,
`hasSchemaArg`/`shouldAppendSchemaArg` (only via `appendSchemaArg`).

- **`parseArgs`**: flags-after-command semantics (`migrate dev --prod` puts
  `--prod` in `prismaArgs`, mode stays null — intended, but lock it in);
  empty argv → `['--help']`; `--quiet` combined with a mode flag.
- **`providerFromUrl`**: the throw path for unsupported schemes
  (`mysql://...`) is unexercised; an invalid explicit provider value
  (`DATABASE_PROVIDER=mongo`) silently falls through to URL detection —
  test-and-document, or make it throw.
- **URL/path normalization edge cases**: `file:` with query on
  `sqliteDatabasePath` (it splits `?`, untested); `file:` with an empty path;
  `absoluteSqliteUrl` with a path containing a second `?` (split limit 2 —
  correct, prove it); Windows drive-letter paths (`file:C:\...`) —
  `path.isAbsolute` only recognizes those *on* win32, so behavior is
  platform-dependent and currently unspecified.
- **`resolveContext`**: `PRISMA_ENV_FILE` override; default-`DATABASE_URL`
  injection for `format`/`generate`/`validate`/`exec` (and NOT for
  `migrate`); `outputEnv: { mode: null }` suppression; the documented
  env-mutation contract (it writes into the caller's `env` object).
- **`runCli` exec paths**: `exec` with no command throws; `exec -- cmd`
  strips the leading `--`; spawn `result.error` rethrow; non-zero and
  `null` child status (`?? 1`) propagation; `--quiet` suppressing the
  summary line.
- **`resolvePrismaBin`**: local `node_modules/.bin/prisma` vs `npx` fallback
  is untested, and the win32 `.cmd` branch keys off `process.platform`
  directly (not injectable) so it can only be covered by a Windows CI job or
  by injecting platform. Pick one (§5).
- **Cross-DB behavior**: unit tests fake `spawnSync`, so nothing proves the
  appended `--schema` path is one Prisma actually accepts per version. A
  small opt-in integration smoke (install `prisma`, run
  `prisma-tools validate` against a fixture sqlite + postgres schema pair)
  would catch Prisma CLI flag drift — the one failure class the current
  suite structurally cannot see.

Add a coverage gate (vitest `--coverage` + threshold) once the above lands;
the module is small enough that ~95% lines is realistic.

## 3. Docs & DX

- **README install section is stale and contradicts STANDARDS.md**: it says
  "Use a commit pin" / archive-URL with an example SHA, while STANDARDS.md
  mandates `#vX.Y.Z` tag pins and bewks actually pins `#v0.2.3`. Fix the
  README to lead with tag pins; keep the archive-URL variant as the
  no-git-credentials fallback (it's the Pi deploy story).
- **`index.d.ts` is incomplete**: `defaultSqliteUrl`,
  `ensureSqliteDatabaseFile`, `loadEnvFile`, `sqliteDatabasePath` are
  exported from `index.js` but missing from the declarations;
  `ResolvedPrismaToolsContext` omits the `options` field `resolveContext`
  actually returns; `runCli`'s `runtime` is typed `object` — give it a real
  `PrismaToolsRuntime` interface (`cwd`, `env`, `fs`, `spawnSync`, `stdout`,
  `config`). `verify-pack` asserts the types file *ships*; consider a
  `tsc --noEmit` check over a typed consumer snippet so it also stays
  *accurate*.
- Otherwise README is strong: layout, env rules, CLI usage, the bewks-style
  compatibility-shim pattern, and full config reference are all documented.
  One omission: the fact that `resolveContext`/`runCli` **mutate the passed
  env object** (write-back of mode/provider + loaded dotenv values) is
  implied but never stated. Document it as contract.

## 4. API stability & v1.0 criteria

The surface is coherent — everything serves "resolve env → pick schema → run
command" — but 17 exports is wide for a wrapper. The internals
(`loadEnvFile`, `mergeConfig`, `firstEnvValue`, `hasSchemaArg`,
`shouldAppendSchemaArg`, `sqliteDatabasePath`, `defaultSqliteUrl`,
`ensureSqliteDatabaseFile`) are exported mostly for testability. Before 1.0,
decide per export: public (document + keep stable) or internal (mark
`@internal` in the d.ts / README and reserve the right to change). Shrinking
the *committed* surface now is cheap; after 1.0 it's a major bump.

**v1.0 gate:**
1. Every remaining public export has direct tests (§2) and README/d.ts entries.
2. `index.d.ts` complete and consumer-typechecked.
3. README install docs match STANDARDS.md.
4. A second real adopter has run a release cycle against it (§7) — one
   consumer is not enough signal that the config surface generalizes.
5. Explicit statement of non-goals in README (no mysql, no `migrate diff`
   schema handling, no monorepo/multi-schema support) so scope pressure has
   a documented answer.

Post-1.0 discipline is already written down in STANDARDS.md (semver,
immutable tags, changelog-in-the-PR); adopt a one-line deprecation policy:
deprecated exports keep working for one minor, removed at the next major.

## 5. Release/CI hardening

Already good: `verify:pack` consumer smoke, `release-guard` tag gate, engines
floor pinned at Node 20, protected master. Remaining:

- **Windows**: the code carries win32 branches (`prisma.cmd`, `npx.cmd`,
  `isNextBuildCommand` matching `next.cmd`) that no CI executes. Either add a
  `windows-latest` job (fold into a `ci-success` aggregation job per the
  ci.yml comment about required-check naming) or explicitly declare Windows
  unsupported and delete the branches. Shipping untested platform code is the
  worst of both.
- **Node matrix**: floor-only is a deliberate, documented choice; revisit
  only if a version-specific behavior appears. Add Node 22/24 to the matrix
  when adding the aggregation job anyway — it's nearly free.
- **github:-tag discipline**: no `prepare` script, `files` limited to
  `src` + README, verify-pack proves the tarball — the committed-dist problem
  doesn't apply here (no build). Nothing to change; keep it that way.

## 6. Robustness / features / scope

It's a coherent toolkit, not a grab-bag — nothing to split out. Concrete
robustness gaps (all small):

- `resolveMode(explicitMode)` returns any truthy `explicitMode` verbatim;
  only `parseArgs` constrains it to `dev`/`prod`. Validate or type-narrow.
- Invalid explicit provider values silently fall through (§2) — decide
  throw-vs-fallback and test it.
- `absoluteSqliteUrl` / `sqliteDatabasePath` duplicate the `file:` parsing
  logic with subtly different `?`-split behavior (`split('?', 2)` vs
  `split('?')[0]`); unify into one parser.
- `isNextBuildCommand` misses `exec npm run build`-style indirection —
  fine, but document that only direct `next build` / `npx next build` get
  the special env.

Do **not** add: mysql/mongo providers, seed runners, Prisma client
singletons, or migration authoring helpers — no fleet consumer needs them
(cairn-api and smarthome use Prisma but single-provider, where this wrapper
adds nothing), and STANDARDS says keep engine packages near zero-dep.

## 7. Adoption

- **bewks** (only adopter): pins `#v0.2.3`, uses the documented shim pattern
  (`scripts/tools/prisma-db.js`) with `BEWKS_*` env names. Adoption already
  paid off — it caught the 0.2.1 blank-env-key regression.
- **cairn `packages/api`** and **smarthome** use Prisma today without the
  wrapper. Evaluate each honestly: the package's value is the
  sqlite-dev/postgres-prod dual-schema dance; a single-provider app gains
  only env-file layering. If neither is a genuine fit, the v1.0 "second
  adopter" gate can instead be satisfied by the next dual-provider app —
  don't force adoption to check a box.
- Onboarding friction is low (README shim pattern is copy-paste), but the
  stale commit-pin install docs are the first thing a new adopter reads —
  fix first (§3).

## Prioritized next actions

**P0 — correctness of what's already shipped**
1. Fix README install section: lead with `#vX.Y.Z` tag pins per STANDARDS.md;
   demote archive-URL to the credentials-free fallback.
2. Complete `index.d.ts`: add the 4 missing exports, `options` on
   `ResolvedPrismaToolsContext`, a real `runtime` type for `runCli`.
3. Add tests for the untested exports: `parseArgs`, `loadEnvFile`,
   `sqliteDatabasePath` (query strings, `:memory:`), `ensureSqliteDatabaseFile`,
   `providerFromUrl` throw path, `PRISMA_ENV_FILE`, exec error/exit-code paths.

**P1 — harden the contract**
4. Decide Windows: add a windows-latest CI job (with `ci-success` aggregation)
   or delete the win32 branches and state non-support.
5. Document the env-mutation contract and invalid-provider behavior; unify the
   duplicated `file:` URL parsing.
6. Classify each export public vs `@internal`; add a coverage threshold.

**P2 — road to v1.0**
7. Opt-in integration smoke running real `prisma validate` against sqlite +
   postgres fixture schemas (catches Prisma CLI flag drift).
8. Evaluate cairn-api / smarthome as adopters; if neither fits, note it and
   let the second-adopter gate wait for a dual-provider app.
9. Cut `v1.0.0` once §4's gate is met; add the deprecation-policy line to
   STANDARDS.md so the whole fleet inherits it.
