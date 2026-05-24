#!/usr/bin/env node
// Маленький Node-мост для cross-language crypto-теста. ДУБЛИРУЕТ протокол
// AES-256-GCM, не импортирует apps/web/lib/crypto/token.ts. Если два
// независимых имплементера (TS-prod + этот мост + Python) сходятся
// по байту — формат верный.
//
// Использование:
//   node crypto_bridge.mjs encrypt <KEY_BASE64> <plaintext>
//   node crypto_bridge.mjs decrypt <KEY_BASE64> <json-record>

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ALGO = "aes-256-gcm";

function loadKey(b64) {
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`key must be ${KEY_LENGTH} bytes (got ${key.length})`);
  }
  return key;
}

function encrypt(keyB64, plaintext) {
  const key = loadKey(keyB64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt(keyB64, record) {
  const key = loadKey(keyB64);
  const iv = Buffer.from(record.iv, "base64");
  const tag = Buffer.from(record.tag, "base64");
  const ct = Buffer.from(record.ciphertext, "base64");
  if (iv.length !== IV_LENGTH) throw new Error("bad iv");
  if (tag.length !== TAG_LENGTH) throw new Error("bad tag");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

const [, , mode, keyB64, payload] = process.argv;

try {
  if (mode === "encrypt") {
    const out = encrypt(keyB64, payload);
    process.stdout.write(JSON.stringify(out));
  } else if (mode === "decrypt") {
    const record = JSON.parse(payload);
    const out = decrypt(keyB64, record);
    process.stdout.write(out);
  } else {
    throw new Error(`unknown mode: ${mode}. Use 'encrypt' or 'decrypt'.`);
  }
} catch (err) {
  process.stderr.write(`[crypto_bridge] ${err.message}\n`);
  process.exit(1);
}
