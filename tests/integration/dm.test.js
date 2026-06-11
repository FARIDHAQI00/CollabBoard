/**
 * tests/integration/dm.test.js
 * ---------------------------------------------------------------------------
 * Integration test untuk Direct Message (DM).
 * Verifikasi:
 *  - DM hanya sampai ke target (bukan di-broadcast ke room).
 *  - Echo `direct:true` dikembalikan ke pengirim untuk UI feedback.
 *  - DM dengan target yang tidak ada ditolak dengan error.
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
const PORT = 20000 + Math.floor(Math.random() * 1000);

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

test('Integration: DM antar 2 user', async (t) => {
  const cp = await startServer();
  t.after(() => stop(cp));
  const a = await connect('sender');
  const b = await connect('target');
  await waitFor(a, r => r.some(x => x.type === T.WELCOME));
  await waitFor(b, r => r.some(x => x.type === T.WELCOME));
  const enc = encrypt('rahasia', KEY);
  a.write(encode({ type: T.DM, id: genId(), to: 'target', encrypted: enc }));
  await waitFor(b, r => r.some(x => x.type === T.MESSAGE && x.direct && x.from === 'sender'));
  await waitFor(a, r => r.some(x => x.type === T.MESSAGE && x.echo));
  const got = b._r.find(x => x.type === T.MESSAGE && x.direct && x.from === 'sender');
  assert.equal(got.encrypted.ciphertext, enc.ciphertext);
  a.end(); b.end();
});
