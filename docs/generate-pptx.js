// docs/generate-pptx.js
// Generate CollabBoard presentation (.pptx) — 5-10 menit
// Run: node docs/generate-pptx.js
const PptxGenJS = require('pptxgenjs');

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';   // 13.33 x 7.5 inch
pptx.title  = 'CollabBoard — E2E Chat + Whiteboard';
pptx.author = 'Komunikasi Data — Informatika 2026';

// ---------- Theme ----------
const C = {
  bg:      '0F172A',   // slate-900
  card:    '1E293B',   // slate-800
  text:    'F1F5F9',   // slate-100
  muted:   '94A3B8',   // slate-400
  accent:  '22D3EE',   // cyan-400
  accent2: 'A78BFA',   // violet-400
  good:    '34D399',   // emerald-400
  warn:    'FBBF24',   // amber-400
};

const F = {
  title: { fontFace: 'Inter', fontSize: 32, bold: true, color: C.text },
  h:     { fontFace: 'Inter', fontSize: 22, bold: true, color: C.text },
  h2:    { fontFace: 'Inter', fontSize: 16, bold: true, color: C.accent },
  body:  { fontFace: 'Inter', fontSize: 13, color: C.text },
  small: { fontFace: 'Inter', fontSize: 11, color: C.muted },
  code:  { fontFace: 'Consolas', fontSize: 11, color: C.text },
};

// ---------- Helpers ----------
function master(slide, title) {
  slide.background = { color: C.bg };
  // Header bar
  slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.6, fill: { color: C.card }, line: { color: C.card } });
  slide.addText('CollabBoard · Komunikasi Data 2026', {
    x: 0.4, y: 0.05, w: 8, h: 0.5, ...F.small, valign: 'middle',
  });
  slide.addText('E2E Chat + Collaborative Whiteboard', {
    x: 7, y: 0.05, w: 6, h: 0.5, ...F.small, valign: 'middle', align: 'right', color: C.accent,
  });
  if (title) {
    slide.addText(title, { x: 0.5, y: 0.75, w: 12.3, h: 0.7, ...F.h });
  }
  // Footer
  slide.addText('Node.js · Zero npm deps · AES-256-GCM · TCP + WebSocket', {
    x: 0.4, y: 7.15, w: 12.5, h: 0.3, ...F.small, align: 'center',
  });
}

function bullet(slide, items, x, y, w, h, opts = {}) {
  slide.addText(
    items.map(t => ({ text: t, options: { bullet: { code: '25CF' } } })),
    { x, y, w, h, ...F.body, ...opts, paraSpaceAfter: 6, valign: 'top' }
  );
}

