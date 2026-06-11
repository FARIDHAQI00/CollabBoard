# Diagram Alir CollabBoard

> Versi ringkas — fokus fitur utama & alur proses utama untuk presentasi.

---

## A. Arsitektur Singkat

```
┌──────────────┐         ┌──────────────────────┐         ┌──────────────┐
│  CLI Client  │ ◄─TCP─► │  TCP Server (:9000)  │ ◄─TCP─► │ Web Bridge   │
│  (terminal)  │  JSON   │  CollabBoard core    │  JSON   │  (:8080)     │
│  • Encrypt   │  lines  │  • Relay (server tak │  lines  │  • HTTP stat │
│  • Commands  │         │    bisa decrypt)     │         │  • WS bridge │
└──────────────┘         │  • Rooms / DM / File │         └──────┬───────┘
                         │  • TTL / Whiteboard  │                │ WS
                         └──────────────────────┘                ▼
                                                              ┌────────┐
                                                              │Browser │
                                                              └────────┘
```

**Prinsip utama:** Server **hanya relay ciphertext** — tidak pernah punya KEY enkripsi.

---

## B. Enkripsi End-to-End (AES-256-GCM)

```
   ALICE (sender)         SERVER (relay)            BOB (receiver)
   ─────────────          ──────────────            ─────────────
   "halo"                                          
       │                                              
       │ PBKDF2 → 32B KEY                             
       │ IV = random 12 byte                          
       │ AES-256-GCM encrypt(KEY, IV, plaintext)      
       ▼                                              
   {iv, authTag, ciphertext} ──►  TIDAK punya KEY  ──►  decrypt(KEY, IV)
   (semua base64)               TIDAK bisa decrypt    verify authTag
                                                         → "halo" ✅
```

| Properti | Mekanisme |
|----------|-----------|
| Confidentiality | AES-256-GCM, key hanya di client |
| Integrity | GCM authTag 16 byte |
| Random IV | 12 byte per pesan |
| Server blind | Hanya forward base64 |

---

## C. Alur Chat Room (Join → Kirim Pesan)

```
   Alice              Server               Bob
     │                  │                   │
     │ ① join {name}    │                   │
     │ ────────────────►│ rooms.join(#general)
     │ ② welcome {name, │                   │
     │   room, users}   │                   │
     │ ◄────────────────│                   │
     │                  │ ① join {name}     │
     │                  │ ◄─────────────────│
     │                  │ ② welcome         │
     │                  │ ─────────────────►│
     │                  │                   │
     │ ③ message {room: │                   │
     │   "general",     │                   │
     │   encrypted, id} │                   │
     │ ────────────────►│                   │
     │                  │ broadcastToRoom   │
     │ ④ roomMessage ◄──│──────────────────►│ ④
     │ (echo, sama id)  │ pushHistory       │
```

