# PRD: SecureChat — End-to-End Encrypted Multi-User Chat

**Versi:** 1.1.0 (Redesign)
**Tanggal:** 2026-06-10
**Author:** Komunikasi Data — Informatika 2026

---

## 1. Ringkasan Eksekutif

SecureChat adalah aplikasi chat real-time client-server dengan enkripsi end-to-end AES-256-GCM. Proyek ini menggabungkan CLI (terminal) dan Web UI (browser) yang terhubung ke satu TCP server, memungkinkan komunikasi multi-user dengan keamanan berlapis.

Tujuan PRD ini adalah **merombak ulang struktur proyek** menjadi versi yang lebih modular, scalable, dan production-ready, sambil mempertahankan semua fitur yang sudah berjalan dan menambahkan 4 fitur baru.

---

## 2. Masalah & Motivasi

| Masalah | Dampak |
|---------|--------|
| Semua kode di file besar (server.js 207 baris, cli-client.js 378 baris) | Sulit di-maintain dan di-test |
| Hardcoded shared key di server & browser | Tidak aman untuk produksi |
| Tidak ada room/channel — semua user di 1 grup | Terbatas untuk penggunaan nyata |
| Tidak ada DM (private message) di versi awal | Fitur chat dasar belum lengkap |
| Tidak ada self-destruct message | Tidak ada fitur privasi lanjutan |
| Tidak ada file sharing yang fungsional | Komunikasi dokumen tidak bisa |
| Tidak ada struktur proyek (test, docs, config) | Sulit untuk kolaborasi dan pengembangan |

---

## 3. Fitur Saat Ini (v1.0 — Sudah Berfungsi)

| # | Fitur | Status | Keterangan |
|---|-------|--------|------------|
| 1 | TCP Server (`net.createServer`) | ✅ | Multi-connection, `new Map()` untuk tracking client |
| 2 | Enkripsi AES-256-GCM | ✅ | `{iv, authTag, ciphertext}` — server hanya relay ciphertext |
| 3 | CLI Client | ✅ | `node src/client/cli-client.js`, real-time chat di terminal |
| 4 | Web Server + Bridge | ✅ | HTTP + WebSocket bridge ke TCP server (satu proses) |
| 5 | Web UI | ✅ | Single-page app, bubble chat, dark/light-ready CSS |
| 6 | Multi-user broadcast | ✅ | Server broadcast pesan ke semua client |
| 7 | User list real-time | ✅ | Auto-update saat join/leave |
| 8 | Typing indicator | ✅ | Notifikasi "sedang mengetik" |
| 9 | Single entry point | ✅ | Cukup `npm run web` untuk jalankan semua |
| 10 | README lengkap | ✅ | Diagram alir, protokol, cara menjalankan |

---

## 4. Fitur Baru (v1.1 — Direncanakan)

### 4.1 Self-Destructing Messages (Auto-Delete)

**Deskripsi:** Pesan otomatis dihancurkan setelah timer tertentu (5s, 10s, 30s, 1m). Setelah expire, ciphertext dihapus dari semua client dan server mengirim sinyal `destroy` ke client terkait.

**Spesifikasi Teknis:**

- **Protocol (new server message types):**
  - `{ type: "destroy", id: "<msg_id>" }` — sinyal server ke client untuk menghapus pesan
  - Field `ttl` pada message: `{ type: "message", encrypted, ttl: 30, id: "abc123" }`
- **Client behavior:**
  - Setelah pesan diterima, client mulai countdown timer
  - Saat expire: hapus pesan dari UI, clear DOM node, clear local timer
  - Server juga cleanup file upload terkait jika ada TTL
- **UI (Web):** Visual countdown di bubble (ikon timer kecil), pesan fade-out sebelum hilang
- **UI (CLI):** Badge `⏱30s` di samping pesan, pesan fade/garish setelah expire

**File yang berubah:**
- `src/server/server.js` — tambahkan TTL handling di handler `message` dan `file`
- `src/client/cli-client.js` — tambah timer auto-destroy
- `public/app.js` — tambah countdown timer per message bubble
- `public/style.css` — styling countdown badge + fade animation

---

### 4.2 File Sharing Antar User

**Deskripsi:** User bisa mengirim file (gambar, dokumen, dll) ke group atau ke user tertentu via DM. File di-encrypt sebelum dikirim, disimpan di server, dan bisa di-download.

**Spesifikasi Teknis:**

- **Protocol (existing + enhancement):**
  - `{ type: "file", fileName, mimeType, encrypted, direct: bool, to: name|null, ttl: int|null }`
  - File max 8MB (configurable via `MAX_FILE_SIZE` env var)
- **Server behavior:**
  - Simpan file di `uploads/` dengan nama unik `{timestamp}_{random}_{originalName}`
  - Generate link download: `GET /download/{filename}`
  - Delete file saat TTL expire (jika ada)
