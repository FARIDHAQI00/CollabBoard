/**
 * src/server/file-store.js
 * ---------------------------------------------------------------------------
 * Penyimpanan file untuk CollabBoard.
 *
 *  - File upload disimpan di folder `uploads/` dengan nama ber-prefix
 *    `ts_random_` (path.basename + prefix check) untuk mencegah serangan
 *    path traversal.
 *  - Server TIDAK mengenkripsi/mendekripsi file. Server hanya menerima
 *    ciphertext dari client (AES-256-GCM), me-relay apa adanya, dan
 *    menyediakannya untuk di-download client lain apa adanya.
 *  - Cleanup file (termasuk saat TTL pesan expire) dilakukan oleh
 *    ttl-manager yang memanggil method remove() di modul ini.
 * ---------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
let MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '8388608', 10);

// Pastikan direktori ada
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function safeName(originalName) {
  const base = path.basename(String(originalName || 'file'))
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 120);
  return base || 'file';
}

function genStoredName(originalName) {
  const safe = safeName(originalName);
  const rand = crypto.randomBytes(6).toString('hex');
  const ts = Date.now();
  return `${ts}_${rand}_${safe}`;
}

function filePath(storedName) {
  // Path traversal protection: storedName HARUS dimulai dengan prefix ts_
  if (!/^\d+_[a-f0-9]+_/.test(storedName)) return null;
  const full = path.join(UPLOAD_DIR, storedName);
  const norm = path.normalize(full);
  if (!norm.startsWith(path.normalize(UPLOAD_DIR))) return null;
  return norm;
}

async function saveUploadFromBase64(b64, originalName) {
  if (typeof b64 !== 'string') throw new Error('invalid-content');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_FILE_SIZE) {
    const err = new Error('file-too-large');
    err.code = 'E_FILE_TOO_LARGE';
    err.max = MAX_FILE_SIZE;
    throw err;
  }
  const stored = genStoredName(originalName);
  const fp = path.join(UPLOAD_DIR, stored);
  await fs.promises.writeFile(fp, buf);
  return { storedName: stored, size: buf.length, path: fp };
}

async function saveUploadFromBuffer(buf, originalName) {
  if (!Buffer.isBuffer(buf)) throw new Error('invalid-content');
  if (buf.length > MAX_FILE_SIZE) {
    const err = new Error('file-too-large');
    err.code = 'E_FILE_TOO_LARGE';
    err.max = MAX_FILE_SIZE;
    throw err;
  }
  const stored = genStoredName(originalName);
  const fp = path.join(UPLOAD_DIR, stored);
  await fs.promises.writeFile(fp, buf);
  return { storedName: stored, size: buf.length, path: fp };
}

async function removeFile(storedName) {
  const fp = filePath(storedName);
  if (!fp) return false;
  try { await fs.promises.unlink(fp); return true; } catch { return false; }
}

function getUploadDir() { return UPLOAD_DIR; }
function getMaxSize() { return MAX_FILE_SIZE; }
function setMaxSize(n) { MAX_FILE_SIZE = n; }

module.exports = {
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  safeName,
  filePath,
  saveUploadFromBase64,
  saveUploadFromBuffer,
  removeFile,
  getUploadDir,
  getMaxSize,
  setMaxSize,
};
