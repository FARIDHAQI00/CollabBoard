/**
 * public/crypto.js
 * ---------------------------------------------------------------------------
 * Browser-side encryption helper (AES-256-GCM, PBKDF2-derived key).
 * Exposes window.SCCrypto.encrypt / decrypt + encFile / decFile.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  const PASSPHRASE = (window.SECURECHAT_PASSPHRASE
    || 'chat-encrypted-key-2026-komunikasi-data');
  const PBKDF2_ITERS = 100000;
  const SALT_STR = 'securechat-salt-v1';

  function b64encode(bytes) {
    let s = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }
  function b64decode(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // ---- PBKDF2 -> AES-GCM key (cached) ----
  let _keyP = null;
  function getKey() {
    if (_keyP) return _keyP;
    const enc = new TextEncoder();
    _keyP = crypto.subtle.importKey(
      'raw', enc.encode(PASSPHRASE), { name: 'PBKDF2' }, false, ['deriveKey']
    ).then(material =>
      crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(SALT_STR), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    );
    return _keyP;
  }

  async function encryptText(plain) {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(String(plain))
    );
    // ct = ciphertext || authTag (16 bytes)
    const ctArr = new Uint8Array(ct);
    const ciphertext = ctArr.slice(0, ctArr.length - 16);
    const authTag = ctArr.slice(ctArr.length - 16);
    return {
      iv: b64encode(iv),
      authTag: b64encode(authTag),
      ciphertext: b64encode(ciphertext),
    };
  }

  async function decryptText(payload) {
    const key = await getKey();
    const iv = b64decode(payload.iv);
    const tag = b64decode(payload.authTag);
    const ct = b64decode(payload.ciphertext);
    const merged = new Uint8Array(ct.length + tag.length);
    merged.set(ct, 0); merged.set(tag, ct.length);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, merged);
    return new TextDecoder().decode(pt);
  }

  /** Enkripsi isi file (ArrayBuffer) -> { iv, authTag, ciphertext } (base64). */
  async function encryptBuffer(buf) {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
    const ctArr = new Uint8Array(ct);
    const ciphertext = ctArr.slice(0, ctArr.length - 16);
    const authTag = ctArr.slice(ctArr.length - 16);
    return {
      iv: b64encode(iv),
      authTag: b64encode(authTag),
      ciphertext: b64encode(ciphertext),
    };
  }

  async function decryptBuffer(payload) {
    const key = await getKey();
    const iv = b64decode(payload.iv);
    const tag = b64decode(payload.authTag);
    const ct = b64decode(payload.ciphertext);
    const merged = new Uint8Array(ct.length + tag.length);
    merged.set(ct, 0); merged.set(tag, ct.length);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, merged);
  }

  window.SCCrypto = { encryptText, decryptText, encryptBuffer, decryptBuffer, b64encode, b64decode };
})();