// =============================================================
// SLIDE 1 — Judul
// =============================================================
{
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  s.addShape('rect', { x: 0, y: 2.4, w: 13.33, h: 2.7, fill: { color: C.card }, line: { color: C.accent, width: 1 } });
  s.addText('🎨  CollabBoard', { x: 0.5, y: 2.6, w: 12.3, h: 0.9, ...F.title, fontSize: 44, align: 'center' });
  s.addText('End-to-End Encrypted Chat + Real-time Collaborative Whiteboard', {
    x: 0.5, y: 3.5, w: 12.3, h: 0.5, ...F.h2, align: 'center',
  });
  s.addText('Matakuliah: Komunikasi Data  ·  Prodi: Informatika  ·  2026', {
    x: 0.5, y: 4.1, w: 12.3, h: 0.4, ...F.body, align: 'center', color: C.muted,
  });
  s.addText('Stack: Node.js stdlib (zero deps) · AES-256-GCM · TCP + WebSocket · Vanilla JS', {
    x: 0.5, y: 4.5, w: 12.3, h: 0.4, ...F.body, align: 'center', color: C.muted,
  });
  s.addText('1', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 2 — Latar Belakang & Ide (Penilaian #1)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, '1 · Latar Belakang & Ide');

  s.addText('Kenapa proyek ini dibuat?', { x: 0.5, y: 1.5, w: 12.3, h: 0.4, ...F.h2 });

  // 3 problem cards
  const cards = [
    { t: '🔓 Privasi Lemah', d: 'Chat biasa kirim plaintext — admin server, ISP, atau sniffing bisa baca isi pesan.' },
    { t: '🧩 Fitur Chat Terpisah', d: 'Biasanya chat DAN kolaborasi visual butuh app berbeda —切换 konteks menurunkan produktivitas.' },
    { t: '📡 Teori vs Praktik', d: 'Mata kuliah Komunikasi Data banyak teori (TCP, enkripsi) tapi jarang implementasi protokol utuh.' },
  ];
  cards.forEach((c, i) => {
    const x = 0.5 + i * 4.27;
    s.addShape('roundRect', { x, y: 2.0, w: 4.0, h: 1.7, fill: { color: C.card }, line: { color: C.accent, width: 1 }, rectRadius: 0.1 });
    s.addText(c.t, { x: x + 0.15, y: 2.1, w: 3.7, h: 0.4, ...F.h, fontSize: 14 });
    s.addText(c.d, { x: x + 0.15, y: 2.55, w: 3.7, h: 1.1, ...F.body, fontSize: 11 });
  });

  // Tujuan
  s.addShape('roundRect', { x: 0.5, y: 4.0, w: 12.3, h: 2.7, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.1 });
  s.addText('🎯 Tujuan Proyek', { x: 0.7, y: 4.1, w: 12, h: 0.4, ...F.h, color: C.accent2 });
  bullet(s, [
    'Menerapkan protokol komunikasi data secara nyata: TCP socket + newline-delimited JSON + WebSocket bridge.',
    'Mengimplementasikan enkripsi end-to-end (AES-256-GCM + PBKDF2) — server tidak bisa membaca plaintext.',
    'Menggabungkan chat + collaborative whiteboard dalam satu sistem terintegrasi (text + visual real-time).',
    'Zero dependency eksternal: hanya Node.js stdlib + Web Crypto API — portabel, ringan, mudah diaudit.',
  ], 0.8, 4.55, 11.8, 2.0);

  s.addText('2', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 3 — Masalah vs Solusi (Penilaian #2)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, '2 · Masalah & Solusi');

  // Header
  s.addText('Masalah', { x: 0.5, y: 1.5, w: 6, h: 0.4, ...F.h, color: C.warn });
  s.addText('Solusi di CollabBoard', { x: 6.8, y: 1.5, w: 6, h: 0.4, ...F.h, color: C.good });

  const rows = [
    ['Pesan plaintext bisa disadap', 'AES-256-GCM end-to-end: client encrypt, server cuma relay ciphertext'],
    ['Tidak ada kolaborasi visual real-time', 'Whiteboard canvas (pen/eraser/warna) sinkron via TCP broadcast'],
    ['Semua user di 1 channel → noisy', 'Rooms/Channels: #general default + custom create/join/leave'],
    ['DM harus lewat broadcast = bocor', 'Direct Message: routing 1-ke-1, hanya sender & target'],
    ['Pesan sensitif permanently tersimpan', 'Self-Destructing Messages: TTL 5/10/30/60s, server kirim sinyal destroy'],
    ['Kirim file lewat app lain', 'File Sharing terenkripsi (s.d. 8MB), inline di chat, TTL-aware'],
  ];

  let y = 2.05;
  rows.forEach(([p, sol]) => {
    s.addShape('roundRect', { x: 0.5, y, w: 6.1, h: 0.65, fill: { color: '3F1D1D' }, line: { color: C.warn, width: 1 }, rectRadius: 0.05 });
    s.addText('⚠ ' + p, { x: 0.65, y: y + 0.05, w: 5.9, h: 0.55, ...F.body, fontSize: 11, valign: 'middle' });
    s.addShape('roundRect', { x: 6.8, y, w: 6.05, h: 0.65, fill: { color: '0F2E26' }, line: { color: C.good, width: 1 }, rectRadius: 0.05 });
    s.addText('✓ ' + sol, { x: 6.95, y: y + 0.05, w: 5.8, h: 0.55, ...F.body, fontSize: 11, valign: 'middle' });
    y += 0.78;
  });

  s.addText('3', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 4 — Arsitektur (penopang teknis)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Arsitektur Sistem');

  // Big diagram
  s.addShape('roundRect', { x: 4.0, y: 1.5, w: 5.3, h: 1.6, fill: { color: C.card }, line: { color: C.accent, width: 2 }, rectRadius: 0.1 });
  s.addText('TCP Server :9000', { x: 4.1, y: 1.55, w: 5.1, h: 0.35, ...F.h, fontSize: 14, align: 'center' });
  s.addText([
    { text: '• Rooms Service (Map)\n', options: F.body },
    { text: '• TTL Manager (Map + timer)\n', options: F.body },
    { text: '• File Store (./uploads)\n', options: F.body },
    { text: '• Whiteboard Relay (boardBegin/Draw/End/Clear)', options: F.body },
  ], { x: 4.2, y: 1.9, w: 5.0, h: 1.15, ...F.body, fontSize: 10.5, valign: 'top' });

  // CLI client
  s.addShape('roundRect', { x: 0.5, y: 4.2, w: 3.0, h: 2.3, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.1 });
  s.addText('CLI Client', { x: 0.6, y: 4.25, w: 2.8, h: 0.4, ...F.h, fontSize: 13, align: 'center' });
  s.addText('net.Socket\nPBKDF2 + AES-GCM\nReadline UI\nCommands: /room /dm /file /ttl', {
    x: 0.6, y: 4.65, w: 2.8, h: 1.8, ...F.body, fontSize: 10.5, align: 'center', valign: 'top',
  });

  // Web bridge
  s.addShape('roundRect', { x: 4.5, y: 4.2, w: 4.3, h: 2.3, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.1 });
  s.addText('Web Bridge :8080', { x: 4.6, y: 4.25, w: 4.1, h: 0.4, ...F.h, fontSize: 13, align: 'center' });
  s.addText('HTTP server (static /public)\nWebSocket ↔ TCP bridge\nMenjalankan 1 proses', {
    x: 4.6, y: 4.65, w: 4.1, h: 1.8, ...F.body, fontSize: 10.5, align: 'center', valign: 'top',
  });

  // Browser
  s.addShape('roundRect', { x: 9.3, y: 4.2, w: 3.5, h: 2.3, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.1 });
  s.addText('Browser (Vanilla JS)', { x: 9.4, y: 4.25, w: 3.3, h: 0.4, ...F.h, fontSize: 13, align: 'center' });
  s.addText('Web Crypto API\nCanvas (whiteboard)\napp.js + crypto.js\nSidebar rooms/DM/threads', {
    x: 9.4, y: 4.65, w: 3.3, h: 1.8, ...F.body, fontSize: 10.5, align: 'center', valign: 'top',
  });

  // Arrows (lines)
  s.addShape('line', { x: 2.0, y: 3.1, w: 4.0, h: 1.1, line: { color: C.accent, width: 2, endArrowType: 'triangle' } });
  s.addShape('line', { x: 6.65, y: 3.1, w: 0, h: 1.1, line: { color: C.accent, width: 2, endArrowType: 'triangle' } });
  s.addShape('line', { x: 11.05, y: 3.1, w: -4.0, h: 1.1, line: { color: C.accent, width: 2, endArrowType: 'triangle' } });
  s.addText('TCP (newline JSON)', { x: 2.5, y: 3.2, w: 3.0, h: 0.3, ...F.small, align: 'center' });
  s.addText('WS ↔ TCP', { x: 9.5, y: 3.2, w: 2.5, h: 0.3, ...F.small, align: 'center' });

  s.addText('Prinsip: server hanya relay — tidak pernah punya key enkripsi.', { x: 0.5, y: 6.75, w: 12.3, h: 0.3, ...F.small, align: 'center', italic: true });
  s.addText('4', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 5 — Enkripsi End-to-End (teknikal #3a: ketepatan)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Implementasi Teknis #1 · Enkripsi E2E');

  // Alur kiri
  s.addText('Alur Enkripsi', { x: 0.5, y: 1.5, w: 6, h: 0.4, ...F.h, color: C.accent });

  const steps = [
    ['1', 'Client derive 32B key', 'PBKDF2-SHA256 · 100.000 iter · salt tetap'],
    ['2', 'Encrypt per pesan', 'AES-256-GCM · IV random 12B (unik tiap pesan)'],
    ['3', 'Output envelope', '{iv, authTag, ciphertext} semua base64'],
    ['4', 'Server relay', 'Hanya forward — tidak ada decrypt() di server'],
    ['5', 'Client decrypt', 'Verifikasi authTag (16B) → reject jika tampering'],
  ];
  let y = 2.0;
  steps.forEach(([n, t, d]) => {
    s.addShape('ellipse', { x: 0.5, y, w: 0.5, h: 0.5, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(n, { x: 0.5, y, w: 0.5, h: 0.5, ...F.body, bold: true, color: '0F172A', align: 'center', valign: 'middle' });
    s.addText(t, { x: 1.15, y, w: 5.4, h: 0.25, ...F.body, bold: true });
    s.addText(d, { x: 1.15, y: y + 0.25, w: 5.4, h: 0.25, ...F.small });
    y += 0.65;
  });

  // Code kanan
  s.addShape('roundRect', { x: 6.9, y: 1.5, w: 6.0, h: 4.5, fill: { color: '0B1220' }, line: { color: C.card, width: 1 }, rectRadius: 0.05 });
  s.addText('// src/shared/crypto-utils.js (Node)\n' +
            "// public/crypto.js (Browser, Web Crypto API)\n\n" +
            "// === KEY DERIVATION ===\n" +
            "const KEY = crypto.pbkdf2Sync(\n" +
            "  PASSPHRASE,\n" +
            "  Buffer.from('securechat-salt-v1'),\n" +
            "  100_000, 32, 'sha256'\n" +
            ");\n\n" +
            "// === ENCRYPT (AES-256-GCM) ===\n" +
            "const iv = crypto.randomBytes(12);\n" +
            "const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);\n" +
            "const ct  = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);\n" +
            "const tag = cipher.getAuthTag();\n" +
            "return { iv, authTag: tag, ciphertext: ct };   // base64 on wire\n\n" +
            "// === DECRYPT (server never calls this) ===\n" +
            "const dec = crypto.createDecipheriv('aes-256-gcm', KEY, iv);\n" +
            "dec.setAuthTag(authTag);   // integrity check\n" +
            "const pt = dec.update(ct, undefined, 'utf8') + dec.final('utf8');", {
    x: 7.05, y: 1.6, w: 5.75, h: 4.3, ...F.code, valign: 'top',
  });

  // Highlight bawah
  s.addText('✓ Random IV per pesan (no reuse)   ✓ Auth tag 16B (GCM integrity)   ✓ Server zero-knowledge', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.3, ...F.small, align: 'center', color: C.good,
  });

  s.addText('5', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 6 — Protokol & Routing (teknikal #3b: logika)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Implementasi Teknis #2 · Protokol & Routing Pesan');

  // Tabel protokol
  s.addText('Message Types (newline-delimited JSON)', { x: 0.5, y: 1.5, w: 7, h: 0.35, ...F.h2 });
  s.addTable([
    [{ text: 'Type', options: { bold: true, color: C.accent, fill: { color: C.card } } },
     { text: 'Arah', options: { bold: true, color: C.accent, fill: { color: C.card } } },
     { text: 'Field kunci', options: { bold: true, color: C.accent, fill: { color: C.card } } }],
    ['join / welcome',     'C↔S', 'name, room, users[]'],
    ['message / roomMessage', 'C↔S', 'room/to, encrypted, ttl?, id'],
    ['dm',                 'C↔S', 'to, encrypted, ttl?, echo?'],
    ['file',               'C↔S', 'fileName, mimeType, size, encrypted'],
    ['destroy',            'S→C', 'id (sinyal TTL expire)'],
    ['joinRoom / createRoom / leaveRoom', 'C→S', 'room'],
    ['boardBegin / Draw / End / Clear / State', 'C↔S', 'x, y, color, size, tool'],
  ], {
    x: 0.5, y: 1.95, w: 7.0, h: 3.0,
    fontFace: 'Inter', fontSize: 10, color: C.text, valign: 'middle', border: { type: 'solid', pt: 0.5, color: C.card },
    colW: [2.2, 1.0, 3.8],
  });

  // Kanan: routing rules
  s.addText('Logika Routing Server', { x: 7.8, y: 1.5, w: 5, h: 0.35, ...F.h2 });

  s.addShape('roundRect', { x: 7.8, y: 1.95, w: 5.0, h: 1.5, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.05 });
  s.addText('message (room)', { x: 7.95, y: 2.0, w: 4.7, h: 0.3, ...F.body, bold: true, color: C.accent });
  s.addText('broadcastToRoom(roomName, msg)\n→ hanya member Set<socket> dari rooms[room]', {
    x: 7.95, y: 2.3, w: 4.7, h: 1.1, ...F.body, fontSize: 10.5, valign: 'top',
  });

  s.addShape('roundRect', { x: 7.8, y: 3.6, w: 5.0, h: 1.5, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.05 });
  s.addText('dm (1-ke-1)', { x: 7.95, y: 3.65, w: 4.7, h: 0.3, ...F.body, bold: true, color: C.accent });
  s.addText('findSocketByName(msg.to)\n→ kirim ke target; echo balik ke sender\n→ typing indicator hanya ke target', {
    x: 7.95, y: 3.95, w: 4.7, h: 1.1, ...F.body, fontSize: 10.5, valign: 'top',
  });

  s.addShape('roundRect', { x: 7.8, y: 5.25, w: 5.0, h: 1.5, fill: { color: C.card }, line: { color: C.accent2, width: 1 }, rectRadius: 0.05 });
  s.addText('board* (whiteboard)', { x: 7.95, y: 5.3, w: 4.7, h: 0.3, ...F.body, bold: true, color: C.accent });
  s.addText('_boardRecipients(room)\n→ broadcast ke semua member room\n→ server tidak simpan isi canvas (ephemeral)', {
    x: 7.95, y: 5.6, w: 4.7, h: 1.1, ...F.body, fontSize: 10.5, valign: 'top',
  });

  s.addText('6', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 7 — Fitur Whiteboard (teknikal #3c: kecepatan)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Implementasi Teknis #3 · Collaborative Whiteboard');

  // Kiri: state
  s.addText('Optimasi untuk Real-time', { x: 0.5, y: 1.5, w: 6, h: 0.4, ...F.h2 });
  bullet(s, [
    'Throttled broadcast: `boardDraw` dikirim max ~40 Hz (interval 25ms) — anti-flood.',
    'DPR-aware canvas: backing store di-scale ke devicePixelRatio → gambar tajam di HiDPI.',
    'Per-room state: `strokesByRoom[room] = []` → pindah room = canvas berbeda.',
    'Local-first rendering: gambar di-canvas dulu, lalu kirim event ke server (responsif).',
    'Sanitasi input server: tool/color/size di-validate sebelum relay (anti injection).',
    'Cursor labels per user: `board-cursor-label[data-user]` mengikuti pointer remote.',
  ], 0.5, 2.0, 6.0, 4.5);

  // Kanan: kode
  s.addShape('roundRect', { x: 6.9, y: 1.5, w: 6.0, h: 4.5, fill: { color: '0B1220' }, line: { color: C.card, width: 1 }, rectRadius: 0.05 });
  s.addText('// public/app.js — pointer handler\n' +
            'function boardPointerDown(e) {\n' +
            '  board.drawing = true;\n' +
            '  const p = boardGetPos(e);\n' +
            '  board.currentStroke = { user:state.me,\n' +
            '    color:board.color, width:board.width, tool:board.tool, points:[p] };\n' +
            '  send({ type:"boardBegin", room:state.activeRoom, color:board.color,\n' +
            '         size:board.width, tool:board.tool, x:p.x, y:p.y, user:state.me });\n' +
            '}\n\n' +
            'function boardPointerMove(e) {\n' +
            '  if (!board.drawing) return;\n' +
            '  const p = boardGetPos(e);\n' +
            '  board.currentStroke.points.push(p);\n' +
            '  drawStrokeOnCtx(board.ctx, /* incremental segment */);\n' +
            '  if (now - board.lastSentAt > 25) { board.lastSentAt = now;\n' +
            '    send({ type:"boardDraw", room:state.activeRoom, user:state.me, points:[p] });\n' +
            '  }\n' +
            '}', {
    x: 7.05, y: 1.6, w: 5.75, h: 4.3, ...F.code, valign: 'top',
  });

  s.addText('Whiteboard & chat paralel — user bisa coret & kirim pesan teks di room yang sama.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.3, ...F.small, align: 'center', italic: true,
  });
  s.addText('7', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 8 — Hasil: Testing & Demo
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Hasil · Testing & Bukti Berjalan');

  // Stats
  const stats = [
    { v: '5+3+1', l: 'Test files\n(unit+integration+e2e)' },
    { v: '0', l: 'npm dependency\n(100% stdlib)' },
    { v: '5', l: 'Fitur utama\nChat, Room, DM, TTL, File, Board' },
    { v: '100k', l: 'PBKDF2 iterasi\n(key derivation)' },
  ];
  stats.forEach((st, i) => {
    const x = 0.5 + i * 3.1;
    s.addShape('roundRect', { x, y: 1.5, w: 2.9, h: 1.5, fill: { color: C.card }, line: { color: C.accent, width: 1 }, rectRadius: 0.08 });
    s.addText(st.v, { x, y: 1.6, w: 2.9, h: 0.6, fontFace: 'Inter', fontSize: 28, bold: true, color: C.accent, align: 'center' });
    s.addText(st.l, { x: x + 0.1, y: 2.25, w: 2.7, h: 0.7, ...F.small, align: 'center' });
  });

  // Test command
  s.addShape('roundRect', { x: 0.5, y: 3.2, w: 12.3, h: 1.0, fill: { color: '0B1220' }, line: { color: C.card, width: 1 }, rectRadius: 0.05 });
  s.addText('$ npm test\n> node tests/run-all.js\n# Unit: 5 file PASS  ·  Integration: 3 file PASS  ·  E2E: 1 file PASS', {
    x: 0.7, y: 3.3, w: 11.9, h: 0.8, ...F.code, valign: 'middle',
  });

  // Demo steps
  s.addText('🚀 Demo (3 terminal + 1 browser)', { x: 0.5, y: 4.4, w: 12, h: 0.4, ...F.h2 });
  bullet(s, [
    'Terminal A: `npm run server`  → TCP :9000 + log koneksi',
    'Terminal B: `npm run web`     → buka http://localhost:8080 (user "bob")',
    'Terminal C: `npm run client -- --name alice`  → chat CLI',
    'Bukti: kirim pesan room → broadcast  ✓    /dm bob halo → hanya bob  ✓    coret whiteboard → sinkron real-time  ✓',
  ], 0.5, 4.85, 12.3, 2.0);

  s.addText('8', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 9 — Pembuktian Logika (snippet server)
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Pembuktian Logika · Inti Server');

  s.addShape('roundRect', { x: 0.5, y: 1.5, w: 12.3, h: 5.3, fill: { color: '0B1220' }, line: { color: C.card, width: 1 }, rectRadius: 0.05 });
  s.addText('// src/server/server.js — routing & whiteboard relay\n\n' +
            'function handleMessageObj(socket, obj) {\n' +
            '  const info = clients.get(socket);\n' +
            '  if (!info) return;\n' +
            '\n' +
            '  // 1. CHAT: route by room or direct\n' +
            '  if (obj.type === "message") {\n' +
            '    if (obj.direct) {\n' +
            '      const target = findSocketByName(obj.to);\n' +
            '      if (!target) return sendErr(socket, "user not found");\n' +
            '      io.sendTo(target, { type:"message", from:info.name, direct:true, ... });\n' +
            '      io.sendTo(socket, { ...outgoing, echo:true });   // ack ke pengirim\n' +
            '      if (obj.ttl) ttlManager.add(id, obj.ttl, [target, socket], {...});\n' +
            '    } else {\n' +
            '      rooms.broadcastToRoom(obj.room, outgoing, socket);  // skip sender\n' +
            '    }\n' +
            '  }\n' +
            '\n' +
            '  // 2. WHITEBOARD: relay to all members of board room\n' +
            '  if (obj.type === "boardDraw") {\n' +
            '    const room = _boardRoom(socket);\n' +
            '    for (const peer of _boardRecipients(room)) {\n' +
            '      if (peer === socket) continue;\n' +
            '      io.sendTo(peer, { type:"boardDraw", user:info.name, x:obj.x, y:obj.y, color:obj.color });\n' +
            '    }\n' +
            '  }\n' +
            '\n' +
            '  // 3. TTL: periodic sweep broadcast destroy\n' +
            '  setInterval(() => ttlManager._sweep(), env.TTL_CLEANUP_INTERVAL);\n' +
            '}', {
    x: 0.7, y: 1.6, w: 11.9, h: 5.1, ...F.code, valign: 'top', fontSize: 12,
  });

  s.addText('9', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// SLIDE 10 — Penutup
// =============================================================
{
  const s = pptx.addSlide();
  master(s, 'Kesimpulan & Q&A');

  s.addShape('roundRect', { x: 0.5, y: 1.5, w: 12.3, h: 3.2, fill: { color: C.card }, line: { color: C.accent, width: 1 }, rectRadius: 0.1 });
  s.addText('📌 Ringkasan', { x: 0.7, y: 1.6, w: 12, h: 0.4, ...F.h, color: C.accent });
  bullet(s, [
    'Ide: chat + whiteboard dalam satu sistem E2E encrypted — produktivitas + privasi.',
    'Masalah & solusi: 6 masalah komunikasi (privasi, channel, DM, file, persistence, kolaborasi) → 5 fitur implementasi.',
    'Teknis: AES-256-GCM + PBKDF2 (ketepatan kriptografi) · routing 1-ke-1 vs broadcast (logika) · throttle 25ms + DPR canvas (kecepatan).',
    'Bukti: 9 test file PASS, zero dependency, demo 3-terminal + browser berjalan paralel.',
  ], 0.7, 2.05, 12, 2.6);

  // CTA / QnA
  s.addShape('roundRect', { x: 0.5, y: 4.9, w: 12.3, h: 1.8, fill: { color: C.bg }, line: { color: C.accent2, width: 1 }, rectRadius: 0.1 });
  s.addText('❓  Tanya Jawab', { x: 0.5, y: 5.05, w: 12.3, h: 0.6, fontFace: 'Inter', fontSize: 28, bold: true, color: C.accent2, align: 'center' });
  s.addText('Repo: [link]  ·  Demo: npm run server  →  npm run web  →  npm run client -- --name alice', {
    x: 0.5, y: 5.75, w: 12.3, h: 0.4, ...F.body, align: 'center', color: C.muted,
  });
  s.addText('Komunikasi Data — Informatika 2026', {
    x: 0.5, y: 6.2, w: 12.3, h: 0.4, ...F.small, align: 'center',
  });

  s.addText('10', { x: 12.5, y: 7.1, w: 0.5, h: 0.3, ...F.small, align: 'right' });
}

// =============================================================
// Save
// =============================================================
pptx.writeFile({ fileName: 'docs/CollabBoard.pptx' }).then(fn => {
  console.log('✓ Generated:', fn);
});
