# Outline Presentasi CollabBoard
> Matakuliah: Komunikasi Data — Informatika 2026
> Topik: E2E Encrypted Chat + Collaborative Whiteboard (TCP + Web)
> Durasi: 5–10 menit

> File PPT siap-presentasi: **[docs/CollabBoard.pptx](CollabBoard.pptx)**
> Generator: `node docs/generate-pptx.js` (butuh `pptxgenjs`)

---

## Fokus Penilaian

| # | Aspek | Slide |
|---|-------|-------|
| 1 | **Ide & latar belakang** tujuan proyek | Slide 2 |
| 2 | **Masalah & solusi** | Slide 3 |
| 3 | **Cara teknis membuat solusi** — ketepatan, kecepatan, logika | Slide 5, 6, 7, 9 |

---

## Slide 1 — Judul
- **CollabBoard** 🎨
- End-to-End Encrypted Chat + Real-time Collaborative Whiteboard
- Matakuliah: Komunikasi Data · Informatika · 2026
- Stack: Node.js stdlib (zero npm deps) · AES-256-GCM · TCP + WebSocket · Vanilla JS

---

## Slide 2 — Latar Belakang & Ide *(Penilaian #1)*

**3 masalah yang melatarbelakangi:**
1. 🔓 **Privasi lemah** — chat biasa kirim plaintext, bisa disadap admin/ISP/sniffer
2. 🧩 **Chat & visual terpisah** — produktivitas turun karena harus pindah aplikasi
3. 📡 **Teori vs praktik** — Komunikasi Data banyak teori, jarang implementasi protokol utuh

**Tujuan proyek:**
- Terapkan protokol komunikasi data nyata: TCP socket + newline-delimited JSON + WebSocket bridge
- Implementasi enkripsi E2E (AES-256-GCM + PBKDF2) — server tidak bisa baca plaintext
- Gabungkan chat + collaborative whiteboard dalam satu sistem (text + visual real-time)
- Zero dependency eksternal: Node.js stdlib + Web Crypto API — portabel, ringan, audit-able

---

## Slide 3 — Masalah & Solusi *(Penilaian #2)*

| Masalah | Solusi di CollabBoard |
|---------|----------------------|
| Pesan plaintext bisa disadap | AES-256-GCM end-to-end — client encrypt, server cuma relay ciphertext |
| Tidak ada kolaborasi visual real-time | Whiteboard canvas (pen/eraser/warna) sinkron via TCP broadcast |
| Semua user di 1 channel → noisy | Rooms/Channels: `#general` default + custom create/join/leave |
| DM lewat broadcast = bocor | Direct Message: routing 1-ke-1, hanya sender & target |
| Pesan sensitif tersimpan permanen | Self-Destructing Messages: TTL 5/10/30/60s, server kirim sinyal `destroy` |
| Kirim file lewat app lain | File Sharing terenkripsi (≤8MB), inline di chat, TTL-aware |

---

## Slide 4 — Arsitektur Sistem

```
                    ┌──────────────────────────┐
                    │   TCP Server (Node.js)   │
                    │   :9000                  │
                    │  • Rooms Service (Map)   │
                    │  • TTL Manager           │
                    │  • File Store            │
                    │  • Whiteboard Relay      │
                    └────┬──────────────┬──────┘
                  TCP   │              │  TCP
            ┌───────────┴──┐    ┌──────┴────────┐
            │  CLI Client  │    │ Web Bridge    │
            │  net.Socket  │    │ :8080         │
            │  PBKDF2+GCM  │    │ HTTP+WS→TCP   │
            │  /room /dm   │    └──────┬────────┘
            └──────────────┘           │ WebSocket
                                       │
                                  ┌────┴────┐
                                  │ Browser │
                                  │ WebCrypto│
                                  │ Canvas  │
                                  └─────────┘
```

**Prinsip utama:** server hanya relay — tidak pernah punya key enkripsi (zero-knowledge relay).

