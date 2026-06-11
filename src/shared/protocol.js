/**
 * src/shared/protocol.js
 * ---------------------------------------------------------------------------
 * Konstanta dan helper untuk protokol pesan chat.
 * Protokol: JSON over TCP / WebSocket, newline-delimited (1 JSON per baris).
 * Semua enkripsi dilakukan di sisi client; server hanya relay ciphertext.
 * ---------------------------------------------------------------------------
 */

'use strict';

// ---------- Message types (client -> server & server -> client) -----------
const T = Object.freeze({
  // Handshake
  JOIN:        'join',         // C->S : { type:'join', name }
  WELCOME:     'welcome',      // S->C : { type:'welcome', name, id }
  LEAVE:       'leave',        // C->S : { type:'leave' } (opsional, socket close juga cukup)

  // Chat
  MESSAGE:     'message',      // C->S / S->C : { type:'message', from, encrypted, direct, to, ttl, id, room }
  DM:          'dm',           // alias message{ direct:true, to }
  SYSTEM:      'system',       // S->C : { type:'system', text }
  USERS:       'users',        // S->C : { type:'users', users:[], count }
  LIST:        'list',         // C->S : { type:'list' } -> balas USERS
  TYPING:      'typing',       // C->S / S->C : { type:'typing', from, to?, direct? }

  // File
  FILE:        'file',         // C->S / S->C : { type:'file', from, fileName, mimeType, encrypted, size, id, direct?, to?, ttl? }

  // Self-destruct
  DESTROY:     'destroy',      // S->C : { type:'destroy', id, scope? ('room'|'dm'), peer? }

  // Rooms (v1.1)
  JOIN_ROOM:   'joinRoom',     // C->S : { type:'joinRoom', room }
  CREATE_ROOM: 'createRoom',   // C->S : { type:'createRoom', room }
  LEAVE_ROOM:  'leaveRoom',    // C->S : { type:'leaveRoom', room }
  ROOMS:       'rooms',        // S->C : { type:'rooms', rooms:[{name, members}] }
  ROOM_MSG:    'roomMessage',  // S->C : { type:'roomMessage', room, from, encrypted, id, ttl? }

  // Whiteboard (v1.2) — Collaborative drawing (reserved for future)
  BOARD_BEGIN: 'boardBegin',   // C->S / S->C
  BOARD_DRAW:  'boardDraw',    // C->S / S->C
  BOARD_END:   'boardEnd',     // C->S / S->C
  BOARD_CLEAR: 'boardClear',   // C->S / S->C
  BOARD_SNAP:  'boardSnap',    // S->C only
  BOARD_STATE: 'boardState',   // C->S / S->C
  BOARD_TOOL:  'boardTool',    // C->S / S->C : tool/color/size change
});

// ---------- Wire helpers ----------
function encode(obj) {
  return Buffer.from(JSON.stringify(obj) + '\n', 'utf8');
}

// Buffer line splitter untuk protocol newline-delimited JSON
function makeLineSplitter(onLine, onError) {
  let buf = '';
  return function feed(chunk) {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch (e) {
        if (onError) onError(e, line);
      }
    }
  };
}

// ---------- Validation ----------
const RE_USERNAME = /^[A-Za-z0-9_\-]{1,24}$/;
const RE_ROOM     = /^[A-Za-z0-9_\-]{1,32}$/;

function isValidUsername(name) { return typeof name === 'string' && RE_USERNAME.test(name); }
function isValidRoom(name)     { return typeof name === 'string' && RE_ROOM.test(name); }

function sanitizeFilename(name) {
  // Path traversal protection: ambil basename, ganti karakter aneh
  // (path.basename tidak di sini untuk kompatibilitas browser-side; pakai regex manual)
  let s = String(name || 'file');
  // Ambil bagian setelah slash/backslash terakhir
  s = s.replace(/^.*[\\\/]/, '');
  // Hapus kontrol karakter; ganti semua yang bukan [A-Za-z0-9._- ] dengan _
  s = s.replace(/[^\w.\- ]+/g, '_');
  // Hindari nama dotfile (mulai dengan .); jika hasilnya kosong, fallback 'file'
  s = s.slice(0, 120);
  if (!s || /^\.+$/.test(s)) s = 'file';
  return s;
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

module.exports = {
  T,
  encode,
  makeLineSplitter,
  isValidUsername,
  isValidRoom,
  sanitizeFilename,
  genId,
};
