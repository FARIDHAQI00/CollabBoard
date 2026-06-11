/**
 * tests/integration/board.test.js
 * ---------------------------------------------------------------------------
 * Integration test untuk fitur board (whiteboard kolaboratif).
 * Verifikasi:
 *  - Event boardBegin / boardDraw / boardEnd / boardClear / boardTool
 *    di-broadcast ke semua member room, termasuk sender (echo).
 *  - Semua titik boardDraw sampai ke recipient tanpa ada yang hilang.
 * ---------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const path = require('path');
const { T, encode, makeLineSplitter, genId } = require('../../src/shared/protocol');

const SERVER_PATH = path.join(__dirname, '..', '..', 'src', 'server', 'server.js');
const PORT = 23000 + Math.floor(Math.random() * 1000);

let serverCp;

test.before(async () => {
  serverCp = await new Promise((resolve, reject) => {
    const cp = require('child_process').spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT) },
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

function makeClient(name) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port: PORT }, () => {
      const received = [];
      const feed = makeLineSplitter(
        (obj) => received.push(obj),
        () => {}
      );
      sock.on('data', d => feed(d));
      sock.on('error', () => {});
      sock.write(encode({ type: T.JOIN, name }));
      // wait for welcome
      const t = setInterval(() => {
        const w = received.find(m => m.type === T.WELCOME);
        if (w) { clearInterval(t); resolve({ sock, received }); }
      }, 20);
      setTimeout(() => { clearInterval(t); reject(new Error('no welcome')); }, 3000);
    });
  });
}

function waitFor(received, predicate, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      const found = received.find(predicate);
      if (found) { clearInterval(t); resolve(found); }
    }, 20);
    setTimeout(() => { clearInterval(t); reject(new Error('timeout')); }, ms);
  });
}

test('boardBegin: broadcast to all room members (including sender)', async () => {
  const a = await makeClient('alice1');
  const b = await makeClient('bob1');
  a.sock.write(encode({ type: T.BOARD_BEGIN, room: 'general', x: 10, y: 20, color: '#ff0000', size: 3, tool: 'pen' }));
  const aMsg = await waitFor(a.received, m => m.type === T.BOARD_BEGIN);
  const bMsg = await waitFor(b.received, m => m.type === T.BOARD_BEGIN);
  assert.equal(aMsg.x, 10);
  assert.equal(aMsg.y, 20);
  assert.equal(aMsg.from, 'alice1');
  assert.equal(bMsg.x, 10);
  assert.equal(bMsg.from, 'alice1');
  a.sock.destroy();
  b.sock.destroy();
});

test('boardDraw: all room members receive every point', async () => {
  const a = await makeClient('alice2');
  const b = await makeClient('bob2');
  a.sock.write(encode({ type: T.BOARD_DRAW, room: 'general', x: 30, y: 40, color: '#fff', size: 3, tool: 'pen' }));
  a.sock.write(encode({ type: T.BOARD_DRAW, room: 'general', x: 31, y: 41, color: '#fff', size: 3, tool: 'pen' }));
  const aMsgs = await Promise.all([
    waitFor(a.received, m => m.type === T.BOARD_DRAW && m.x === 30),
    waitFor(a.received, m => m.type === T.BOARD_DRAW && m.x === 31),
  ]);
  const bMsgs = await Promise.all([
    waitFor(b.received, m => m.type === T.BOARD_DRAW && m.x === 30),
    waitFor(b.received, m => m.type === T.BOARD_DRAW && m.x === 31),
  ]);
  assert.equal(aMsgs.length, 2);
  assert.equal(bMsgs.length, 2);
  a.sock.destroy();
  b.sock.destroy();
});

test('boardEnd: broadcast to all members', async () => {
  const a = await makeClient('alice3');
  const b = await makeClient('bob3');
  a.sock.write(encode({ type: T.BOARD_END, room: 'general' }));
  const aMsg = await waitFor(a.received, m => m.type === T.BOARD_END);
  const bMsg = await waitFor(b.received, m => m.type === T.BOARD_END);
  assert.equal(aMsg.from, 'alice3');
  assert.equal(bMsg.from, 'alice3');
  a.sock.destroy();
  b.sock.destroy();
});

test('boardClear: broadcast to all members', async () => {
  const a = await makeClient('alice4');
  const b = await makeClient('bob4');
  a.sock.write(encode({ type: T.BOARD_CLEAR, room: 'general' }));
  const aMsg = await waitFor(a.received, m => m.type === T.BOARD_CLEAR);
  const bMsg = await waitFor(b.received, m => m.type === T.BOARD_CLEAR);
  assert.equal(aMsg.from, 'alice4');
  assert.equal(bMsg.from, 'alice4');
  a.sock.destroy();
  b.sock.destroy();
});

test('boardTool: broadcast to all members (uses T.BOARD_TOOL constant)', async () => {
  const a = await makeClient('alice5');
  const b = await makeClient('bob5');
  a.sock.write(encode({ type: T.BOARD_TOOL, room: 'general', color: '#00ff00', size: 5 }));
  const aMsg = await waitFor(a.received, m => m.type === T.BOARD_TOOL);
  const bMsg = await waitFor(b.received, m => m.type === T.BOARD_TOOL);
  assert.equal(aMsg.color, '#00ff00');
  assert.equal(aMsg.size, 5);
  assert.equal(bMsg.color, '#00ff00');
  a.sock.destroy();
  b.sock.destroy();
});
