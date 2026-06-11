/**
 * tests/e2e/ttl-verify.js
 * ---------------------------------------------------------------------------
 * Live check cepat: 2 client terhubung, kirim pesan dengan TTL=2 detik,
 * lalu verifikasi event `destroy` diterima kedua client dalam ~3 detik.
 *
 * Pass = destroy event diterima tepat waktu oleh sender + receiver.
 * Berguna untuk smoke test TtlManager di environment development.
 * ---------------------------------------------------------------------------
 */
'use strict';

const net = require('net');
const path = require('path');
const { fork } = require('child_process');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const serverPath = path.join(ROOT, 'src', 'server', 'server.js');

function startServer() {
  const proc = fork(serverPath, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  proc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  proc.stderr.on('data', (d) => process.stderr.write('[server:err] ' + d));
  return proc;
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: 9000 });
    const lines = [];
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try { lines.push(JSON.parse(line)); } catch (_) { /* ignore */ }
      }
    });
    sock.on('error', reject);
    sock.on('connect', () => {
      sock.write(JSON.stringify({ type: 'join', name }) + '\n');
      // give welcome
      setTimeout(() => resolve({ sock, lines }), 80);
    });
  });
}

function waitFor(lines, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = setInterval(() => {
      for (const l of lines) {
        if (predicate(l)) {
          clearInterval(tick);
          return resolve(l);
        }
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(tick);
        return reject(new Error('timeout waiting for predicate'));
      }
    }, 30);
  });
}

(async function main() {
  const server = startServer();
  // wait for server
  await new Promise((r) => setTimeout(r, 600));

  const a = await connectClient('alice');
  const b = await connectClient('bob');

  // wait welcome
  await waitFor(a.lines, (m) => m.type === 'welcome', 2000);
  await waitFor(b.lines, (m) => m.type === 'welcome', 2000);

  const id = 'ttl-test-' + Date.now();
  const sentAt = Date.now();
  a.sock.write(JSON.stringify({
    type: 'message',
    room: 'general',
    id,
    encrypted: { iv: 'x', authTag: 'y', ciphertext: 'z' },
    ttl: 2,
  }) + '\n');

  // both should see roomMessage
  const mA = await waitFor(a.lines, (m) => m.type === 'roomMessage' && m.id === id, 2000);
  const mB = await waitFor(b.lines, (m) => m.type === 'roomMessage' && m.id === id, 2000);
  assert.equal(mA.id, id);
  assert.equal(mB.id, id);

  // both should see destroy
  const dA = await waitFor(a.lines, (m) => m.type === 'destroy' && m.id === id, 5000);
  const dB = await waitFor(b.lines, (m) => m.type === 'destroy' && m.id === id, 5000);
  const elapsed = Date.now() - sentAt;
  console.log(`destroy received in ~${elapsed}ms (expected ~2000ms)`);
  assert.equal(dA.id, id);
  assert.equal(dB.id, id);
  assert.ok(elapsed >= 1900 && elapsed <= 4500, `destroy timing off: ${elapsed}ms`);

  a.sock.destroy();
  b.sock.destroy();
  server.kill('SIGTERM');
  console.log('TTL E2E VERIFY: OK');
  process.exit(0);
})().catch((err) => {
  console.error('TTL E2E VERIFY FAILED:', err.message);
  process.exit(1);
});
