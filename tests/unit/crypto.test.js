/**
 * tests/unit/crypto.test.js
 * ---------------------------------------------------------------------------
 * Unit tests untuk crypto-utils.
 * Verifikasi:
 *  - Round-trip encrypt/decrypt
 *  - IV unik setiap kali
 *  - AuthTag validation: ciphertext yang dimodifikasi harus ditolak
 *  - Key derivation deterministik
 * ---------------------------------------------------------------------------
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { deriveKey, encrypt, decrypt } = require('../../src/server/crypto-utils');

test('deriveKey: deterministik untuk passphrase yang sama', () => {
  const k1 = deriveKey('test-pass');
  const k2 = deriveKey('test-pass');
  assert.equal(Buffer.compare(k1, k2), 0);
  assert.equal(k1.length, 32);
});

test('deriveKey: passphrase berbeda menghasilkan key berbeda', () => {
  const k1 = deriveKey('pass-1');
  const k2 = deriveKey('pass-2');
  assert.notEqual(Buffer.compare(k1, k2), 0);
});

test('encrypt/decrypt: round-trip', () => {
  const key = deriveKey('roundtrip');
  const text = 'Halo dunia, ini pesan rahasia 🔐';
  const enc = encrypt(text, key);
  assert.ok(enc.iv && enc.authTag && enc.ciphertext);
  const dec = decrypt(enc, key);
  assert.equal(dec, text);
});

test('encrypt: IV unik setiap kali', () => {
  const key = deriveKey('iv-test');
  const a = encrypt('sama', key);
  const b = encrypt('sama', key);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('decrypt: menolak ciphertext yang dimodifikasi (authTag gagal)', () => {
  const key = deriveKey('integrity');
  const enc = encrypt('rahasia', key);
  // flip satu byte di ciphertext
  const buf = Buffer.from(enc.ciphertext, 'base64');
  buf[0] ^= 0x01;
  enc.ciphertext = buf.toString('base64');
  assert.throws(() => decrypt(enc, key));
});

test('decrypt: menolak authTag yang dimodifikasi', () => {
  const key = deriveKey('integrity2');
  const enc = encrypt('rahasia2', key);
  const buf = Buffer.from(enc.authTag, 'base64');
  buf[0] ^= 0xff;
  enc.authTag = buf.toString('base64');
  assert.throws(() => decrypt(enc, key));
});

test('encrypt: mampu handle string panjang', () => {
  const key = deriveKey('long');
  const text = 'A'.repeat(10000);
  const enc = encrypt(text, key);
  const dec = decrypt(enc, key);
  assert.equal(dec.length, 10000);
});
