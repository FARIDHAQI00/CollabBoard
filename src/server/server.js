/**
 * src/server/server.js
 * ---------------------------------------------------------------------------
 * Server TCP utama CollabBoard.
 *
 *  - Port default: 9000 (diambil dari env PORT)
 *  - Protokol: JSON newline-delimited (satu JSON per baris)
 *  - Mendukung multi-user, multi-room, DM, file sharing, pesan self-destruct
 *    (TTL), dan whiteboard kolaboratif (gambar real-time)
 *  - Server HANYA me-relay ciphertext; enkripsi/dekripsi terjadi di sisi
 *    client sehingga server tidak pernah melihat isi pesan asli.
 * ---------------------------------------------------------------------------
 */

'use strict';

const net = require('net');
const path = require('path');
const fs = require('fs');

// Load .env (sederhana, tanpa dependency)
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
})();

const { T, encode, makeLineSplitter, isValidUsername, isValidRoom, sanitizeFilename, genId } =
  require('../shared/protocol');
const { safeText, validateTtl, validateFileSize } = require('../shared/validation');
const { Rooms, DEFAULT_ROOM } = require('./rooms');
const { TtlManager } = require('./ttl-manager');
const fileStore = require('./file-store');

const PORT = parseInt(process.env.PORT || '9000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ---------- IO abstraction ----------
const io = {
  sendTo(socket, obj) {
    try { socket.write(encode(obj)); } catch (_) {}
  },
};

// ---------- Inisialisasi service ----------
const rooms = new Rooms(io);

const ttl = new TtlManager(io, {
  onExpire: (id, meta) => {
    if (meta && meta.fileStoredName) {
      fileStore.removeFile(meta.fileStoredName).catch(() => {});
    }
  },
});

const clients = new Map();   // socket -> { id, name, addr }
let nextClientId = 1;

// ---------- Util ----------
function findSocketByName(name) {
  for (const [sock, info] of clients) {
    if (info.name === name) return sock;
  }
  return null;
}

function userList() {
  const names = [];
  for (const info of clients.values()) names.push(info.name);
  return names;
}

function broadcastUserList() {
  const payload = { type: T.USERS, users: userList(), count: clients.size };
  for (const sock of clients.keys()) io.sendTo(sock, payload);
}

function broadcastRooms() {
  const payload = { type: T.ROOMS, rooms: rooms.list() };
  for (const sock of clients.keys()) io.sendTo(sock, payload);
}

function sendSystemTo(socket, text) {
  io.sendTo(socket, { type: T.SYSTEM, text: safeText(text, 500) });
}

function systemToAll(text) {
  const m = { type: T.SYSTEM, text: safeText(text, 500) };
  for (const sock of clients.keys()) io.sendTo(sock, m);
}

function safeClose(socket) {
  try { socket.end(); } catch (_) {}
  try { socket.destroy(); } catch (_) {}
}

// ---------- Handlers per message type ----------
function handleJoin(socket, msg) {
  if (!isValidUsername(msg.name)) {
    io.sendTo(socket, { type: T.ERROR, text: 'Invalid username (1-24 chars, A-Z 0-9 _ -)' });
    safeClose(socket);
    return;
  }
  // Cek duplikat
  if (findSocketByName(msg.name)) {
    io.sendTo(socket, { type: T.ERROR, text: `Username "${msg.name}" sudah dipakai.` });
    safeClose(socket);
    return;
  }
  const id = nextClientId++;
  const info = { id, name: msg.name, addr: socket.remoteAddress + ':' + socket.remotePort };
  clients.set(socket, info);

  // Auto-join default room
  rooms.join(socket, DEFAULT_ROOM);

  // Welcome ke client
  io.sendTo(socket, {
    type: T.WELCOME,
    name: info.name,
    id: info.id,
    room: DEFAULT_ROOM,
    rooms: rooms.list(),
    users: userList(),
  });

  // History room default
  const hist = rooms.getHistory(DEFAULT_ROOM, 50);
  if (hist.length) io.sendTo(socket, { type: 'history', room: DEFAULT_ROOM, items: hist });

  // Broadcast ke semua
  systemToAll(`${info.name} bergabung ke chat.`);
  broadcastUserList();
  broadcastRooms();
}

function handleMessage(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const ttlSec = validateTtl(msg.ttl);
  const id = msg.id || genId();
  const room = msg.room || DEFAULT_ROOM;
  // Pastikan sender ada di room tsb
  if (!socket.rooms || !socket.rooms.has(room)) rooms.join(socket, room);

  const out = {
    type: T.ROOM_MSG,
    room,
    from: info.name,
    id,
    encrypted: msg.encrypted, // server tidak decrypt
    ttl: ttlSec,
    ts: Date.now(),
  };

  rooms.pushHistory(room, out);
  rooms.broadcastToRoom(room, out, null);

  if (ttlSec) {
    const recipients = new Set();
    const r = rooms.rooms.get(room);
    if (r) for (const s of r.members) recipients.add(s);
    ttl.add(id, ttlSec, recipients, { scope: 'room', room });
  }
}

function handleDm(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const target = findSocketByName(msg.to);
  if (!target) {
    io.sendTo(socket, { type: T.ERROR, text: `User "${msg.to}" tidak ditemukan.` });
    return;
  }
  const ttlSec = validateTtl(msg.ttl);
  const id = msg.id || genId();
  const outgoing = {
    type: T.MESSAGE,
    from: info.name,
    id,
    direct: true,
    to: msg.to,
    encrypted: msg.encrypted,
    ttl: ttlSec,
    ts: Date.now(),
  };
  // Kirim ke target
  io.sendTo(target, outgoing);
  // Echo ke pengirim (supaya UI menampilkan "sent")
  io.sendTo(socket, { ...outgoing, echo: true });

  if (ttlSec) {
    ttl.add(id, ttlSec, new Set([socket, target]), { scope: 'dm', peer: info.name });
  }
}

function handleTyping(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  if (msg.direct && msg.to) {
    const target = findSocketByName(msg.to);
    if (target) io.sendTo(target, { type: T.TYPING, from: info.name, direct: true });
  } else {
    // Broadcast typing ke room aktif
    const room = msg.room || DEFAULT_ROOM;
    rooms.broadcastToRoom(room, { type: T.TYPING, from: info.name, room }, socket);
  }
}

function handleFile(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  if (!msg.encrypted || typeof msg.encrypted !== 'object') {
    io.sendTo(socket, { type: T.ERROR, text: 'File harus terenkripsi (field "encrypted" wajib).' });
    return;
  }
  if (!validateFileSize(msg.size, fileStore.MAX_FILE_SIZE)) {
    io.sendTo(socket, { type: T.ERROR, text: `File terlalu besar (max ${fileStore.MAX_FILE_SIZE} bytes).` });
    return;
  }
  const safeName = sanitizeFilename(msg.fileName);
  const ttlSec = validateTtl(msg.ttl);
  const id = msg.id || genId();
  const stored = msg.encrypted;

  // Recipients untuk TTL (akan di-set setelah kita tahu room)
  let recipients = new Set();
  let scope = 'room';
  let peer = null;
  let targetRoom = msg.room || DEFAULT_ROOM;
  let fileStoredName = null;

  // Tentukan target pengiriman
  const out = {
    type: T.FILE,
    from: info.name,
    id,
    fileName: safeName,
    mimeType: String(msg.mimeType || 'application/octet-stream'),
    size: Number(msg.size || 0),
    encrypted: stored,
    direct: !!msg.direct,
    to: msg.to || null,
    ttl: ttlSec,
    ts: Date.now(),
  };

  // Opsional: simpan ciphertext file ke disk agar bisa di-download via /download/...
  // Simpan ciphertext + authTag agar bisa didekripsi ulang saat download.
  const persist = (cb) => {
    if (!msg.encrypted_ciphertext || typeof msg.encrypted_ciphertext !== 'string') {
      return cb(null);
    }
    try {
      // Gabungkan ciphertext + authTag agar bisa didekripsi ulang nanti
      const authTag = msg.encrypted?.authTag || '';
      const combined = msg.encrypted_ciphertext + (authTag ? '|' + authTag : '');
      const buf = Buffer.from(combined, 'base64');
      if (buf.length > fileStore.MAX_FILE_SIZE) return cb(null);
      fileStore.saveUploadFromBuffer(buf, safeName)
        .then(s => cb(s.storedName))
        .catch(() => cb(null));
    } catch (_) { cb(null); }
  };

  if (msg.direct && msg.to) {
    const target = findSocketByName(msg.to);
    if (!target) {
      io.sendTo(socket, { type: T.ERROR, text: `User "${msg.to}" tidak ditemukan.` });
      return;
    }
    persist((stored) => {
      fileStoredName = stored;
      out.storedName = stored;
      io.sendTo(target, out);
      io.sendTo(socket, { ...out, echo: true });
      if (ttlSec) ttl.add(id, ttlSec, new Set([socket, target]), { scope: 'dm', peer: info.name, fileStoredName });
    });
  } else {
    if (!socket.rooms || !socket.rooms.has(targetRoom)) rooms.join(socket, targetRoom);
    out.room = targetRoom;
    out.direct = false;
    persist((stored) => {
      fileStoredName = stored;
      out.storedName = stored;
      rooms.broadcastToRoom(targetRoom, out, null);
      if (ttlSec) {
        const r = rooms.rooms.get(targetRoom);
        if (r) for (const s of r.members) recipients.add(s);
        ttl.add(id, ttlSec, recipients, { scope: 'room', room: targetRoom, fileStoredName });
      }
    });
  }
}

function handleJoinRoom(socket, msg) {
  if (!isValidRoom(msg.room)) {
    io.sendTo(socket, { type: T.ERROR, text: 'Nama room tidak valid.' });
    return;
  }
  const r = rooms.join(socket, msg.room);
  if (!r.ok) {
    io.sendTo(socket, { type: T.ERROR, text: 'Gagal join room.' });
    return;
  }
  const info = clients.get(socket);
  systemToAll(`${info.name} bergabung ke #${msg.room}.`);
  sendSystemTo(socket, `Anda sekarang di room #${msg.room}.`);
  broadcastRooms();
  const hist = rooms.getHistory(msg.room, 50);
  if (hist.length) io.sendTo(socket, { type: 'history', room: msg.room, items: hist });
}

function handleCreateRoom(socket, msg) {
  if (!isValidRoom(msg.room)) {
    io.sendTo(socket, { type: T.ERROR, text: 'Nama room tidak valid.' });
    return;
  }
  const existed = rooms.rooms.has(msg.room);
  rooms.join(socket, msg.room);
  const info = clients.get(socket);
  if (existed) {
    sendSystemTo(socket, `Room #${msg.room} sudah ada, Anda join ke room tersebut.`);
  } else {
    systemToAll(`Room baru dibuat: #${msg.room} (oleh ${info.name}).`);
  }
  broadcastRooms();
}

function handleLeaveRoom(socket, msg) {
  if (!isValidRoom(msg.room)) return;
  const r = rooms.leave(socket, msg.room);
  if (!r.ok) return;
  const info = clients.get(socket);
  systemToAll(`${info.name} keluar dari #${msg.room}.`);
  // Auto-join ke default kalau dia tidak punya room
  if (!socket.rooms || socket.rooms.size === 0) rooms.join(socket, DEFAULT_ROOM);
  broadcastRooms();
}

function handleList(socket) {
  io.sendTo(socket, { type: T.USERS, users: userList(), count: clients.size });
  io.sendTo(socket, { type: T.ROOMS, rooms: rooms.list() });
}

function handlePing(socket) {
  io.sendTo(socket, { type: T.PONG, ts: Date.now() });
}

// ---------- Whiteboard handlers ----------
function _whiteboardSanitize(s) {
  if (typeof s !== 'string') return null;
  return s.slice(0, 24);
}
function _num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}
// Board state per room — map<roomName, {strokes: [...], activeByUser: {user: stroke}}>
const boardState = new Map();
function _getBoard(room) {
  if (!boardState.has(room)) {
    boardState.set(room, { strokes: [], activeByUser: {} });
  }
  return boardState.get(room);
}
function _boardRoomFromMsg(socket, msg) {
  // Pakai msg.room jika valid, fallback ke room aktif sender
  const r = (msg && typeof msg.room === 'string') ? msg.room : (socket.activeRoom || DEFAULT_ROOM);
  if (!isValidRoom(r)) return DEFAULT_ROOM;
  return r;
}
function _boardRecipients(room) {
  const r = rooms.rooms.get(room);
  if (!r) return 0;
  let n = 0;
  for (const sock of r.members) {
    if (clients.has(sock)) n++;
  }
  return n;
}
function handleBoardBegin(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const x = _num(msg.x), y = _num(msg.y);
  if (x === null || y === null) {
    io.sendTo(socket, { type: T.ERROR, text: 'boardBegin: x,y numeric required' });
    return;
  }
  const room = _boardRoomFromMsg(socket, msg);
  if (!socket.rooms || !socket.rooms.has(room)) rooms.join(socket, room);
  const color = typeof msg.color === 'string' ? msg.color.slice(0, 16) : '#000';
  const size = _num(msg.size) || 2;
  // Track open stroke
  const bs = _getBoard(room);
  const newStroke = {
    user: info.name,
    color,
    width: size,
    points: [{ x, y }],
    closed: false,
  };
  bs.strokes.push(newStroke);
  bs.activeByUser[info.name] = newStroke;
  rooms.broadcastToRoom(room, {
    type: T.BOARD_BEGIN,
    room, from: info.name, user: info.name,
    x, y, color, size,
  }, null);
}
function handleBoardDraw(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const x = _num(msg.x), y = _num(msg.y);
  if (x === null || y === null) return;
  const room = _boardRoomFromMsg(socket, msg);
  if (!socket.rooms || !socket.rooms.has(room)) rooms.join(socket, room);
  const bs = _getBoard(room);
  let stroke = bs.activeByUser[info.name];
  if (!stroke || stroke.closed) {
    // boardDraw tiba sebelum boardBegin (race/throttle client). Buat stroke
    // inline dengan style default agar state server konsisten.
    stroke = {
      user: info.name,
      color: typeof msg.color === 'string' ? msg.color.slice(0, 16) : '#fff',
      width: _num(msg.size) || 3,
      points: [],
      closed: false,
    };
    bs.strokes.push(stroke);
    bs.activeByUser[info.name] = stroke;
  }
  stroke.points.push({ x, y });
  rooms.broadcastToRoom(room, {
    type: T.BOARD_DRAW,
    room, from: info.name, user: info.name,
    x, y,
  }, null);
}
function handleBoardEnd(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const room = _boardRoomFromMsg(socket, msg);
  const bs = _getBoard(room);
  const stroke = bs.activeByUser[info.name];
  if (stroke && !stroke.closed) {
    stroke.closed = true;
  }
  delete bs.activeByUser[info.name];
  rooms.broadcastToRoom(room, {
    type: T.BOARD_END, room, from: info.name, user: info.name,
  }, null);
}
function handleBoardClear(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const room = _boardRoomFromMsg(socket, msg);
  if (!socket.rooms || !socket.rooms.has(room)) rooms.join(socket, room);
  boardState.set(room, { strokes: [], activeByUser: {} });
  rooms.broadcastToRoom(room, {
    type: T.BOARD_CLEAR, room, from: info.name,
  }, null);
  systemToAll(`🧹 ${info.name} membersihkan whiteboard (#${room}).`);
}
function handleBoardState(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  // Toggle visibility: hanya kirim ke diri sendiri informasi state
  const on = !!msg.on;
  const room = _boardRoomFromMsg(socket, msg);
  io.sendTo(socket, {
    type: T.BOARD_STATE, room, on,
  });
  sendSystemTo(socket, on
    ? 'Whiteboard AKTIF. Pesan teks juga tetap berjalan paralel.'
    : 'Whiteboard NONAKTIF. Anda bisa aktifkan lagi kapan saja.');
}
function handleBoardSnap(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const room = _boardRoomFromMsg(socket, msg);
  if (!socket.rooms || !socket.rooms.has(room)) rooms.join(socket, room);
  const bs = _getBoard(room);
  // Kirim snapshot ke requester saja
  io.sendTo(socket, {
    type: T.BOARD_SNAP, room, strokes: bs.strokes,
  });
}