---

## Slide 5 — Teknis #1: Enkripsi E2E *(ketepatan)*

**Alur:**
1. Client derive 32B key: `PBKDF2-SHA256 · 100.000 iter`
2. Encrypt per pesan: `AES-256-GCM · IV random 12B (unik tiap pesan)`
3. Output envelope: `{iv, authTag, ciphertext}` semua base64
4. Server relay — tidak ada `decrypt()` di server
5. Client decrypt + verifikasi authTag (16B) → reject jika tampering

**Code (Node.js):**
```js
// === KEY DERIVATION ===
const KEY = crypto.pbkdf2Sync(
  PASSPHRASE, Buffer.from('securechat-salt-v1'),
  100_000, 32, 'sha256'
);

// === ENCRYPT ===
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
const ct  = Buffer.concat([cipher.update(plain,'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
return { iv, authTag: tag, ciphertext: ct };

// === DECRYPT (server never calls this) ===
const dec = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
dec.setAuthTag(authTag);  // integrity check
```

**✓ Random IV per pesan   ✓ AuthTag 16B (GCM integrity)   ✓ Server zero-knowledge**

---

## Slide 6 — Teknis #2: Protokol & Routing *(logika)*

**Message types (newline-delimited JSON):**

| Type | Arah | Field kunci |
|------|------|-------------|
| `join` / `welcome` | C↔S | name, room, users[] |
| `message` / `roomMessage` | C↔S | room/to, encrypted, ttl?, id |
| `dm` | C↔S | to, encrypted, ttl?, echo? |
| `file` | C↔S | fileName, mimeType, size, encrypted |
| `destroy` | S→C | id (sinyal TTL expire) |
| `joinRoom` / `createRoom` / `leaveRoom` | C→S | room |
| `boardBegin` / `boardDraw` / `boardEnd` / `boardClear` / `boardState` | C↔S | x, y, color, size, tool |

**3 aturan routing inti:**

1. **message (room)** → `broadcastToRoom(roomName, msg, except=sender)` — hanya member Set
2. **dm (1-ke-1)** → `findSocketByName(to)` — kirim ke target, echo balik ke sender, typing hanya ke target
3. **boardDraw** → `_boardRecipients(room)` — broadcast ke semua member room; server tidak simpan isi canvas (ephemeral)

---

## Slide 7 — Teknis #3: Whiteboard Real-time *(kecepatan)*

**Optimasi untuk real-time:**
- **Throttled broadcast**: `boardDraw` dikirim max ~40 Hz (interval 25ms) — anti-flood
- **DPR-aware canvas**: backing store di-scale ke `devicePixelRatio` → tajam di HiDPI
- **Per-room state**: `strokesByRoom[room] = []` → pindah room = canvas berbeda
- **Local-first rendering**: gambar di canvas dulu, baru kirim event (responsif)
- **Sanitasi input**: tool/color/size di-validate sebelum relay (anti injection)
- **Cursor labels**: `board-cursor-label[data-user]` mengikuti pointer remote

**Code (web):**
```js
function boardPointerMove(e) {
  if (!board.drawing) return;
  const p = boardGetPos(e);
  board.currentStroke.points.push(p);
  drawStrokeOnCtx(board.ctx, /* incremental segment */);
  if (now - board.lastSentAt > 25) {
    board.lastSentAt = now;
    send({ type:'boardDraw', room:state.activeRoom, user:state.me, points:[p] });
  }
}
```

**Whiteboard & chat paralel** — user bisa coret DAN kirim pesan teks di room yang sama.

---

## Slide 8 — Hasil: Testing & Bukti Berjalan

| Metrik | Nilai |
|--------|-------|
| Test files | 5 unit + 3 integration + 1 e2e — semua PASS |
| Dependency | 0 npm package (100% Node stdlib) |
| Fitur utama | 5 (Chat, Room, DM, TTL, File, Whiteboard) |
| PBKDF2 iterasi | 100.000 |

