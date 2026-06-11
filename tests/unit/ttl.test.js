/**
 * tests/unit/ttl.test.js
 * ---------------------------------------------------------------------------
 * Unit tests untuk TtlManager.
 * ---------------------------------------------------------------------------
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TtlManager } = require('../../src/server/ttl-manager');

function makeSock() { return { _sent: [] }; }
function makeIo() { return { sendTo: (s, o) => s._sent.push(o) }; }

test('TtlManager: tambah entry, sweep saat expire', async () => {
  const io = makeIo();
  let onEx = 0;
  const t = new TtlManager(io, { onExpire: () => onEx++, intervalMs: 999999 });
  const a = makeSock(); const b = makeSock();
  t.add('m1', 1, new Set([a, b]), { scope: 'room' });
  assert.equal(t.stats().count, 1);
  // belum expire
  t.forceSweep();
  assert.equal(a._sent.length, 0);
  // tunggu 1.1 detik lalu sweep
  await new Promise(r => setTimeout(r, 1100));
  t.forceSweep();
  assert.equal(a._sent.length, 1);
  assert.equal(a._sent[0].type, 'destroy');
  assert.equal(a._sent[0].id, 'm1');
  assert.equal(b._sent.length, 1);
  assert.equal(onEx, 1);
  assert.equal(t.stats().count, 0);
  t.shutdown();
});

test('TtlManager: hapus manual', () => {
  const io = makeIo();
  const t = new TtlManager(io, { intervalMs: 999999 });
  const a = makeSock();
  t.add('m1', 60, new Set([a]), { scope: 'dm' });
  assert.equal(t.stats().count, 1);
  t.remove('m1');
  assert.equal(t.stats().count, 0);
  t.shutdown();
});

test('TtlManager: tidak menambah entry dengan ttl <= 0', () => {
  const io = makeIo();
  const t = new TtlManager(io, { intervalMs: 999999 });
  const a = makeSock();
  t.add('m1', 0, new Set([a]));
  t.add('m2', -5, new Set([a]));
  assert.equal(t.stats().count, 0);
  t.shutdown();
});