function handleBoardTool(socket, msg) {
  const info = clients.get(socket);
  if (!info) return;
  const room = _boardRoomFromMsg(socket, msg);
  rooms.broadcastToRoom(room, {
    type: T.BOARD_TOOL, room, from: info.name, user: info.name,
    color: typeof msg.color === 'string' ? msg.color.slice(0, 16) : '#ffffff',
    size: _num(msg.size) || 3,
  }, null);
}

// ---------- Dispatcher ----------
function handleMessageObj(socket, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case T.JOIN:        return handleJoin(socket, msg);
    case T.MESSAGE:     return handleMessage(socket, msg);
    case T.DM:          return handleDm(socket, msg);
    case T.TYPING:      return handleTyping(socket, msg);
    case T.FILE:        return handleFile(socket, msg);
    case T.JOIN_ROOM:   return handleJoinRoom(socket, msg);
    case T.CREATE_ROOM: return handleCreateRoom(socket, msg);
    case T.LEAVE_ROOM:  return handleLeaveRoom(socket, msg);
    case T.LIST:        return handleList(socket);
    case T.PING:        return handlePing(socket);
    case T.BOARD_BEGIN: return handleBoardBegin(socket, msg);
    case T.BOARD_DRAW:  return handleBoardDraw(socket, msg);
    case T.BOARD_END:   return handleBoardEnd(socket, msg);
    case T.BOARD_CLEAR: return handleBoardClear(socket, msg);
    case T.BOARD_STATE: return handleBoardState(socket, msg);
    case T.BOARD_TOOL:  return handleBoardTool(socket, msg);
    case T.BOARD_SNAP:  return handleBoardSnap(socket, msg);
    default: io.sendTo(socket, { type: T.ERROR, text: `Unknown message type: ${msg.type}` });
  }
}

// ---------- Server ----------
const server = net.createServer(socket => {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);

  socket.rooms = new Set();

  const feed = makeLineSplitter(
    (obj) => handleMessageObj(socket, obj),
    (err, raw) => io.sendTo(socket, { type: T.ERROR, text: 'Invalid JSON' })
  );

  socket.on('data', chunk => feed(chunk));
  socket.on('error', () => { /* swallow; close handler will cleanup */ });
  socket.on('close', () => {
    const info = clients.get(socket);
    if (info) {
      rooms.leaveAll(socket);
      clients.delete(socket);
      systemToAll(`${info.name} keluar dari chat.`);
      broadcastUserList();
      broadcastRooms();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[CollabBoard] TCP server listening on ${HOST}:${PORT}`);
  console.log(`[CollabBoard] Default room: #${DEFAULT_ROOM}`);
  console.log(`[CollabBoard] Max file size: ${fileStore.MAX_FILE_SIZE} bytes`);
  console.log(`[CollabBoard] Uploads dir: ${fileStore.getUploadDir()}`);
});

process.on('SIGINT', () => {
  console.log('\n[CollabBoard] Shutting down...');
  ttl.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
