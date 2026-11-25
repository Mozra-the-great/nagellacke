#!/usr/bin/env node
// Prints, for one workspace, the files of its Stryker `mutate` list (stryker.config.json)
// that differ between a base ref and HEAD, as a comma-separated list relative to the
// workspace - the value `stryker run --mutate` takes. Prints nothing when none changed.
//
// Used by the `mutation` job in .github/workflows/ci.yml (#498) so a PR only mutates the
// scoped files it touched. The scope lives in exactly one place, the config's `mutate`
// array; this script only intersects it with the diff.
//
// usage: node scripts/mutation-changed.mjs <workspace-dir> <base-ref>
//   e.g. node scripts/mutation-changed.mjs server origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const [workspace, base] = process.argv.slice(2);
if (!workspace || !base) {
  console.error('usage: mutation-changed.mjs <workspace-dir> <base-ref>');
  process.exit(2);
}

const dir = resolve(workspace);
const config = JSON.parse(readFileSync(resolve(dir, 'stryker.config.json'), 'utf8'));
const scoped = new Set(
  (config.mutate ?? []).map((p) => p.replace(/:\d+-\d+$/, '')), // tolerate `file:from-to` ranges
);

// Three-dot: what the PR changed relative to the merge base, not what main gained since.
const diff = execFileSync('git', ['diff', '--name-only', '--relative', `${base}...HEAD`, '--', '.'], {
  cwd: dir,
  encoding: 'utf8',
});
const changed = diff
  .split(/\r?\n/)
  .filter(Boolean)
  .map((f) => relative(dir, resolve(dir, f)).split(sep).join('/'))
  .filter((f) => scoped.has(f));

if (changed.length > 0) console.log(changed.join(','));
