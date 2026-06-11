/**
 * src/server/rooms.js
 * ---------------------------------------------------------------------------
 * Manajemen room / channel untuk CollabBoard.
 *
 *  - Struktur data: Map<roomName, { name, members:Set<socket>, history:[] }>
 *  - Room default: 'general' (dibuat otomatis saat server start)
 *  - Satu socket bisa berada di banyak room sekaligus (join/leave fleksibel).
 *  - Riwayat pesan per-room disimpan in-memory (max 300 pesan, dapat
 *    dikonfigurasi via env MSG_HISTORY_LIMIT) untuk dikirimkan ke user
 *    yang baru join.
 * ---------------------------------------------------------------------------
 */

'use strict';

const { isValidRoom } = require('../shared/validation');

const DEFAULT_ROOM = 'general';
const HISTORY_LIMIT = parseInt(process.env.MSG_HISTORY_LIMIT || '300', 10);

class Rooms {
  constructor(io) {
    // io = { sendTo(socket, obj) }
    this.io = io;
    this.rooms = new Map();
    this._ensure(DEFAULT_ROOM);
  }

  _ensure(name) {
    if (!this.rooms.has(name)) {
      this.rooms.set(name, { name, members: new Set(), history: [] });
    }
    return this.rooms.get(name);
  }

  list() {
    return Array.from(this.rooms.values()).map(r => ({
      name: r.name,
      members: r.members.size,
    }));
  }

  join(socket, roomName) {
    if (!isValidRoom(roomName)) return { ok: false, reason: 'invalid-room' };
    const room = this._ensure(roomName);
    room.members.add(socket);
    if (!socket.rooms) socket.rooms = new Set();
    socket.rooms.add(roomName);
    return { ok: true, room: roomName, members: room.members.size };
  }

  leave(socket, roomName) {
    const room = this.rooms.get(roomName);
    if (!room) return { ok: false, reason: 'no-such-room' };
    room.members.delete(socket);
    if (socket.rooms) socket.rooms.delete(roomName);
    return { ok: true, members: room.members.size };
  }

  leaveAll(socket) {
    if (!socket.rooms) return;
    for (const r of socket.rooms) {
      const room = this.rooms.get(r);
      if (room) room.members.delete(socket);
    }
    socket.rooms.clear();
  }

  broadcastToRoom(roomName, obj, except) {
    const room = this.rooms.get(roomName);
    if (!room) return 0;
    let n = 0;
    for (const sock of room.members) {
      if (sock === except) continue;
      this.io.sendTo(sock, obj);
      n++;
    }
    return n;
  }

  pushHistory(roomName, entry) {
    const room = this.rooms.get(roomName);
    if (!room) return;
    room.history.push(entry);
    if (room.history.length > HISTORY_LIMIT) {
      room.history.splice(0, room.history.length - HISTORY_LIMIT);
    }
  }

  getHistory(roomName, n = 50) {
    const room = this.rooms.get(roomName);
    if (!room) return [];
    return room.history.slice(-n);
  }
}

module.exports = { Rooms, DEFAULT_ROOM };
