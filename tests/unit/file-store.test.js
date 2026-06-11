/**
 * tests/unit/file-store.test.js
 * ---------------------------------------------------------------------------
 * Unit tests untuk file-store.
 * ---------------------------------------------------------------------------
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const store = require('../../src/server/file-store');

test('file-store: saveUploadFromBuffer membuat file di disk', async () => {
  const buf = Buffer.from('hello-world');
  const r = await store.saveUploadFromBuffer(buf, 'greeting.txt');
  assert.ok(r.storedName.endsWith('greeting.txt'));
  assert.ok(fs.existsSync(r.path));
  const back = fs.readFileSync(r.path);
  assert.equal(back.toString(), 'hello-world');
  // cleanup
  await store.removeFile(r.storedName);
});

test('file-store: filePath menolak path traversal', () => {
  assert.equal(store.filePath('../etc/passwd'), null);
  assert.equal(store.filePath('notimestamp_xx'), null);
  const ok = store.filePath('1700000000_abcdef_foo.txt');
  assert.ok(ok && ok.endsWith('foo.txt'));
});

test('file-store: saveUploadFromBuffer tolak file terlalu besar', async () => {
  const big = Buffer.alloc(100);
  const original = store.getMaxSize();
  store.setMaxSize(50);
  try {
    await assert.rejects(() => store.saveUploadFromBuffer(big, 'big.bin'));
  } finally {
    store.setMaxSize(original);
  }
});

test('file-store: removeFile untuk storedName invalid return false', async () => {
  assert.equal(await store.removeFile('../etc/passwd'), false);
  assert.equal(await store.removeFile('nope'), false);
});