**Test command:**
```bash
$ npm test
> node tests/run-all.js
# Unit: 5 file PASS  ·  Integration: 3 file PASS  ·  E2E: 1 file PASS
```

**🚀 Demo (3 terminal + 1 browser):**
- Terminal A: `npm run server` → TCP :9000
- Terminal B: `npm run web` → buka `http://localhost:8080` (user "bob")
- Terminal C: `npm run client -- --name alice` → chat CLI
- Bukti: broadcast room ✓  ·  /dm private ✓  ·  whiteboard sinkron real-time ✓

---

## Slide 9 — Pembuktian Logika: Inti Server

```js
// src/server/server.js — routing & whiteboard relay
function handleMessageObj(socket, obj) {
  const info = clients.get(socket);
  if (!info) return;

  // 1. CHAT: route by room or direct
  if (obj.type === "message") {
    if (obj.direct) {
      const target = findSocketByName(obj.to);
      if (!target) return sendErr(socket, "user not found");
      io.sendTo(target, { type:"message", from:info.name, direct:true, ... });
      io.sendTo(socket, { ...outgoing, echo:true });
      if (obj.ttl) ttlManager.add(id, obj.ttl, [target, socket], {...});
    } else {
      rooms.broadcastToRoom(obj.room, outgoing, socket);
    }
  }

  // 2. WHITEBOARD: relay to room members
  if (obj.type === "boardDraw") {
    const room = _boardRoom(socket);
    for (const peer of _boardRecipients(room)) {
      if (peer === socket) continue;
      io.sendTo(peer, { type:"boardDraw", user:info.name, x:obj.x, y:obj.y, color:obj.color });
    }
  }

  // 3. TTL: periodic sweep broadcast destroy
  setInterval(() => ttlManager._sweep(), env.TTL_CLEANUP_INTERVAL);
}
```

---

## Slide 10 — Penutup

**📌 Ringkasan:**
- **Ide**: chat + whiteboard dalam satu sistem E2E — produktivitas + privasi
- **Masalah & solusi**: 6 masalah komunikasi → 5 fitur implementasi
- **Teknis**:
  - *Ketepatan* — AES-256-GCM + PBKDF2 100k iter + authTag verification
  - *Logika* — routing 1-ke-1 (DM) vs broadcast (room), sanitize semua input
  - *Kecepatan* — throttle 25ms, DPR canvas, local-first render
- **Bukti**: 9 test file PASS, zero dependency, demo 3-terminal + browser berjalan paralel

**❓ Q&A** · Repo: [link] · Demo: `npm run server` → `npm run web` → `npm run client -- --name alice`

---

## Catatan Presentasi

**Durasi:** 5-10 menit

**Yang harus ditonjolkan untuk setiap aspek penilaian:**

| Aspek | Slide | Highlight |
|-------|-------|-----------|
| Ide / latar belakang | 2 | "Chat & visual terpisah" + "Zero dependency" sebagai kebaruan |
| Masalah & solusi | 3 | Tabel 6-baris: setiap masalah punya solusi konkret yang diimplementasi |
| Teknis — ketepatan | 5 | AES-GCM + IV random per pesan + authTag 16B (bukan SHA manual) |
| Teknis — logika | 6, 9 | Routing branching: DM ≠ room ≠ broadcast; sanitasi di server |
| Teknis — kecepatan | 7 | Throttle 25ms, DPR scaling, local-first render, ephemeral canvas |

**Tip presentasi:**
- Buka `docs/CollabBoard.pptx` di PowerPoint/Google Slides/LibreOffice
- Siapkan 3 terminal + 1 browser saat Q&A untuk demo live
- Tunjukkan `npm test` PASS → bukti reliability
- Highlight baris `crypto.createDecipheriv` → tunjukkan server **tidak** punya kode decrypt = zero-knowledge relay
