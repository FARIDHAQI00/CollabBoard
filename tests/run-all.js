/**
 * tests/run-all.js
 * ---------------------------------------------------------------------------
 * Test runner sederhana: menjalankan test files via `node --test`.
 * Cara pakai:
 *   node tests/run-all.js            -> semua (unit + integration + e2e)
 *   node tests/run-all.js unit       -> unit saja
 *   node tests/run-all.js integration
 *   node tests/run-all.js e2e
 *
 * Tidak butuh dependency tambahan; murni pakai `node --test` (Node >=16).
 * ---------------------------------------------------------------------------
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

const which = (process.argv[2] || 'all').toLowerCase();
const root = path.join(__dirname);

const groups = {
  unit:        path.join(root, 'unit'),
  integration: path.join(root, 'integration'),
  e2e:         path.join(root, 'e2e'),
};

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).map(f => path.join(dir, f));
}

let files = [];
if (which === 'all') {
  files = [].concat(listJs(groups.unit), listJs(groups.integration), listJs(groups.e2e));
} else if (groups[which]) {
  files = listJs(groups[which]);
} else {
  console.error(`Unknown group: ${which}. Use: unit | integration | e2e | all`);
  process.exit(1);
}

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

console.log(`\n== SecureChat test runner: ${which} (${files.length} file) ==\n`);

let pass = 0, fail = 0;
for (const f of files) {
  console.log(`\n--- ${path.relative(root, f)} ---`);
  const r = spawnSync(process.execPath, ['--test', f], { stdio: 'inherit' });
  if (r.status === 0) pass++; else fail++;
}

console.log(`\n== Summary ==`);
console.log(`Pass: ${pass}  Fail: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