- **Client (Web):**
  - File input via drag-drop atau button picker
  - Read file via FileReader API, encrypt, kirim base64
  - Setelah diterima: tampilkan thumbnail (untuk image) atau file icon + nama
  - Download via link ke `/download/{filename}`
- **Client (CLI):**
  - `/file <path>` — kirim file ke semua user
  - `/dmfile <user> <path>` — kirim file ke user tertentu
  - Auto-save file yang diterima ke `downloads/`

**File yang berubah:**
- `src/server/server.js` — tambah MAX_FILE_SIZE config, TTL cleanup untuk file
- `src/client/cli-client.js` — sudah ada, tinggal perbaiki handling encrypted file content
- `public/app.js` — implement actual file read + encrypt + upload
- `public/crypto.js` — perlu streaming untuk file besar (optional v1.2)
- `public/style.css` — styling file thumbnail, download button

---

### 4.3 Private Message / Direct Message (DM)

**Deskripsi:** User bisa mengirim pesan privat ke user tertentu. DM terenkripsi dengan key yang sama, tapi hanya diteruskan ke target user (bukan broadcast).

**Spesifikasi Teknis:**

- **Protocol (existing + enhancement):**
  - `{ type: "dm", to: username, encrypted, ttl: int|null }`
  - `{ type: "dm", from: username, encrypted, echo: bool, ttl: int|null }` — server reply
  - `{ type: "typing", to: username, direct: true }` — typing indicator per-DM
- **Server behavior:**
  - Validasi target user exists
  - Kirim ke target via `findSocket(to)`
  - Echo ke pengirim dengan flag `echo: true` (supaya client tahu terkirim)
  - Typing indicator hanya ke target, bukan broadcast
- **Client (Web):**
  - Tab "Users" di sidebar — klik user untuk buka DM thread
  - Chat list di sidebar: Group + DM thread terpisah
  - Message cache per-user (`msgCache.dm[username]`)
  - Typing indicator khusus per-DM
- **Client (CLI):**
  - `/dm <user> <pesan>` — kirim DM
  - `/typing` — typing indicator per-DM (existing)
  - DM diterima dengan prefix `[DM → kamu]` atau `[DM ← user]`

**File yang berubah:**
- `src/server/server.js` — sudah ada handler `message { direct: true }`, perbaiki agar lebih clean
- `src/client/cli-client.js` — sudah ada `/dm`, perbaiki handling response
- `public/app.js` — DM view sudah ada, pastikan routing benar
- `public/style.css` — styling DM view, chat list per-user

---

### 4.4 Custom Room / Channel

**Deskripsi:** User bisa membuat dan join room/channel terpisah. Pesan di room tertentu hanya dilihat oleh member room tersebut. Default room: `general`.

**Spesifikasi Teknis:**

- **Protocol (new):**
  - `{ type: "joinRoom", room: "general" }` — join room
  - `{ type: "createRoom", room: "channel_name" }` — buat room baru
  - `{ type: "leaveRoom", room: "general" }` — keluar dari room
  - `{ type: "rooms" }` — server reply `{ type: "rooms", rooms: [{name, members}] }`
  - `{ type: "message", room: "general", encrypted }` — pesan di room tertentu
  - `{ type: "system", text: "X joined room Y" }` — notifikasi room
- **Server behavior:**
  - `rooms = new Map()` — roomName -> { members: Set<socket>, history: [] }
  - `defaultRoom = "general"` (auto-created saat server start)
  - Broadcast hanya ke member room, bukan seluruh client
  - User bisa join multiple room sekaligus (atau single room per socket — rekomendasi: single untuk simplicity)
- **Client (Web):**
  - Sidebar chat list: Group (general) + room list
  - Tombol "Create Room" di sidebar
  - Chat header: nama room + member list
- **Client (CLI):**
  - `/room create <nama>` — buat room baru
  - `/room join <nama>` — join room
  - `/room leave` — keluar dari room
  - `/room list` — daftar semua room
  - Auto-join `general` saat pertama connect

**File yang berubah:**
- `src/server/server.js` — tambahan besar: room system, `joinRoom`, `createRoom`, `leaveRoom` handlers, room history
- `src/client/cli-client.js` — tambah `/room` commands
- `public/app.js` — tambah room list, room creation UI
- `public/style.css` — styling room-related UI elements
- `README.md` — update diagram alir & protokol

---

## 5. Arsitektur & Struktur Proyek Baru (v1.1)

### 5.1 Struktur File

