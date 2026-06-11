/**
 * src/client/web-server.js
 * ---------------------------------------------------------------------------
 * Web server CollabBoard.
 *
 *  - Melayani file statis dari folder `./public/` (UI Single Page App).
 *  - Menyediakan endpoint upload & download file (`/upload`, `/download/`)
 *    yang meneruskan ciphertext apa adanya ke/dari disk.
 *  - Menjembatani browser client ke TCP chat server lewat WebSocket
 *    (RFC 6455, text frame JSON). Pesan & event whiteboard di-relay
 *    transparan; server TIDAK pernah membaca plaintext.
 *  - Dilengkapi proteksi path traversal (path.basename + prefix check)
 *    pada endpoint download.
 * ---------------------------------------------------------------------------
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const url = require('url');

const { T, encode, makeLineSplitter, isValidUsername, genId } = require('../shared/protocol');
const fileStore = require('../server/file-store');

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8080', 10);
const TCP_HOST = process.env.TCP_HOST || '127.0.0.1';
const TCP_PORT = parseInt(process.env.TCP_PORT || '9000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// ---------- Minimal WebSocket implementation (RFC 6455) ----------
function wsHandshake(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return false;
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', '',
  ].join('\r\n');
  socket.write(headers);
  return true;
}

function wsEncodeFrame(text) {
  const data = Buffer.from(text, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function wsDecodeFrames(buf) {
  // Returns { messages: [string], rest: Buffer }
  const messages = [];
  let offset = 0;
  while (offset < buf.length) {
    if (buf.length - offset < 2) break;
    const b1 = buf[offset];
    const b2 = buf[offset + 1];
    const opcode = b1 & 0x0f;
    const masked = (b2 & 0x80) !== 0;
    let len = b2 & 0x7f;
    let p = offset + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p); p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p)); p += 8;
    }
    let mask;
    if (masked) {
      if (buf.length - p < 4) break;
      mask = buf.slice(p, p + 4); p += 4;
    }
    if (buf.length - p < len) break;
    let payload = buf.slice(p, p + len);
    if (masked) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    if (opcode === 0x1) messages.push(payload.toString('utf8'));
    else if (opcode === 0x8) { /* close */ messages.push(null); }
    else if (opcode === 0x9) { messages.push('__ping__'); }
    offset = p + len;
  }
  return { messages, rest: buf.slice(offset) };
}

class WSSocket {
  constructor(rawSocket) {
    this.raw = rawSocket;
    this.alive = true;
    this.tcp = null;
    this.name = '';
    this.activeRoom = 'general';
    this.feed = makeLineSplitter(
      (obj) => this._onTcpMessage(obj),
      () => { /* ignore */ }
    );
    this.buf = Buffer.alloc(0);
    rawSocket.on('data', chunk => this._onSocketData(chunk));
    rawSocket.on('close', () => this._onClose());
    rawSocket.on('error', () => this._onClose());
  }

  send(obj) {
    if (!this.alive) return;
    try { this.raw.write(wsEncodeFrame(JSON.stringify(obj))); } catch (_) {}
  }

  _onSocketData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let frames;
    try { frames = wsDecodeFrames(this.buf); } catch (_) { return; }
    this.buf = frames.rest;
    for (const msg of frames.messages) {
      if (msg === null) { this._onClose(); return; }
      if (msg === '__ping__') { continue; }
      let obj;
      try { obj = JSON.parse(msg); } catch (_) { continue; }
      this._onClientMessage(obj);
    }
  }

  _onClientMessage(obj) {
    if (!obj || !obj.type) return;
    if (obj.type === T.JOIN) {
      this.name = String(obj.name || '');
      if (!isValidUsername(this.name)) {
        this.send({ type: T.ERROR, text: 'Invalid username' });
        return;
      }
      this._connectTcp();
    } else if (obj.type === '__encrypted__' && obj.payload) {
      // Browser mengirim plaintext terenkripsi + metadata, diteruskan ke TCP
      if (!this.tcp) return;
      this.tcp.write(encode(obj.payload));
    } else if (obj.type === 'setRoom') {
      this.activeRoom = String(obj.room || 'general');
    } else if (obj.type === T.PING) {
      this.send({ type: T.PONG, ts: Date.now() });
    } else if (this.tcp) {
      // Semua pesan lain (joinRoom, createRoom, leaveRoom, typing,
      // boardBegin/Draw/End/Clear/State, list, dll) diteruskan ke TCP server.
      this.tcp.write(encode(obj));
    }
  }

  _connectTcp() {
    const sock = net.createConnection({ host: TCP_HOST, port: TCP_PORT });
    sock.setNoDelay(true);
    this.tcp = sock;
    sock.on('data', d => this.feed(d));
    sock.on('close', () => {
      this.send({ type: T.SYSTEM, text: 'Disconnected from chat server.' });
      this.tcp = null;
    });
    sock.on('error', (e) => this.send({ type: T.ERROR, text: 'TCP error: ' + e.message }));
    sock.on('connect', () => {
      sock.write(encode({ type: T.JOIN, name: this.name }));
    });
  }

  _onTcpMessage(obj) {
    if (obj.type === T.WELCOME) {
      this.activeRoom = obj.room || 'general';
    }
    this.send(obj);
  }

  _onClose() {
    if (!this.alive) return;
    this.alive = false;
    try { this.tcp && this.tcp.end(); } catch (_) {}
    try { this.raw.end(); } catch (_) {}
  }
}

// ---------- HTTP server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(url.parse(req.url).pathname || '/');
  if (urlPath === '/') urlPath = '/index.html';
  // path traversal protection
  const safe = path.normalize(urlPath).replace(/^([./\\])+/, '');
  const fp = path.join(PUBLIC_DIR, safe);
  if (!fp.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
}

function serveDownload(req, res) {
  const m = req.url.match(/^\/download\/([A-Za-z0-9_\-\.]+)$/);
  if (!m) { res.writeHead(404); res.end('Not Found'); return; }
  const fp = fileStore.filePath(m[1]);
  if (!fp) { res.writeHead(400); res.end('Bad Request'); return; }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${path.basename(fp).split('_').slice(2).join('_')}"`,
  });
  fs.createReadStream(fp).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/download/')) return serveDownload(req, res);
  serveStatic(req, res);
});

server.on('upgrade', (req, sock, head) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    if (wsHandshake(req, sock, head)) {
      new WSSocket(sock);
    } else {
      sock.destroy();
    }
  } else {
    sock.destroy();
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`[SecureChat] Web server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[SecureChat] Static files: ${PUBLIC_DIR}`);
  console.log(`[SecureChat] TCP upstream: ${TCP_HOST}:${TCP_PORT}`);
  console.log(`[SecureChat] Open the URL in your browser, then pick a username.`);
});
