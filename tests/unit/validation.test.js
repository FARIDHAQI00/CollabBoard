/**
 * tests/unit/validation.test.js
 * ---------------------------------------------------------------------------
 * Unit tests untuk validation + protocol helpers.
 * ---------------------------------------------------------------------------
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const v = require('../../src/shared/validation');
const { T, encode, makeLineSplitter, sanitizeFilename, genId, isValidUsername, isValidRoom } =
  require('../../src/shared/protocol');

test('isValidUsername: pola regex', () => {
  assert.ok(isValidUsername('alice'));
  assert.ok(isValidUsername('Alice_99'));
  assert.ok(isValidUsername('a-b-c'));
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('a'.repeat(25)), false);
  assert.equal(isValidUsername('alice!'), false);
  assert.equal(isValidUsername('alice bob'), false);
});

test('isValidRoom: pola regex', () => {
  assert.ok(isValidRoom('general'));
  assert.ok(isValidRoom('dev-team'));
  assert.equal(isValidRoom(''), false);
  assert.equal(isValidRoom('a/b'), false);
  assert.equal(isValidRoom('a'.repeat(40)), false);
});

test('safeText: strip kontrol & batasi panjang', () => {
  assert.equal(v.safeText('halo\x00\x07\x1bdunia', 100), 'halodunia');
  const big = 'A'.repeat(5000);
  assert.equal(v.safeText(big, 100).length, 100);
});

test('validateTtl: hanya terima TTL positif, max 24 jam', () => {
  assert.equal(v.validateTtl(null), null);
  assert.equal(v.validateTtl(undefined), null);
  assert.equal(v.validateTtl(-1), null);
  assert.equal(v.validateTtl(0), null);
  assert.equal(v.validateTtl(30), 30);
  assert.equal(v.validateTtl(25 * 3600), 24 * 3600);
});

test('validateFileSize', () => {
  assert.equal(v.validateFileSize(1024, 2048), true);
  assert.equal(v.validateFileSize(2048, 2048), true);
  assert.equal(v.validateFileSize(2049, 2048), false);
  assert.equal(v.validateFileSize(-1, 100), false);
});

test('sanitizeFilename: hapus path traversal & karakter aneh', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a/b/c.txt'), 'c.txt');
  // karakter ! diganti _, spasi tetap
  assert.equal(sanitizeFilename('hello world!.txt'), 'hello world_.txt');
  assert.equal(sanitizeFilename(''), 'file');
  assert.equal(sanitizeFilename('..'), 'file');
});

test('encode + makeLineSplitter: round-trip', () => {
  const received = [];
  const feed = makeLineSplitter(o => received.push(o));
  const obj = { type: T.PING, x: 1 };
  const buf = encode(obj);
  feed(buf);
  feed(Buffer.from('more\n'));
  const obj2 = { type: T.PONG, y: 2 };
  feed(encode(obj2));
  assert.equal(received.length, 2);
  assert.equal(received[0].type, T.PING);
  assert.equal(received[1].type, T.PONG);
});

test('makeLineSplitter: handle JSON multiline yang datang sebagian', () => {
  const received = [];
  const feed = makeLineSplitter(o => received.push(o));
  const full = JSON.stringify({ a: 1, b: 'hi' });
  feed(Buffer.from(full.slice(0, 8)));
  feed(Buffer.from(full.slice(8) + '\n'));
  assert.equal(received.length, 1);
  assert.equal(received[0].a, 1);
});

test('genId: format string', () => {
  const id = genId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 5);
  // kemungkinan kecil tabrakan
  assert.notEqual(genId(), genId());
});
