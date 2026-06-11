/**
 * src/client/cli-client.js
 * ---------------------------------------------------------------------------
 * CLI client CollabBoard.
 *
 *  - Connect ke TCP server (default 127.0.0.1:9000) lewat socket Node.js.
 *  - Semua pesan & file dienkripsi lokal dengan AES-256-GCM (shared key
 *    diturunkan dari passphrase via PBKDF2-SHA256 100k iter). Server
 *    TIDAK pernah melihat plaintext.
 *  - Protocol: JSON newline-delimited (satu pesan = satu baris).
 *  - Commands yang tersedia:
 *      /help                   - tampilkan bantuan
 *      /list                   - daftar user online
 *      /rooms                  - daftar semua room
 *      /room create <nama>     - buat & auto-join room baru
 *      /room join <nama>       - pindah ke room tertentu
 *      /room leave             - keluar dari room aktif
 *      /dm <user> <pesan>      - kirim Direct Message
 *      /file <path>            - kirim file ke room aktif
 *      /dmfile <user> <path>   - kirim file lewat DM
 *      /ttl <detik>            - set TTL sekali pakai untuk pesan/file berikutnya
 *      /quit                   - keluar dari aplikasi
 *  - Plain text (tanpa prefix `/`) = kirim pesan ke room aktif.
 * ---------------------------------------------------------------------------
 */

'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const { T, encode, makeLineSplitter, isValidUsername, sanitizeFilename, genId } = require('../shared/protocol');
const { encrypt } = require('../server/crypto-utils');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '9000', 10);
const SHARED_KEY_PASSPHRASE = process.env.SHARED_KEY_PASSPHRASE || 'chat-encrypted-key-2026-komunikasi-data';

const KEY = crypto.pbkdf2Sync(SHARED_KEY_PASSPHRASE, Buffer.from('securechat-salt-v1'), 100_000, 32, 'sha256');

const DOWNLOADS = path.join(__dirname, '..', '..', 'downloads');
if (!fs.existsSync(DOWNLOADS)) fs.mkdirSync(DOWNLOADS, { recursive: true });

