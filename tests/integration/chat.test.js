/**
 * tests/integration/chat.test.js
 * ---------------------------------------------------------------------------
 * Integration test: spawn TCP server (subprocess) di port random, lalu
 * hubungkan 2 client via raw socket dan verifikasi alur chat dasar
 * (join, broadcast pesan, sapaan sistem, daftar user).
 * ---------------------------------------------------------------------------
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const path = require('path');

const PORT = 19000 + Math.floor(Math.random() * 1000);
process.env.TTL_CLEANUP_INTERVAL = '60000';

const SERVER_PATH = path.join(__dirname, '..', '..', 'src', 'server', 'server.js');
const { T, encode, makeLineSplitter, genId } = require('../../src/shared/protocol');
const { encrypt } = require('../../src/server/crypto-utils');
const crypto = require('crypto');
const KEY = crypto.pbkdf2Sync('chat-encrypted-key-2026-komunikasi-data', Buffer.from('securechat-salt-v1'), 100_000, 32, 'sha256');

function startServer() {
  return new Promise((resolve, reject) => {
    const cp = require('child_process').spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    cp.stdout.on('data', d => { buf += d.toString(); if (buf.includes('listening')) resolve(cp); });
    cp.stderr.on('data', d => process.stderr.write('[server] ' + d));
    cp.on('exit', code => { reject(new Error('server exited code=' + code)); });
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
}

function stopServer(cp) {
  return new Promise(r => {
    cp.on('exit', () => r());
    try { cp.kill('SIGINT'); } catch (_) {}
    setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} r(); }, 1500);
  });
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      sock.write(encode({ type: T.JOIN, name }));
      const received = [];
      const feed = makeLineSplitter(o => received.push(o));
      sock.on('data', d => feed(d));
      sock._received = received;
      resolve(sock);
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

function waitFor(sock, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (predicate(sock._received)) { clearInterval(t); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error('waitFor timeout')); }
    }, 30);
  });
}

test('Integration: 2 client connect, broadcast pesan', async (t) => {
  const cp = await startServer();
  t.after(() => stopServer(cp));
  const a = await connect('alice_i');
  const b = await connect('bob_i');
  await waitFor(a, r => r.some(x => x.type === T.WELCOME));
  await waitFor(b, r => r.some(x => x.type === T.WELCOME));

  // alice kirim message
  const enc = encrypt('hello world', KEY);
  a.write(encode({ type: T.MESSAGE, id: genId(), room: 'general', encrypted: enc }));
  // bob harus menerima roomMessage
  await waitFor(b, r => r.some(x => x.type === T.ROOM_MSG && x.from === 'alice_i'));
  const msg = b._received.find(x => x.type === T.ROOM_MSG && x.from === 'alice_i');
  assert.equal(msg.encrypted.iv, enc.iv);
  assert.equal(msg.room, 'general');
  a.end(); b.end();
});
