/**
 * tests/e2e/e2e.test.js
 * ---------------------------------------------------------------------------
 * E2E test lengkap: spawn server, simulasi 3 user (alice, bob, charlie),
 * verifikasi alur: join -> broadcast -> DM -> room -> TTL self-destruct.
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
const PORT = 22000 + Math.floor(Math.random() * 1000);

let serverCp;
test.before(async () => {
  serverCp = await new Promise((resolve, reject) => {
    const cp = require('child_process').spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT), TTL_CLEANUP_INTERVAL: '500' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    cp.stdout.on('data', d => { buf += d.toString(); if (buf.includes('listening')) resolve(cp); });
    cp.stderr.on('data', d => process.stderr.write('[server] ' + d));
    setTimeout(() => reject(new Error('server timeout')), 5000);
  });
});
test.after(() => {
  return new Promise(r => {
    if (!serverCp) return r();
    serverCp.on('exit', () => r());
    serverCp.kill('SIGINT');
    setTimeout(() => { try { serverCp.kill('SIGKILL'); } catch (_) {} r(); }, 1500);
  });
});

function client(name) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      sock.write(encode({ type: T.JOIN, name }));
      const r = [];
      const feed = makeLineSplitter(o => r.push(o));
      sock.on('data', d => feed(d));
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
function clearReceived(sock) { sock._r.length = 0; }

test('E2E: full flow (join, broadcast, DM, room, TTL)', async (t) => {
  const alice = await client('alice');
  const bob   = await client('bob');
  const charlie = await client('charlie');
  t.after(() => { alice.end(); bob.end(); charlie.end(); });

  await waitFor(alice, r => r.some(x => x.type === T.WELCOME));
  await waitFor(bob,   r => r.some(x => x.type === T.WELCOME));
  await waitFor(charlie, r => r.some(x => x.type === T.WELCOME));

  // 1) Broadcast message dari alice
  const e1 = encrypt('halo semua', KEY);
  alice.write(encode({ type: T.MESSAGE, id: genId(), room: 'general', encrypted: e1 }));
  await waitFor(bob, r => r.some(x => x.type === T.ROOM_MSG && x.from === 'alice'));
  await waitFor(charlie, r => r.some(x => x.type === T.ROOM_MSG && x.from === 'alice'));

  // 2) DM dari bob ke charlie
  clearReceived(charlie);
  const e2 = encrypt('priv charlie', KEY);
  bob.write(encode({ type: T.DM, id: genId(), to: 'charlie', encrypted: e2 }));
  await waitFor(charlie, r => r.some(x => x.type === T.MESSAGE && x.direct && x.from === 'bob'));
  // alice tidak boleh terima DM ini
  assert.equal(alice._r.find(x => x.type === T.MESSAGE && x.direct), undefined);

  // 3) Buat room 'design' & pesan di sana
  bob.write(encode({ type: T.CREATE_ROOM, room: 'design' }));
  charlie.write(encode({ type: T.JOIN_ROOM, room: 'design' }));
  await waitFor(bob, r => r.some(x => x.type === T.ROOMS && x.rooms.find(rr => rr.name === 'design')));
  const e3 = encrypt('desain-mockup', KEY);
  bob.write(encode({ type: T.MESSAGE, id: genId(), room: 'design', encrypted: e3 }));
  await waitFor(charlie, r => r.some(x => x.type === T.ROOM_MSG && x.room === 'design' && x.from === 'bob'));
  // alice tidak boleh terima (dia di general, bukan design)
  assert.equal(alice._r.find(x => x.type === T.ROOM_MSG && x.room === 'design'), undefined);

  // 4) Self-destruct message (TTL 2 detik)
  clearReceived(charlie);
  const ttlId = genId();
  const e4 = encrypt('akan hancur', KEY);
  charlie.write(encode({ type: T.MESSAGE, id: ttlId, room: 'design', encrypted: e4, ttl: 2 }));
  // Terima pesan
  await waitFor(bob, r => r.some(x => x.type === T.ROOM_MSG && x.id === ttlId));
  // Tunggu sinyal destroy dari server
  await waitFor(bob, r => r.some(x => x.type === T.DESTROY && x.id === ttlId), 5000);
});