```
chat-encrypted/
├── README.md                  # Dokumentasi utama
├── PRD.md                     # Dokumen ini
├── package.json               # Dependencies & scripts
├── .env.example               # Environment variables template
│
├── src/
│   ├── server/
│   │   ├── server.js          # TCP server entry point
│   │   ├── crypto-utils.js    # AES-256-GCM encryption utilities
│   │   ├── rooms.js           # Room/channel management [NEW]
│   │   ├── ttl-manager.js     # Self-destruct timer manager [NEW]
│   │   └── file-store.js      # File upload/store/cleanup [NEW]
│   │
│   ├── client/
│   │   ├── cli-client.js      # Terminal client
│   │   ├── web-server.js      # HTTP + WebSocket bridge
│   │   └── commands/          # CLI command handlers [NEW]
│   │       ├── help.js
│   │       ├── dm.js
│   │       ├── room.js
│   │       ├── file.js
│   │       └── ttl.js
│   │
│   └── shared/                # Shared utilities [NEW]
│       ├── protocol.js        # Message type constants
│       └── validation.js      # Input sanitization
│
├── public/
│   ├── index.html             # Main HTML
│   ├── app.js                 # Web app logic
│   ├── crypto.js              # Browser-side encryption
│   ├── style.css              # All styles
│   └── icons/                 # SVG icons [NEW]
│
├── uploads/                   # Uploaded files (auto-cleaned by TTL)
├── downloads/                 # CLI client downloads
│
├── tests/                     # Test suite [NEW]
│   ├── unit/
│   │   ├── crypto.test.js     # Encryption/decryption round-trip
│   │   └── validation.test.js # Input validation
│   ├── integration/
│   │   ├── chat.test.js       # Full chat flow (join, message, leave)
│   │   ├── dm.test.js         # DM send/receive
│   │   └── room.test.js       # Room create/join/leave
│   └── e2e/
│       └── e2e.test.js        # End-to-end with real server
│
└── scripts/                   # Utility scripts
    ├── test-all.bat           # Windows test runner
    └── test-all.sh            # Unix test runner
```

### 5.2 Perubahan Arsitektur

```
                    ┌──────────────┐
                    │  TCP Server  │
                    │  :9000       │
                    │              │
                    │ ┌──────────┐ │
                    │ │ Room Svc │ │
                    │ └──────────┘ │
                    │ ┌──────────┐ │
                    │ │ TTL Svc  │ │
                    │ └──────────┘ │
                    │ ┌──────────┐ │
                    │ │File Store│ │
                    │ └──────────┘ │
                    └───┬─────┬───┘
                        │     │
              ┌─────────┘     └─────────┐
              │ TCP (newline-delimited)  │
              │ JSON over TCP            │
              └──────────────────────────┘

    ┌──────────────┐              ┌──────────────┐
    │   CLI Client  │              │ Web Bridge    │
    │  (net.Socket) │              │ (HTTP+WS)     │
    │              │              │  :8080        │
    └──────────────┘              └──────┬───────┘
                                        │
                                   ┌────┴────┐
                                   │ Browser │
                                   │ Users   │
                                   └─────────┘
```

---

## 6. Protokol Message Types (v1.1)

### 6.1 Existing Types

| Type | Direction | Description |
|------|-----------|-------------|
| `join` | Client→Server | Join chat dengan username |
| `welcome` | Server→Client | Accepted dengan username |
| `message` | Both | Encrypted chat message (`encrypted`, `direct`, `to`, `ttl`, `id`) |
| `users` | Server→Client | User list (`users`, `count`) |
| `system` | Server→Client | System notification |
| `typing` | Both | Typing indicator |
| `file` | Both | File transfer |
| `leave` | Client→Server | Disconnect |
| `list` | Client→Server | Request user list |
| `ping`/`pong` | Both | Latency check |
| `error` | Server→Client | Error message |

### 6.2 New Types (v1.1)

| Type | Direction | Description |
|------|-----------|-------------|
| `destroy` | Server→Client | Self-destruct signal (`id`) |
| `joinRoom` | Client→Server | Join room (`room`) |
| `createRoom` | Client→Server | Create room (`room`) |
| `leaveRoom` | Client→Server | Leave room (`room`) |
| `rooms` | Server→Client | Room list (`rooms: [{name, members}]`) |
| `roomMessage` | Both | Message in specific room (`room`, `encrypted`) |

---

