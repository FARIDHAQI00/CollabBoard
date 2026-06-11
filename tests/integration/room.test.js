/**
 * tests/integration/room.test.js
 * ---------------------------------------------------------------------------
 * Room isolation test.
 * ---------------------------------------------------------------------------
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const path = require('path');
const { T, encode, makeLineSplitter, genId } = require('../../src/shared/protocol');
const { encrypt } = require('../../src/server/crypto-utils');
const crypto = require('crypto');

const KEY = crypto.pbkdf2Sync('chat-encrypted-key-2026-komunikasi-data', Buffer.from('securechat-salt-v1'), 100_000, 32, 'sha256');
const SERVER_PATH = path.join(__dirname, '..', '..', 'src', 'server', 'server.js');
const PORT = 21000 + Math.floor(Math.random() * 1000);

function startServer() {
  return new Promise((resolve, reject) => {
    const cp = require('child_process').spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    cp.stdout.on('data', d => { buf += d.toString(); if (buf.includes('listening')) resolve(cp); });
    cp.stderr.on('data', d => process.stderr.write('[server] ' + d));
    setTimeout(() => reject(new Error('server timeout')), 5000);
  });
}
function stop(cp) {
  return new Promise(r => { cp.on('exit', () => r()); cp.kill('SIGINT'); setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} r(); }, 1500); });
}
function connect(name) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      sock.write(encode({ type: T.JOIN, name }));
      const r = [];
      sock.on('data', d => makeLineSplitter(o => r.push(o))(d));
      sock._r = r;
      resolve(sock);
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}
function waitFor(sock, p, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const t = setInterval(() => {
      if (p(sock._r)) { clearInterval(t); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(t); reject(new Error('waitFor timeout')); }
    }, 30);
  });
}

test('Integration: pesan room A tidak bocor ke user di room B', async (t) => {
  const cp = await startServer();
  t.after(() => stop(cp));
  const a = await connect('alpha');
  const b = await connect('beta');
  await waitFor(a, r => r.some(x => x.type === T.WELCOME));
  await waitFor(b, r => r.some(x => x.type === T.WELCOME));
  // alpha create/join 'private'
  a.write(encode({ type: T.CREATE_ROOM, room: 'private' }));
  // beta hanya di 'general'
  await waitFor(b, r => r.some(x => x.type === T.ROOMS && x.rooms.find(rr => rr.name === 'private')));
  // alpha kirim ke 'private'
  const enc = encrypt('hanya-untuk-private', KEY);
  a.write(encode({ type: T.MESSAGE, id: genId(), room: 'private', encrypted: enc }));
  // Tunggu sebentar
  await new Promise(r => setTimeout(r, 300));
  // beta HARUS tidak menerima roomMessage dari private
  const leaked = b._r.find(x => x.type === T.ROOM_MSG && x.room === 'private');
  assert.equal(leaked, undefined);
  // alpha harus menerima roomMessage miliknya sendiri (broadcast termasuk diri sendiri)
  const got = a._r.find(x => x.type === T.ROOM_MSG && x.room === 'private' && x.from === 'alpha');
  assert.ok(got);
  a.end(); b.end();
});

test('Integration: pindah room mengubah broadcast target', async (t) => {
  const cp = await startServer();
  t.after(() => stop(cp));
  const a = await connect('gamma');
  const b = await connect('delta');
  await waitFor(a, r => r.some(x => x.type === T.WELCOME));
  await waitFor(b, r => r.some(x => x.type === T.WELCOME));
  a.write(encode({ type: T.JOIN_ROOM, room: 'engineering' }));
  b.write(encode({ type: T.JOIN_ROOM, room: 'engineering' }));
  await waitFor(a, r => r.some(x => x.type === T.ROOMS && x.rooms.find(rr => rr.name === 'engineering' && rr.members >= 2)));
  // keduanya kirim ke engineering
  const enc1 = encrypt('msg-a', KEY);
  a.write(encode({ type: T.MESSAGE, id: genId(), room: 'engineering', encrypted: enc1 }));
  await waitFor(b, r => r.some(x => x.type === T.ROOM_MSG && x.room === 'engineering' && x.from === 'gamma'));
  a.end(); b.end();
});
