import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM: 12-байтовый IV — рекомендация NIST SP 800-38D, тег 16 байт.
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGO = "aes-256-gcm";

export interface EncryptedToken {
  ciphertext: string; // base64
  iv: string;         // base64 (12 байт)
  tag: string;        // base64 (16 байт)
}

let cachedKey: Buffer | null = null;

/** Достаёт ключ из env. Кэширует, чтобы не парсить base64 на каждом запросе. */
export function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
        "Expected 256-bit key in base64.",
    );
  }

  cachedKey = key;
  return key;
}

/** Сбросить кэш ключа — нужно для тестов, которые меняют env между кейсами. */
export function _resetKeyCache(): void {
  cachedKey = null;
}

export function encryptToken(plaintext: string): EncryptedToken {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string");
  }

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptToken(record: EncryptedToken): string {
  const key = getKey();
  const iv = Buffer.from(record.iv, "base64");
  const tag = Buffer.from(record.tag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`decryptToken: invalid iv length (${iv.length})`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`decryptToken: invalid tag length (${tag.length})`);
  }

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  // .final() бросит, если тег не сходится — это и есть GCM-гарантия аутентичности.
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