**Kode inti** ([server.js:102-139](src/server/server.js#L102-L139), [server.js:141-169](src/server/server.js#L141-L169)):

```js
// Join: auto-join #general + welcome
rooms.join(socket, DEFAULT_ROOM);
io.sendTo(socket, { type: 'welcome', name, id, room: 'general', rooms, users });

// Kirim pesan: broadcast ke member room
const out = { type: 'roomMessage', room, from, id, encrypted, ttl, ts };
rooms.broadcastToRoom(room, out, null);
```

---

## D. Alur Direct Message (DM)

```
   Alice               Server              Bob
     │                   │                  │
     │ ① dm {to:"bob",   │                  │
     │   encrypted, id}  │                  │
     │ ─────────────────►│ ② findSocketBy-  │
     │                   │   Name("bob")    │
     │                   │ ③ send to target │
     │                   │ ────────────────►│
     │ ④ message         │                  │
     │   {echo:true,...} │                  │
     │ ◄─────────────────│                  │ → decrypt + render
```

**Kode** ([server.js:171-199](src/server/server.js#L171-L199)):

```js
const target = findSocketByName(msg.to);
io.sendTo(target, { type: 'message', from, direct:true, to, encrypted, ... });
io.sendTo(socket, { ...out, echo: true });   // Alice lihat "sent ✓"
```

**3 poin penting:**
1. Server **TIDAK forward** ke selain target + pengirim
2. **Echo flag** agar UI Alice render "terkirim"
3. TTL opsional → recipients = `{alice, bob}` saja

---

## E. Alur Room / Channel

```
   Alice              Server              Bob
     │                  │                  │
     │ ① createRoom     │                  │
     │   {room:"eng"}   │                  │
     │ ────────────────►│                  │
     │                  │ rooms._ensure()  │
     │                  │ (auto-create)    │
     │                  │ add Alice        │
     │                  │                  │
     │                  │ ② joinRoom       │
     │                  │ add Bob ────────►│
     │                  │                  │
     │ ③ message        │                  │
     │   {room:"eng",   │                  │
     │    encrypted,id} │                  │
     │ ────────────────►│ broadcastToRoom  │
     │ ④ roomMessage ◄──│──("eng")───────►│ ④
     │                  │                  │
     │ ⚠️ User di #general TIDAK terima     │
```

**Kode isolasi** ([rooms.js:68-78](src/server/rooms.js#L68-L78)):

```js
broadcastToRoom(roomName, obj, except) {
  for (const sock of this.rooms.get(roomName).members) {
    if (sock === except) continue;   // skip sender
    this.io.sendTo(sock, obj);        // HANYA member room
  }
}
```

---

## F. Alur Self-Destruct (TTL)

```
  t=0s                    t=30s                   t=30s + sweep
   │                       │                       │
   │ message {ttl:30, id}  │                       │
   ▼                       ▼                       ▼

  ┌─────────┐         ┌──────────────┐       ┌──────────────┐
  │ Server  │         │ TTL Manager  │       │  _sweep()    │
  │         │         │  entries:    │       │  now>=exp?   │
  │ ttl.add │────────► │  {id, exp,   │       │  yes:        │
  │  (id,30)│         │   recipients}│──────►│  delete(id)  │
  └─────────┘         └──────────────┘       │  for sock:   │
                                              │   send {     │
                                              │   destroy,id}│
                                              │  onExpire()  │
                                              │   → remove   │
                                              │     file     │
                                              └──────┬───────┘
                                                     │
                                                     ▼
                                              Bob: hapus bubble
                                              by id (fade-out)
```

**Kode sweep** ([ttl-manager.js:43-64](src/server/ttl-manager.js#L43-L64)):

```js
_sweep() {
  for (const [id, e] of this.entries) {
    if (e.expiresAt <= Date.now()) {
      this.entries.delete(id);
      for (const sock of e.recipients) {
        this.io.sendTo(sock, { type: 'destroy', id, scope: e.meta.scope });
      }
      this.onExpire(id, e.meta);   // → fileStore.removeFile()
    }
  }
}
// dipanggil setiap TTL_CLEANUP_INTERVAL (default 60 detik)
```

**Catatan:** Recipients di-snapshot saat `add()`; sweep delay bisa sampai +60s.

---

## G. Alur File Sharing

```
   Alice (web)            Server              Bob (browser)
   ───────────            ──────              ────────────
   Pilih file                                
       │                                    
       │ FileReader → encrypt → base64       
       │                                    
       │ ① file {fileName, size,             │
       │   encrypted, encrypted_ciphertext,  
       │   room, ttl?, id}                   
       │ ─────────────────►                  
                          │ ② validate size  
                          │ ③ sanitize name  
                          │ ④ save to disk   
                          │   storedName =   
                          │   <ts>_<rand>_<f> 
                          │ ⑤ broadcast      
                          │   {file, encrypted,
                          │    storedName}   
                          │ ────────────────►
                                            ⑥ decrypt
                                            • image: thumbnail
                                            • other: GET /download/<storedName>

   CLI path: /file ./doc.pdf
   readFile → base64 → encrypt → {type:'file',...}
   Bob (cli) → decrypt → save ke ./downloads/
```

**Proteksi:**
- `MAX_FILE_SIZE` (default 8MB)
- Path traversal: prefix regex `^\d+_[a-f0-9]+_`
- Auto-delete saat TTL expire via `onExpire` callback

---

## H. Alur Whiteboard (Drawing)

```
   Browser Alice              Server          Browser Bob
   ─────────────              ──────          ───────────
   mousedown                                 
       │ ① boardBegin {x, y, color}          
       │ ─────────────────►                  
                          broadcastToRoom    
                          ("general", msg)   
                                          ───►
                                          beginPath()
                                          moveTo(x,y)
                                          
   mousemove (loop)                         
       │ ② boardDraw {x, y}                 
       │ ─────────────────►                  
                                          ───►
                                          lineTo(x,y)
                                          stroke()
                                          
   mouseup                                  
       │ ③ boardEnd {}                      
                                          ───►
                                          closePath()
```

Server cuma relay koordinat — **tidak simpan state gambar**.

---

## I. Ringkasan Fitur Utama

| Fitur | Status | Highlight |
|-------|--------|-----------|
| Enkripsi E2E AES-256-GCM | ✅ | Server tidak bisa decrypt |
| Multi-room | ✅ | Isolasi per room (`broadcastToRoom`) |
| Direct Message | ✅ | `findSocketByName` + echo flag |
| Self-Destruct (TTL) | ✅ | Sweep periodik + auto-delete file |
| File Sharing | ✅ | Max 8MB, anti path-traversal |
| Whiteboard | ✅ | Relay koordinat, paralel dengan chat |
| WS Bridge | ✅ | Browser ↔ TCP via WebSocket |

---

*Update terakhir: 2026-06-11*
