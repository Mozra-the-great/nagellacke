#!/usr/bin/env node
// Prints the job matrix for the weekly mutation run (.github/workflows/mutation.yml, #498)
// as JSON: one entry per file in the `mutate` list of every stryker.config.json, so the
// scope lives in exactly one place (the configs) and a file added there is mutated by the
// next weekly run without touching the workflow. One job per file keeps each below the
// runtime limit; the largest files take the longest.
//
// usage: node scripts/mutation-matrix.mjs     (from v3/)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaces = ['packages/core', 'server'];

const include = [];
for (const workspace of workspaces) {
  const config = JSON.parse(readFileSync(resolve(root, workspace, 'stryker.config.json'), 'utf8'));
  for (const entry of config.mutate ?? []) {
    const file = entry.replace(/:\d+-\d+$/, ''); // tolerate `file:from-to` ranges
    include.push({ workspace, file, name: `${workspace.replace('/', '-')}-${file.replace(/^src\//, '').replace(/\.ts$/, '')}` });
  }
}
console.log(JSON.stringify({ include }));
