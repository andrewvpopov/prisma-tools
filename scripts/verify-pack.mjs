#!/usr/bin/env node
/**
 * Consumer-side release smoke test.
 *
 * Packs the package exactly as `npm publish` / a `github:` install would expose
 * it, installs the tarball into a throwaway project, and requires it the way a
 * consumer does. Catches the failure class that unit tests miss: files left out
 * of `files`, a broken `main`/`types`/`bin`, or a dependency that only resolves
 * inside the source tree.
 *
 * This script is the reference implementation referenced by STANDARDS.md and is
 * meant to be copied (with the require-smoke adjusted) into every shared package
 * repo. Run locally with `npm run verify:pack`; CI runs the same command.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
}

// 1. Pack the tarball the way a publish/github install would.
const packJson = run('npm', ['pack', '--json'], { cwd: repoRoot });
const tarball = JSON.parse(packJson)[0].filename;
const tarballPath = join(repoRoot, tarball);
console.log(`[verify-pack] packed ${tarball}`);

// 2. Install it into a throwaway consumer project.
const scratch = mkdtempSync(join(tmpdir(), 'verify-pack-'));
let failed = false;
try {
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'verify-pack-consumer', version: '0.0.0', private: true }, null, 2),
  );
  console.log(`[verify-pack] installing tarball into ${scratch}`);
  run('npm', ['install', '--no-audit', '--no-fund', tarballPath], { cwd: scratch });

  // 3. Require it as a consumer would and assert the public surface resolves.
  const smoke = `
    const t = require('${pkg.name}');
    const expected = ['runCli', 'mergeConfig', 'resolveMode', 'providerFromUrl'];
    const missing = expected.filter((k) => typeof t[k] !== 'function');
    if (missing.length) { throw new Error('missing exports: ' + missing.join(', ')); }
    console.log('[verify-pack] exports OK: ' + expected.join(', '));
  `;
  run('node', ['-e', smoke], { cwd: scratch, stdio: 'inherit' });

  // 4. Assert the declared bin resolves to a real file.
  const binSmoke = `require.resolve('${pkg.name}/${pkg.bin['prisma-tools'].replace(/^\.\//, '')}')`;
  run('node', ['-e', binSmoke], { cwd: scratch, stdio: 'inherit' });
  console.log('[verify-pack] bin resolves OK');

  console.log('[verify-pack] PASS');
} catch (err) {
  failed = true;
  console.error('[verify-pack] FAIL:', err.message);
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(tarballPath, { force: true });
}

process.exit(failed ? 1 : 0);
