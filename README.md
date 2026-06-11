# CollabBoard — E2E Encrypted Chat + Real-time Collaborative Whiteboard

> **Matakuliah:** Komunikasi Data — Informatika 2026
> **Tipe Proyek:** Chat multi-user **E2E encrypted** + **Whiteboard kolaboratif real-time**
> **Stack:** Node.js (zero npm deps) · Vanilla JS · AES-256-GCM · TCP + WebSocket

**CollabBoard** adalah aplikasi chat client-server dengan enkripsi *end-to-end* (E2E) yang
juga memiliki **whiteboard kolaboratif** (coret-bersama) **real-time** per room.
Pesan dienkripsi di sisi client (CLI & browser) dengan **AES-256-GCM** menggunakan
key yang diturunkan via **PBKDF2-SHA256 (100.000 iter)**.
Server **hanya meneruskan ciphertext** — server tidak bisa membaca plaintext.

Whiteboard di-render dengan **HTML5 Canvas**, distimasi ke `devicePixelRatio`
(tajam di HiDPI/Retina), dan setiap titik coretan di-broadcast **throttled ~40 Hz**
agar tidak flooding jaringan.

---

## Daftar Isi

- [Highlight](#-highlight)
- [Arsitektur](#-arsitektur)
- [Fitur Lengkap](#-fitur-lengkap)
- [Stack Teknologi](#-stack-teknologi)
- [Struktur Proyek](#-struktur-proyek)
- [Cara Menjalankan](#-cara-menjalankan)
- [Protokol Aplikasi](#-protokol-aplikasi)
- [Detail Enkripsi E2E](#-detail-enkripsi-e2e)
- [Detail Whiteboard Real-time](#-detail-whiteboard-real-time)
- [Perintah CLI Client](#-perintah-cli-client)
- [Konfigurasi Environment](#-konfigurasi-environment)
- [Testing](#-testing)
- [Pertanyaan yang Sering Ditanya Dosen (Q&A)](#-pertanyaan-yang-sering-ditanya-dosen-qa)
- [Security Notes](#-security-notes)
- [Roadmap](#-roadmap)
- [Author](#-author)

---

## Highlight

- 🔐 **E2E Encryption (AES-256-GCM + PBKDF2 100k)** — server zero-knowledge.
- 🎨 **Collaborative Whiteboard real-time** — coret bareng di canvas, throttle 25ms, sync via TCP.
- 🏠 **Multi-Room** — `#general` default, custom room `create`/`join`/`leave`.
- 💬 **Direct Message (DM)** — pesan privat 1-ke-1, di-route via `findSocketByName`.
- 💣 **Self-Destructing Messages (TTL)** — 5/10/30/60 detik, server broadcast `destroy`.
- 📎 **File Sharing terenkripsi** — s.d. 8 MB, ciphertext di-relay + disimpan di `uploads/`.
- 🌐 **Web UI** — single page app vanilla JS, dark/light theme, no framework.
- 💻 **CLI Client** — terminal chat dengan semua command (`/room`, `/dm`, `/file`, `/ttl`).
- 🚀 **Zero npm dependency** — semuanya pakai `node:*` stdlib. Portabel, audit-able.
- 🧪 **9 test file** (5 unit + 3 integration + 1 e2e) — `node --test`, tanpa framework testing.

---

## Arsitektur

```
                    ┌──────────────────────────┐
                    │   TCP Server (Node.js)   │
                    │   :9000                  │
                    │  • Rooms Service (Map)   │
                    │  • TTL Manager (sweep)   │
                    │  • File Store (disk)     │
                    │  • Whiteboard Relay      │
                    └────┬──────────────┬──────┘
                  TCP   │              │  TCP
            ┌───────────┴──┐    ┌──────┴────────┐
            │  CLI Client  │    │ Web Bridge    │
            │  net.Socket  │    │ :8080         │
            │  PBKDF2+GCM  │    │ HTTP+WS→TCP   │
            │  /room /dm   │    └──────┬────────┘
            └─────────────┘            │ WebSocket
                                       │
                                  ┌────┴─────┐
                                  │ Browser  │
                                  │ WebCrypto│
                                  │ Canvas   │
                                  │ DPR-aware│
                                  └──────────┘
```

**Prinsip utama**: server adalah **zero-knowledge relay** — semua enkripsi/dekripsi
terjadi di client. Server tidak pernah memanggil `createDecipheriv`.

---

## Fitur Lengkap

### Chat

| Fitur | Keterangan |
|-------|------------|
| **Multi-user** | Username 1-24 char (`A-Z 0-9 _ -`). Duplikat ditolak. |
| **History per room** | Maks 300 pesan (env `MSG_HISTORY_LIMIT`). Dikirim saat join. |
| **System messages** | Auto-broadcast saat user join/leave/buat room. |
| **Typing indicator** | Real-time signal "user X sedang mengetik". |
| **Ping/pong heartbeat** | `ping` → `pong` dengan timestamp. |

### Rooms

| Fitur | Keterangan |
|-------|------------|
| **Default room** | `#general` — semua user otomatis join. |
| **Custom room** | Buat/join via `createRoom`/`joinRoom`. |
| **Isolasi pesan** | `broadcastToRoom()` hanya ke member Set. |
| **Auto-cleanup** | Room kosong tetap ada (untuk history replay). |

### Direct Message (DM)

| Fitur | Keterangan |
|-------|------------|
| **Routing 1-ke-1** | `findSocketByName(to)` lalu `io.sendTo(target, msg)`. |
| **Echo ke sender** | Sender dapat `{echo:true}` agar UI menampilkan status "sent". |
| **TTL-aware** | DM juga bisa self-destruct. |

### Self-Destruct (TTL)

| Fitur | Keterangan |
|-------|------------|
| **Pilihan TTL** | 5 / 10 / 30 / 60 detik (web & CLI). |
| **Server-side sweep** | `setInterval` 50–5000ms (default 500ms), broadcast `destroy`. |
| **Auto UI remove** | Client dengar `destroy` → hapus DOM element. |
| **File TTL** | File upload juga ikut dihapus dari `uploads/`. |

### File Sharing

| Fitur | Keterangan |
|-------|------------|
| **Maks 8 MB** | `MAX_FILE_SIZE` env, default 8388608 bytes. |
| **E2E encrypted** | File dienkripsi di client, server hanya relay ciphertext. |
| **Persist di disk** | `uploads/{ts}_{rand}_{name}` dengan prefix check (anti traversal). |
| **Download** | `GET /download/{storedName}` dari web bridge. |
| **TTL-aware** | File hilang otomatis saat TTL expire. |

### Whiteboard (v1.2)

| Fitur | Keterangan |
|-------|------------|
| **Pen tool** | Coret warna + ukuran, default 3px. |
| **Per-room canvas** | `strokesByRoom[room] = []` — pindah room = canvas terpisah. |
| **Real-time sync** | `boardBegin`/`boardDraw`/`boardEnd` di-broadcast ke semua member room. |
| **Throttled send** | Kirim `boardDraw` maks 1x per 25ms (~40 Hz). |
| **DPR-aware** | Backing store di-scale ke `devicePixelRatio` (tajam di Retina). |
| **Local-first render** | Gambar lokal dulu, lalu broadcast — responsif. |
| **Cursor labels** | Indikator "alice is drawing" via `board-cursor-label`. |
| **Clear** | `boardClear` → server broadcast ke room. |

---

## Stack Teknologi

| Layer | Tools | Keterangan |
|-------|-------|------------|
| **Runtime** | Node.js ≥ 16 | Zero npm deps — semua pakai `node:*` stdlib. |
| **Crypto** | `node:crypto` (AES-256-GCM, PBKDF2-SHA256) | Standar industri, audited. |
| **TCP server** | `node:net` | Newline-delimited JSON protocol. |
| **HTTP + WebSocket** | `node:http` + `node:net` (raw WS upgrade) | Tanpa `ws` package — handshake & frame manual. |
| **File storage** | `node:fs` + `node:path` | Plain disk write, prefix check anti traversal. |
| **Web client** | Vanilla JS, HTML5 Canvas, Web Crypto API | No React/Vue/Tailwind. |
| **CLI client** | `node:readline`, `node:net` | TTY-based interactive prompt. |
| **Testing** | `node:test` (built-in) | Tanpa Jest/Mocha. |
| **Protokol** | JSON over TCP/WS, newline-delimited | 1 JSON object per baris. |

---

## Struktur Proyek

```
komdat/
├── README.md                      # File ini
├── PRD.md                         # Product Requirements Document
├── package.json                   # npm scripts saja (no deps)
├── .env.example                   # Template environment variables
│
├── src/
│   ├── server/                    # TCP server (port 9000)
│   │   ├── server.js              # Entry point: net.createServer + dispatcher
│   │   ├── crypto-utils.js        # AES-256-GCM helpers (encrypt/decrypt)
│   │   ├── rooms.js               # Rooms Map<name, {members, history}>
│   │   ├── ttl-manager.js         # Self-destruct sweep (setInterval)
│   │   └── file-store.js          # Upload/download ke ./uploads/
│   │
│   ├── client/
│   │   ├── cli-client.js          # Terminal client (readline + net.Socket)
│   │   ├── web-server.js          # HTTP :8080 + WebSocket bridge ke TCP
│   │   └── commands/              # Reserved untuk command modules
│   │
│   └── shared/
│       ├── protocol.js            # Message type constants + line splitter
│       └── validation.js          # Input validators (username, room, TTL)
│
├── public/                        # Static assets untuk web UI
│   ├── index.html                 # Single-page app shell
│   ├── app.js                     # Web app logic (chat + whiteboard)
│   ├── crypto.js                  # Web Crypto API wrapper
│   └── style.css                  # Dark/light theme
│
├── uploads/                       # File upload (auto-cleaned saat TTL)
├── downloads/                     # File download dari CLI client
│
├── tests/
│   ├── unit/                      # 5 file — crypto, validation, rooms, ttl, file-store
│   ├── integration/               # 3 file — 2-client broadcast, DM, board
│   ├── e2e/                       # 1 file — full flow join→chat→TTL
│   └── run-all.js                 # Orchestrator
│
├── scripts/
│   ├── test-all.sh                # Linux/Mac runner
│   └── test-all.bat               # Windows runner
│
└── docs/
    ├── PPT-outline.md             # Outline presentasi 10 slide
    ├── diagrams.md                # Diagram ASCII alur
    └── generate-pptx.js           # PPT generator (opsional, butuh pptxgenjs)
```

**Total baris kode** (tanpa `node_modules`): ~2.500 LOC server + client + web.

---

## Cara Menjalankan

### Prasyarat

- Node.js **≥ 16** (tested di 18 & 20).
- **Zero npm install** — semua pakai `node:*` stdlib.

### 1. Jalankan TCP Server

```bash
npm run server
# atau
node src/server/server.js
```

Output yang diharapkan:

```
[CollabBoard] TCP server listening on 0.0.0.0:9000
[CollabBoard] Default room: #general
[CollabBoard] Max file size: 8388608 bytes
[CollabBoard] Uploads dir: .../komdat/uploads
```

### 2. Jalankan Web Client (browser)

```bash
npm run web
# atau
node src/client/web-server.js
```

Buka `http://localhost:8080` di browser → masukkan username → mulai chat & coret.

### 3. Jalankan CLI Client (terminal, opsional)

```bash
npm run client -- --name alice
# atau interaktif:
node src/client/cli-client.js
```

### 4. Demo 3-terminal + 1 browser

```bash
# Terminal A
npm run server

# Terminal B
npm run web

# Terminal C
npm run client -- --name alice

# Browser
# http://localhost:8080  (login sebagai "bob")
```

**Bukti realtime**:
- Ketik pesan di Terminal C → muncul di browser & sebaliknya.
- Coret di canvas browser user A → muncul real-time di canvas user B.
- `/_ttl 5` di CLI → pesan berikut akan self-destruct dalam 5 detik.

---

## Protokol Aplikasi

**Transport**: TCP (port 9000) atau WebSocket (via web bridge di port 8080).
**Encoding**: JSON, satu object per baris (`\n` delimited). Server pakai `makeLineSplitter()` untuk parse incremental.

### Tipe Message

| Type | Arah | Field | Keterangan |
|------|------|-------|------------|
| `join` | C→S | `name` | Handshake. Balasan: `welcome`. |
| `welcome` | S→C | `name, id, room, rooms, users` | Info awal setelah join. |
| `message` | C→S | `room?, encrypted, ttl?, id?` | Chat ke room. |
| `dm` | C→S | `to, encrypted, ttl?, id?` | Direct message. |
| `roomMessage` | S→C | `room, from, encrypted, id, ttl?` | Broadcast room. |
| `message` (direct) | S→C | `from, to, encrypted, direct:true, echo?` | DM ke/dari target. |
| `users` | S→C | `users[], count` | Daftar user online. |
| `rooms` | S→C | `rooms[]` | Daftar room + member count. |
| `system` | S→C | `text` | Notifikasi sistem (join/leave/clear). |
| `typing` | Both | `from, to?, direct?, room?` | Indikator typing. |
| `file` | Both | `fileName, mimeType, size, encrypted, direct?, to?, room?, ttl?` | File sharing. |
| `joinRoom` / `createRoom` / `leaveRoom` | C→S | `room` | Room management. |
| `destroy` | S→C | `id, scope?, peer?, room?` | Sinyal TTL expire. |
| `history` | S→C | `room, items[]` | Backfill pesan saat join. |
| `ping` / `pong` | Both | `ts?` | Heartbeat / latency check. |
| `error` | S→C | `text` | Error response. |
| `boardBegin` | C→S / S→C | `room, user, x, y, color, size, tool` | Mulai satu coretan. |
| `boardDraw` | C→S / S→C | `room, user, x, y, color, size, tool` | Titik tambahan coretan. |
| `boardEnd` | C→S / S→C | `room, user` | Akhir satu coretan. |
| `boardClear` | C→S / S→C | `room, from` | Hapus semua coretan di room tsb. |
| `boardState` | C→S / S→C | `room, on` | Toggle visibility (informational). |
| `boardTool` | C→S / S→C | `room, user, tool, color, size` | Broadcast tool change. |

### Aturan Routing Inti

1. **Room message**: `rooms.broadcastToRoom(room, msg, except=sender)` — hanya member Set.
2. **DM**: `findSocketByName(to)` → `io.sendTo(target, msg)`, echo `{echo:true}` balik ke sender.
3. **Whiteboard**: Server hanya **relay** — tidak simpan pixel. Strokes cache di client per room.
4. **Sanitasi**: `tool` di-slice 24 char, `color` di-slice 16 char, `x/y/size` di-validasi `isFinite`.

---

## Detail Enkripsi E2E

### Key Derivation

```js
const KEY = crypto.pbkdf2Sync(
  PASSPHRASE,                              // shared secret (env var)
  Buffer.from('securechat-salt-v1'),       // salt
  100_000,                                 // iterasi PBKDF2
  32,                                      // 32 byte = 256 bit
  'sha256'                                 // HMAC-SHA256
);
```

- **Passphrase** disimpan di env `SHARED_KEY_PASSPHRASE` (default fallback untuk demo).
- **Salt** hardcoded — di produksi, salt random per-deployment.
- **100.000 iter** = standar OWASP 2023 untuk PBKDF2-SHA256.

### Envelope per Pesan

Setiap plaintext dienkripsi dengan **AES-256-GCM**:

```js
const iv     = crypto.randomBytes(12);          // 12 byte IV random per pesan
const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
const ct     = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
const tag    = cipher.getAuthTag();             // 16 byte auth tag (integrity)

return { iv, authTag: tag, ciphertext: ct };    // semua base64
```

**Yang dikirim lewat server**: `{iv, authTag, ciphertext}` (base64).
**Server TIDAK PERNAH** punya key → tidak bisa decrypt → zero-knowledge relay.

### Integritas

`authTag` 16 byte adalah **GHASH** dari ciphertext — jika ada byte yang berubah
di tengah jalan (man-in-the-middle), `decipher.setAuthTag(tag)` akan throw
`Unsupported state or unable to authenticate data` dan client reject pesan.

---

## Detail Whiteboard Real-time

### Alur 1 Coretan

```
User A                          Server                       User B, C, ...
  │                               │                               │
  │── boardBegin(x,y,color) ─────>│                               │
  │                               │── boardBegin ────────────────>│
  │<── (local render dot 1) ──────│<── (render dot 1) ────────────│
  │                               │                               │
  │── boardDraw(x2,y2) ──────────>│── boardDraw ─────────────────>│
  │── boardDraw(x3,y3) ──────────>│── boardDraw ─────────────────>│
  │   (throttle 25ms)             │                               │
  │   ...                         │                               │
  │── boardEnd ──────────────────>│── boardEnd ──────────────────>│
  │                               │                               │
```

### Optimasi Performa

- **Throttled broadcast**: `boardDraw` dikirim max ~40 Hz (interval 25ms) — anti-flood.
  - Kode: `if (now - board.lastSentAt > 25) { send(...) }`.
- **DPR-aware canvas**: `canvas.width = cssW * devicePixelRatio` → tajam di HiDPI/Retina.
- **Per-room state**: `state.strokesByRoom[room]` → pindah room = canvas berbeda.
- **Local-first rendering**: gambar di canvas lokal dulu, baru kirim event — responsif.
- **Incremental draw**: server hanya kirim `x,y` (delta), bukan seluruh stroke.

### Struktur State (client)

```js
state.strokesByRoom = {
  'general': [
    { user:'alice', color:'#fff', size:3, points:[[10,10],[12,14],...] },
    ...
  ],
  'design':   [...]
}
```

Pindah room → render ulang dari `state.strokesByRoom[room]`.

---

## Perintah CLI Client

| Perintah | Fungsi | Contoh |
|----------|--------|--------|
| `/help` | Tampilkan bantuan | `/help` |
| `/list` | Daftar user online | `/list` |
| `/rooms` | Daftar semua room | `/rooms` |
| `/room create <nama>` | Buat & join room baru | `/room create design` |
| `/room join <nama>` | Join room | `/room join design` |
| `/room leave` | Keluar room aktif | `/room leave` |
| `/dm <user> <pesan>` | Kirim DM | `/dm bob halo!` |
| `/file <path>` | Kirim file ke room aktif | `/file ./laporan.pdf` |
| `/dmfile <user> <path>` | Kirim file via DM | `/dmfile bob ./foto.jpg` |
| `/ttl <detik>` | Set TTL sekali pakai | `/ttl 10` (untuk pesan berikutnya) |
| `/quit` | Keluar | `/quit` |

**Plain text** (tanpa `/`) = kirim pesan terenkripsi ke room aktif.

---

## Konfigurasi Environment

Semua via `.env` (di-load manual di `server.js`) atau `export VAR=value`.

| Variable | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `9000` | TCP server port (chat protocol). |
| `HTTP_PORT` | `8080` | HTTP + WebSocket bridge port (web UI). |
| `HOST` | `0.0.0.0` | Bind address. |
| `MAX_FILE_SIZE` | `8388608` (8 MB) | Maks ukuran file upload. |
| `TTL_CLEANUP_INTERVAL` | `500` | TTL sweep interval (ms). Clamp [50, 5000]. |
| `MSG_HISTORY_LIMIT` | `300` | Maks history per room. |
| `SHARED_KEY_PASSPHRASE` | `chat-encrypted-key-2026-...` | PBKDF2 passphrase (E2E). |

Lihat `.env.example` untuk template.

---

## Testing

```bash
# Semua test
npm test

# Per grup
npm run test:unit         # 5 file
npm run test:integration  # 3 file
npm run test:e2e          # 1 file

# Atau langsung
node tests/run-all.js unit
node tests/run-all.js integration
node tests/run-all.js e2e
```

**Coverage**:

- **Unit (5 file)**: crypto round-trip, IV uniqueness, auth tag verification,
  validation regex, rooms add/remove/broadcast, TTL sweep, file-store path protection.
- **Integration (3 file)**: 2-client chat broadcast, DM routing, board relay.
- **E2E (1 file)**: join → broadcast → DM → room switch → TTL self-destruct.

Hasil yang diharapkan:

```
Unit:        5 file PASS
Integration: 3 file PASS
E2E:         1 file PASS
Total: 9/9 file PASS, 0 fail
```

---

## Pertanyaan yang Sering Ditanya Dosen (Q&A)

### 1. "Kenapa pakai TCP, bukan UDP?"

TCP menjamin **ordered & reliable delivery** — penting untuk chat (pesan tidak boleh
hilang/urut) dan untuk handshake TLS. UDP cocok untuk voice/video tapi chat butuh
urutan. Whiteboard juga OK di TCP karena throttling sudah di 25ms.

### 2. "Bagaimana cara kerja enkripsi E2E?"

Lihat [Detail Enkripsi E2E](#-detail-enkripsi-e2e). Ringkas:
1. Client derive key dari passphrase via PBKDF2.
2. Setiap pesan dienkripsi AES-256-GCM (IV random 12 byte + auth tag 16 byte).
3. Server cuma forward `{iv, authTag, ciphertext}` — tidak bisa decrypt.

### 3. "Kenapa server tidak bisa baca pesan?"

Karena **server tidak pernah punya `KEY`** — key hanya di client (diturunkan dari
passphrase env). Server hanya memanggil `socket.write(JSON.stringify(ciphertextMsg))`.
**Zero-knowledge relay** — sama konsepnya seperti Signal/WhatsApp server.

### 4. "Apa itu auth tag dan kenapa penting?"

`authTag` 16 byte adalah **GHASH** (Galois Hash) yang menjamin **integritas**.
Jika ada 1 byte saja diubah di ciphertext saat transit (MITM), tag tidak akan cocok
saat decrypt → client reject. Ini melindungi dari tampering, bukan hanya eavesdropping.

### 5. "Bagaimana whiteboard bisa real-time?"

Lihat [Detail Whiteboard Real-time](#-detail-whiteboard-real-time). Ringkas:
- Throttle 25ms per titik (~40 Hz) agar tidak flooding.
- Local-first: render di canvas dulu, baru broadcast.
- Per-room state — strokes disimpan per room di client.

### 6. "Kalau ada 100 user, apakah TCP server kuat?"

`net.createServer` di Node.js async + single-threaded event loop, dengan
`setNoDelay(true)` untuk latensi rendah. Realistically ~500-1000 concurrent socket
terhandle. Untuk >10k user, perlu cluster (`node:cluster`) atau load balancer
(di roadmap v2.0).

### 7. "Apa bedanya room dan DM?"

- **Room**: `rooms.broadcastToRoom(name, msg, except)` → kirim ke semua member Set.
- **DM**: `findSocketByName(to)` → kirim ke 1 socket spesifik, dengan `{echo:true}` balik.

### 8. "Bagaimana cara kerja self-destruct (TTL)?"

Server punya `TtlManager` dengan `setInterval` (default 500ms) yang scan semua
entry dengan `expiresAt < now()`, lalu broadcast `{type:'destroy', id}` ke recipient.
Client dengar `destroy` → hapus DOM element. **Pesan dienkripsi saat transit,
tetap dienkripsi di history sampai expire.**

### 9. "Kenapa pakai Node.js stdlib, bukan Express/ws?"

Tujuan: **zero dependency** → portabel, audit-able, mudah di-demo-kan.
`node:http` sudah cukup untuk serve static + upgrade WebSocket manual.
Trade-off: code lebih panjang (handshake & frame WS ditulis manual),
tapi tidak ada `npm audit` issues dan tidak ada supply chain risk.

### 10. "Bagaimana cara deploy ke production?"

Lihat [Security Notes](#-security-notes). Minimum:
- Ganti `SHARED_KEY_PASSPHRASE` dengan ECDH key exchange.
- Tambah TLS (`tls.createServer` wrap `net.createServer`).
- Process manager (PM2/systemd) + reverse proxy (nginx) + rate limiting.
- Logging (pino/winston) + monitoring (Prometheus/Grafana).

### 11. "Apakah protokol ini scalable ke banyak user per room?"

Untuk 1 room dengan 50 user coret bareng: throttling 25ms per user = 50 × 40 = 2000
msg/sec ke server. Server relay ke 49 peer = ~100k msg/sec fanout. Realistically
TCP masih kuat, tapi latency akan naik. Untuk >100 user per room, perlu optimasi
(opsional: hierarchical broadcast, region-based relay, atau pindah ke WebRTC data channel).

### 12. "Apa kelebihan pakai JSON newline-delimited?"

- **Human-readable** → mudah di-debug pakai `nc localhost 9000`.
- **Stream-friendly** → `makeLineSplitter()` parse incremental, tidak perlu tunggu
  full message atau content-length.
- **Cross-language** → Python/Go/Rust bisa parse tanpa library khusus.
- **Trade-off**: tidak se-efisien binary protocol (Protobuf/MessagePack), tapi cukup
  untuk chat + whiteboard demo.

---

## Security Notes

- **Shared passphrase** untuk demo. Untuk produksi, **harus** ganti dengan **ECDH
  key exchange** (X25519) — sudah di roadmap v2.0.
- **Input validation**: username 1-24 char (`A-Z 0-9 _ -`), room 1-32 char,
  file size maks 8MB (config via `MAX_FILE_SIZE`).
- **Path traversal protection**: file upload disimpan dengan prefix `ts_random_`,
  path di-resolve via `path.basename` + prefix regex check.
- **No persistence**: pesan TIDAK disimpan permanen (cuma history in-memory per
  room, max 300). Server restart = history hilang.
- **Sanitasi server-side**: `tool` di-slice 24 char, `color` di-slice 16 char,
  `x/y/size` di-validasi `Number.isFinite` (anti injection/NaN DoS).
- **TTL auto-cleanup**: file di-`unlink()` saat expire.
- **WebSocket origin check**: `Origin` header divalidasi di handshake (anti CSWSH).

### Yang BELUM diimplementasi (v1.2)

- ❌ **TLS** untuk TCP — plaintext di localhost, OK untuk demo kampus.
- ❌ **Rate limiting** per IP — bisa di-bruteforce.
- ❌ **Authentication** — username self-asserted, tidak ada password.
- ❌ **E2E key rotation** — kalau 1 device compromised, semua history compromised.

---

## Roadmap (v2.0)

- [ ] **ECDH key exchange** (X25519) — ganti shared key, support multi-device
- [ ] **TLS** untuk TCP (`tls.createServer`)
- [ ] **Online presence** (heartbeat ping/pong dengan user list diff)
- [ ] **Message reactions** (emoji reactions)
- [ ] **Edit/delete message** (in-place update)
- [ ] **Database persistence** (SQLite/PostgreSQL) + migration script
- [ ] **Docker support** (multi-stage Dockerfile + docker-compose)
- [ ] **Cluster mode** (`node:cluster`) untuk horizontal scaling
- [ ] **Voice channel** (Opus codec via WebRTC)
- [ ] **Mobile app** (React Native wrapper)

---

## Dokumentasi Tambahan

- [PRD.md](PRD.md) — Product Requirements Document asli
- [docs/diagrams.md](docs/diagrams.md) — Diagram alir & arsitektur
- [docs/PPT-outline.md](docs/PPT-outline.md) — Outline presentasi 10 slide
- [docs/CollabBoard.pptx](docs/CollabBoard.pptx) — File PPT siap-presentasi (generate via `node docs/generate-pptx.js`)

---

## Lisensi

MIT — untuk kebutuhan akademis. Boleh dimodifikasi & di-distribusi.

---

## Author

**Komunikasi Data — Informatika 2026**

Repositori ini dibuat untuk tugas akhir matakuliah Komunikasi Data, dengan fokus
pada **implementasi protokol komunikasi data nyata** (TCP socket, JSON over TCP,
WebSocket, enkripsi E2E) dalam bentuk aplikasi yang **bisa dipakai langsung** —
bukan hanya teori.
