/**
 * src/server/ttl-manager.js
 * ---------------------------------------------------------------------------
 * Manajer TTL (Time-To-Live) / pesan self-destruct.
 *
 *  - Saat TTL sebuah pesan/file kedaluwarsa, server mengirim sinyal
 *    { type:'destroy', id } ke semua client yang menerima pesan tersebut
 *    agar mereka bisa menghapus bubble/file dari UI.
 *  - TTL disimpan sebagai timestamp absolut dalam milidetik.
 *  - File upload yang terkait akan di-cleanup lewat callback onExpire
 *    yang dipasang oleh server (lihat src/server/server.js).
 * ---------------------------------------------------------------------------
 */

'use strict';

class TtlManager {
  constructor(io, { onExpire, intervalMs } = {}) {
    this.io = io;
    this.entries = new Map();        // id -> { expiresAt, scope, peer, room?, file? }
    this.onExpire = onExpire || (() => {});
    // Sweep cepat (default 500ms) supaya TTL pendek (5s/10s) langsung fires.
    // Clamp min 50ms, max 5s untuk mencegah abuse / hang.
    const envMs = parseInt(process.env.TTL_CLEANUP_INTERVAL || '500', 10);
    this.intervalMs = intervalMs || Math.max(50, Math.min(5000, envMs || 500));
    this._timer = setInterval(() => this._sweep(), this.intervalMs);
    this._timer.unref?.();
  }

  /**
   * Daftarkan item dengan TTL (detik). recipients: Set<socket> yang menerima
   * pesan (untuk membatasi sinyal destroy hanya ke mereka).
   */
  add(id, ttlSeconds, recipients, meta = {}) {
    if (!ttlSeconds || ttlSeconds <= 0) return;
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.entries.set(id, { expiresAt, recipients: recipients || new Set(), meta });
  }

  remove(id) {
    this.entries.delete(id);
  }

  shutdown() {
    clearInterval(this._timer);
  }

  _sweep() {
    const now = Date.now();
    for (const [id, e] of this.entries) {
      if (e.expiresAt <= now) {
        this.entries.delete(id);
        // Kirim sinyal destroy ke semua recipient
        for (const sock of e.recipients) {
          try {
            this.io.sendTo(sock, {
              type: 'destroy',
              id,
              scope: e.meta.scope,
              peer: e.meta.peer,
              room: e.meta.room,
            });
          } catch (_) { /* socket mungkin sudah closed */ }
        }
        // Panggil cleanup eksternal (mis. hapus file)
        try { this.onExpire(id, e.meta); } catch (_) {}
      }
    }
  }

  // Untuk testing: jalankan sweep secara sinkron
  forceSweep() { this._sweep(); }

  stats() { return { count: this.entries.size }; }
}

module.exports = { TtlManager };
