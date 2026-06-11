/**
 * tests/unit/rooms.test.js
 * ---------------------------------------------------------------------------
 * Unit tests untuk Rooms.
 * ---------------------------------------------------------------------------
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Rooms } = require('../../src/server/rooms');

function makeSock() { return { rooms: new Set(), _sent: [] }; }
function makeIo() { return { sendTo: (s, o) => s._sent.push(o) }; }

test('Rooms: default general dibuat saat init', () => {
  const io = makeIo();
  const r = new Rooms(io);
  const list = r.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'general');
});

test('Rooms: join + broadcast', () => {
  const io = makeIo();
  const r = new Rooms(io);
  const a = makeSock(); const b = makeSock();
  r.join(a, 'general');
  r.join(b, 'general');
  const n = r.broadcastToRoom('general', { type: 'roomMessage', text: 'hi' }, null);
  assert.equal(n, 2);
  assert.equal(a._sent.length, 1);
  assert.equal(b._sent.length, 1);
});

test('Rooms: broadcast tidak kirim ke pengirim jika except=...', () => {
  const io = makeIo();
  const r = new Rooms(io);
  const a = makeSock(); const b = makeSock();
  r.join(a, 'general'); r.join(b, 'general');
  r.broadcastToRoom('general', { type: 'x' }, a);
  assert.equal(a._sent.length, 0);
  assert.equal(b._sent.length, 1);
});

test('Rooms: history bounded', () => {
  const io = makeIo();
  const r = new Rooms(io);
  for (let i = 0; i < 350; i++) r.pushHistory('general', { id: i });
  // HISTORY_LIMIT default 300
  assert.ok(r.getHistory('general', 1000).length <= 300);
});

test('Rooms: leaveAll bersihkan semua membership', () => {
  const io = makeIo();
  const r = new Rooms(io);
  const a = makeSock();
  r.join(a, 'general');
  r.join(a, 'dev');
  r.leaveAll(a);
  assert.equal(r.rooms.get('general').members.size, 0);
  assert.equal(r.rooms.get('dev').members.size, 0);
  assert.equal(a.rooms.size, 0);
});