// ---------- Args ----------
const args = process.argv.slice(2);
function getArg(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
const userName = getArg('--name') || process.env.USER_NAME || '';
const hostArg  = getArg('--host', HOST);
const portArg  = parseInt(getArg('--port', PORT), 10);

// ---------- State ----------
let socket;
let me = '';
let activeRoom = 'general';
let users = [];
let roomsList = [];
let pendingTtl = null;            // TTL sekali pakai
const ttlTimers = new Map();      // msgId -> Timeout

// ---------- IO ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let promptStr = '> ';

function setPrompt(s) { promptStr = s; rl.setPrompt(s); }
function print(line) { process.stdout.write('\r\x1b[2K' + line + '\n' + promptStr); }

function send(obj) { if (socket) socket.write(encode(obj)); }

// ---------- TTL countdown di CLI ----------
function scheduleTtlDestroy(id, ttlSec, scope, peer, room) {
  if (!ttlSec) return;
  if (ttlTimers.has(id)) return;
  const t = setTimeout(() => {
    ttlTimers.delete(id);
    print(`\x1b[90m[TTL] pesan ${id} dihancurkan (${scope}${peer ? ' ' + peer : ''}${room ? ' #' + room : ''}).\x1b[0m`);
  }, ttlSec * 1000);
  ttlTimers.unref?.();
  ttlTimers.set(id, t);
}

// ---------- Crypto helpers ----------
function encText(plain) { return encrypt(plain, KEY); }

function encBuffer(buf) {
  // Enkripsi isi file (diperlakukan sebagai base64 dari bytes).
  const b64 = buf.toString('base64');
  return encrypt(b64, KEY);
}

// ---------- File send ----------
async function sendFile(targetPath, directTo) {
  let abs;
  try { abs = path.resolve(targetPath); } catch (_) { print('Path file tidak valid.'); return; }
  if (!fs.existsSync(abs)) { print(`File tidak ditemukan: ${targetPath}`); return; }
  const buf = fs.readFileSync(abs);
  if (buf.length > 8 * 1024 * 1024) { print('File terlalu besar (max 8MB).'); return; }
  const enc = encBuffer(buf);
  const msg = {
    type: T.FILE,
    id: genId(),
    fileName: path.basename(abs),
    mimeType: 'application/octet-stream',
    size: buf.length,
    encrypted: { iv: enc.iv, authTag: enc.authTag, ciphertext: enc.ciphertext },
    direct: !!directTo,
    to: directTo || null,
    room: directTo ? null : activeRoom,
    ttl: pendingTtl,
  };
  pendingTtl = null;
  send(msg);
  print(`[file] terkirim: ${path.basename(abs)} (${buf.length} bytes)${directTo ? ' -> @' + directTo : ' -> #' + activeRoom}`);
}

function decryptPayload(payload) {
  const { decrypt } = require('../server/crypto-utils');
  return decrypt(payload, KEY);
}

function handleIncomingFile(msg) {
  // Simpan file hasil dekripsi ke ./downloads/
  const plainB64 = decryptPayload(msg.encrypted);
  const buf = Buffer.from(plainB64, 'base64');
  const safe = sanitizeFilename(msg.fileName);
  const stored = `${Date.now()}_${sanitizeFilename(msg.from)}_${safe}`;
  const fp = path.join(DOWNLOADS, stored);
  fs.writeFileSync(fp, buf);
  print(`[file] diterima dari ${msg.from}: ${safe} (${buf.length} bytes) -> downloads/${stored}`);
}

// ---------- Routing incoming ----------
function handle(obj) {
  switch (obj.type) {
    case T.WELCOME:
      me = obj.name;
      activeRoom = obj.room || 'general';
      users = obj.users || [];
      roomsList = obj.rooms || [];
      print(`\x1b[32m✔ Welcome, ${me}!\x1b[0m room aktif: #${activeRoom}`);
      print(`Users online: ${users.join(', ')}`);
      print(`Rooms: ${roomsList.map(r => '#' + r.name + '(' + r.members + ')').join(', ')}`);
      setPrompt(`[${me}@#${activeRoom}]> `);
      break;
    case T.SYSTEM:
      print(`\x1b[36m* ${obj.text}\x1b[0m`);
      break;
    case T.USERS:
      users = obj.users || [];
      print(`\x1b[90m[users] (${obj.count}) ${users.join(', ')}\x1b[0m`);
      break;
    case T.ROOMS:
      roomsList = obj.rooms || [];
      print(`\x1b[90m[rooms] ${roomsList.map(r => '#' + r.name + '(' + r.members + ')').join(', ')}\x1b[0m`);
      break;
    case T.ROOM_MSG: {
      const tag = obj.from === me ? '(you)' : '';
      const ttlBadge = obj.ttl ? ` \x1b[33m⏱${obj.ttl}s\x1b[0m` : '';
      print(`[#${obj.room}] \x1b[35m${obj.from}\x1b[0m${tag}: \x1b[90m<encrypted>\x1b[0m${ttlBadge}`);
      scheduleTtlDestroy(obj.id, obj.ttl, 'room', null, obj.room);
      break;
    }
    case T.MESSAGE: {
      if (obj.direct) {
        const arrow = obj.echo ? '→ kamu' : `← ${obj.from}`;
        const ttlBadge = obj.ttl ? ` \x1b[33m⏱${obj.ttl}s\x1b[0m` : '';
        print(`\x1b[33m[DM ${arrow}]\x1b[0m \x1b[90m<encrypted>\x1b[0m${ttlBadge}`);
        scheduleTtlDestroy(obj.id, obj.ttl, 'dm', obj.from, null);
      } else {
        const ttlBadge = obj.ttl ? ` \x1b[33m⏱${obj.ttl}s\x1b[0m` : '';
        print(`\x1b[35m${obj.from}\x1b[0m: \x1b[90m<encrypted>\x1b[0m${ttlBadge}`);
        scheduleTtlDestroy(obj.id, obj.ttl, 'room', null, null);
      }
      break;
    }
    case T.FILE: {
      const target = obj.direct ? (obj.echo ? `→ @${obj.to}` : `← @${obj.from}`) : `[#${obj.room}] from ${obj.from}`;
      const ttlBadge = obj.ttl ? ` \x1b[33m⏱${obj.ttl}s\x1b[0m` : '';
      print(`\x1b[36m[file ${target}] ${obj.fileName} (${obj.size} bytes)\x1b[0m${ttlBadge}`);
      if (obj.direct && !obj.echo) handleIncomingFile(obj);
      if (!obj.direct) handleIncomingFile(obj);
      scheduleTtlDestroy(obj.id, obj.ttl, obj.direct ? 'dm' : 'room', obj.from, obj.room);
      break;
    }
    case T.DESTROY:
      print(`\x1b[90m[TTL] pesan ${obj.id} dihancurkan.\x1b[0m`);
      break;
    case T.TYPING: {
      const tag = obj.direct ? `DM dari @${obj.from}` : `@${obj.from} di #${obj.room || activeRoom}`;
      print(`\x1b[2;37m  ✎ ${tag} sedang mengetik...\x1b[0m`);
      break;
    }
    case T.HISTORY:
      print(`\x1b[90m-- history #${obj.room} (${obj.items.length} pesan) --\x1b[0m`);
      for (const m of obj.items) print(`\x1b[90m  > <encrypted> from ${m.from}\x1b[0m`);
      break;
    case T.ERROR:
      print(`\x1b[31m! ${obj.text}\x1b[0m`);
      break;
    case T.PONG:
      break;
    default:
      // ignore
  }
}

// ---------- Command parsing ----------
function printHelp() {
  print([
    'Commands:',
    '  /help',
    '  /list                       - daftar user online',
    '  /rooms                      - daftar room',
    '  /room create <nama>',
    '  /room join <nama>',
    '  /room leave',
    '  /dm <user> <pesan>          - direct message',
    '  /file <path>                - kirim file ke room aktif',
    '  /dmfile <user> <path>       - kirim file ke user tertentu',
    '  /ttl <detik>                - set TTL sekali pakai untuk pesan/file berikutnya',
    '  /quit                       - keluar',
  ].join('\n'));
}

async function handleCommand(line) {
  if (!line) return;
  if (!line.startsWith('/')) {
    // Plain message -> encrypt & send
    const enc = encText(line);
    send({
      type: T.MESSAGE,
      id: genId(),
      room: activeRoom,
      encrypted: { iv: enc.iv, authTag: enc.authTag, ciphertext: enc.ciphertext },
      ttl: pendingTtl,
    });
    pendingTtl = null;
    return;
  }
  const parts = line.slice(1).split(/\s+/);
  const cmd = parts[0];
  const rest = parts.slice(1);
  switch (cmd) {
    case 'help': printHelp(); break;
    case 'list': send({ type: T.LIST }); break;
    case 'rooms': send({ type: T.LIST }); break;
    case 'quit': case 'exit':
      try { socket.end(); } catch (_) {}
      process.exit(0);
      break;
    case 'room': {
      const sub = rest[0];
      const name = rest[1];
      if (sub === 'create') { if (!name) print('usage: /room create <nama>'); else { send({ type: T.CREATE_ROOM, room: name }); activeRoom = name; setPrompt(`[${me}@#${activeRoom}]> `); } }
      else if (sub === 'join') { if (!name) print('usage: /room join <nama>'); else { send({ type: T.JOIN_ROOM, room: name }); activeRoom = name; setPrompt(`[${me}@#${activeRoom}]> `); } }
      else if (sub === 'leave') { send({ type: T.LEAVE_ROOM, room: activeRoom }); activeRoom = 'general'; setPrompt(`[${me}@#${activeRoom}]> `); }
      else print('usage: /room create|join|leave [nama]');
      break;
    }
    case 'dm': {
      const to = rest[0];
      const msg = rest.slice(1).join(' ');
      if (!to || !msg) { print('usage: /dm <user> <pesan>'); break; }
      const enc = encText(msg);
      send({
        type: T.DM,
        to,
        id: genId(),
        encrypted: { iv: enc.iv, authTag: enc.authTag, ciphertext: enc.ciphertext },
        ttl: pendingTtl,
      });
      pendingTtl = null;
      break;
    }
    case 'file': {
      const p = rest[0];
      if (!p) { print('usage: /file <path>'); break; }
      await sendFile(p, null);
      break;
    }
    case 'dmfile': {
      const to = rest[0]; const p = rest[1];
      if (!to || !p) { print('usage: /dmfile <user> <path>'); break; }
      await sendFile(p, to);
      break;
    }
    case 'ttl': {
      const n = parseInt(rest[0], 10);
      if (!Number.isFinite(n) || n <= 0) { print('usage: /ttl <detik>'); break; }
      pendingTtl = n;
      print(`(TTL ${n}s set untuk pesan/file berikutnya)`);
      break;
    }
    default:
      print(`Unknown command: /${cmd}. Ketik /help.`);
  }
}

// ---------- Connect ----------
function connect() {
  socket = net.createConnection({ host: hostArg, port: portArg });
  socket.setNoDelay(true);

  const feed = makeLineSplitter(handle, (e) => print('[protocol] ' + e.message));
  socket.on('data', chunk => feed(chunk));
  socket.on('error', e => print('\x1b[31m[net] ' + e.message + '\x1b[0m'));
  socket.on('close', () => {
    print('\x1b[31m[net] disconnected.\x1b[0m');
    setTimeout(() => process.exit(0), 200);
  });
  socket.on('connect', () => {
    let name = userName;
    if (!name) {
      rl.question('Username: ', ans => {
        name = (ans || '').trim();
        if (!isValidUsername(name)) { print('Nama tidak valid. Pakai A-Z, 0-9, _ atau - (1-24 char).'); process.exit(1); }
        send({ type: T.JOIN, name });
        rl.prompt();
      });
    } else {
      send({ type: T.JOIN, name });
      rl.prompt();
    }
  });
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  try { await handleCommand(trimmed); } catch (e) { print('[cmd] ' + e.message); }
  rl.prompt();
});

process.on('SIGINT', () => { try { socket && socket.end(); } catch (_) {} process.exit(0); });

connect();