## 7. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9000` | TCP server port |
| `HTTP_PORT` | `8080` | HTTP/WebSocket bridge port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_FILE_SIZE` | `8388608` (8MB) | Max file upload size in bytes |
| `TTL_CLEANUP_INTERVAL` | `60000` (1m) | TTL cleanup check interval (ms) |
| `MSG_HISTORY_LIMIT` | `300` | Max messages per room before pruning |
| `SHARED_KEY_PASSPHRASE` | `chat-encrypted-key-2026-komunikasi-data` | Key derivation passphrase |

---

## 8. Security Considerations

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 1 | Enkripsi AES-256-GCM | ✅ | Confidentiality + integrity |
| 2 | Random IV per-message | ✅ | Setiap pesan punya IV unik |
| 3 | AuthTag verification | ✅ | Deteksi tampering |
| 4 | Server sebagai relay | ✅ | Server hanya forward ciphertext |
| 5 | **TODO: ECDH key exchange** | ⏳ | Ganti hardcoded shared key dengan key exchange |
| 6 | **TODO: Rate limiting** | ⏳ | Cegah abuse (spam, brute force) |
| 7 | Input sanitization | ✅ | Username 24 char max, file name sanitized |
| 8 | File path traversal protection | ✅ | `path.basename` + prefix check di `web-server.js` |

---

## 9. Implementation Plan

### Phase 1: Refactor (1-2 hari)
- [ ] Pisahkan room management (`rooms.js`)
- [ ] Pisahkan TTL manager (`ttl-manager.js`)
- [ ] Pisahkan file store (`file-store.js`)
- [ ] Pisahkan CLI commands (`src/client/commands/`)
- [ ] Tambah shared protocol constants
- [ ] Tambah `.env.example`

### Phase 2: Self-Destruct Messages (1 hari)
- [ ] Server: TTL tracking di `ttl-manager.js`
- [ ] Server: Broadcast `destroy` signal saat expire
- [ ] Client (Web): Countdown timer + fade-out animation
- [ ] Client (CLI): Timer cleanup + badge display
- [ ] Test: Set TTL 5s, verify pesan hilang

### Phase 3: File Sharing Enhancement (1 hari)
- [ ] Client (Web): FileReader + encrypt + upload
- [ ] Client (Web): Image thumbnail preview
- [ ] Client (Web): Download link dari server
- [ ] Client (CLI): Perbaiki save file ke `downloads/`
- [ ] Server: TTL cleanup untuk file
- [ ] Test: Upload image, verify download

### Phase 4: DM Enhancement (1 hari)
- [ ] Server: Perbaiki DM routing (existing partial)
- [ ] Client (Web): DM thread per-user di chat list
- [ ] Client (Web): DM message cache per-user
- [ ] Client (CLI): Perbaiki DM receive handler
- [ ] Test: 2 user, send/receive DM

### Phase 5: Room/Channel System (2 hari)
- [ ] Server: Room CRUD (`rooms.js`)
- [ ] Server: Room-based broadcast
- [ ] Server: Room membership tracking
- [ ] Client (Web): Room sidebar + create room UI
- [ ] Client (CLI): `/room` commands
- [ ] Test: 2 rooms, verify isolation

### Phase 6: Testing & Polish (1-2 hari)
- [ ] Unit tests: crypto, validation
- [ ] Integration tests: chat, DM, room flow
- [ ] E2E test: full flow dari CLI + Web
- [ ] Update README: diagram baru, protokol, cara run
- [ ] Fix bugs dari testing
- [ ] Final review code quality

**Total estimasi: 7-8 hari kerja**

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Semua fitur v1.0 tetap berfungsi | ✅ |
| 4 fitur baru (TTL, File, DM, Room) berjalan | ✅ |
| Unit test coverage > 70% | ✅ |
| E2E test semua flow berhasil | ✅ |
| Server handle 50+ concurrent connections | ✅ |
| File upload 8MB berhasil | ✅ |
| TTL expire tepat waktu (±2s) | ✅ |
| README lengkap dan update | ✅ |

---

## 11. Risks & Mitigasi

| Risk | Dampak | Mitigasi |
|------|--------|----------|
| TCP connection leak saat crash | Memory leak | `socket.on('error')` cleanup, `unref()` untuk idle |
| File upload besar blocking event loop | Performance drop | Async file write, chunked reading, size limit |
| Hardcoded key terdeploitasi | Security breach | Plan migrasi ke ECDH (next major version) |
| Banyak room → memory usage naik | Resource issue | Room history limit, auto-cleanup idle room |
| Browser crypto API tidak support | Compat issue | Fallback ke Web Crypto polyfill (optional) |

---

## 12. Future Roadmap (v2.0)

- [ ] **ECDH Key Exchange** — perbaiki shared key hardcoded
- [ ] **End-to-End Encryption Penuh** — server benar-benar tidak bisa decrypt
- [ ] **Online Status** — heartbeat ping/pong otomatis
- [ ] **Message Reactions** — emoji react pada pesan
- [ ] **Edit/Delete Message** — pesan bisa diedit/dihapus
- [ ] **Threaded Replies** — reply ke pesan tertentu
- [ ] **Notification Sound** — audio notifikasi pesan baru
- [ ] **Dark Mode** — tema gelap di web UI
- [ ] **Database Backend** — persist chat history (SQLite/PostgreSQL)
- [ ] **Docker Support** — containerized deployment

---

*End of PRD*
