/**
 * src/server/crypto-utils.js
 * ---------------------------------------------------------------------------
 * Utilitas kriptografi sisi server.
 *
 *  - Server HANYA me-relay ciphertext, namun modul ini menyediakan helper
 *    encrypt/decrypt untuk kebutuhan testing dan debugging.
 *  - Pada produksi server TIDAK BOLEH melakukan decrypt pesan user.
 *  - Key diturunkan dari passphrase bersama menggunakan PBKDF2-SHA256
 *    (100.000 iterasi) sehingga tiap client memperoleh key yang sama.
 *  - Pada roadmap v2.0 mekanisme shared-passphrase ini akan diganti
 *    ECDH key exchange per-session.
 * ---------------------------------------------------------------------------
 */

'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PBKDF2_ITERS = 100_000;
const KEY_LEN = 32;
const SALT = Buffer.from('collabboard-salt-v1', 'utf8');

/** Turunkan 32-byte key dari passphrase (deterministic). */
function deriveKey(passphrase) {
  return crypto.pbkdf2Sync(String(passphrase), SALT, PBKDF2_ITERS, KEY_LEN, 'sha256');
}

/** Enkripsi plaintext -> { iv, authTag, ciphertext } semua base64. */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: tag.toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

/** Dekripsi {iv, authTag, ciphertext } -> plaintext. Untuk testing. */
function decrypt(payload, key) {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.authTag, 'base64');
  const ct = Buffer.from(payload.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { ALGO, deriveKey, encrypt, decrypt };
