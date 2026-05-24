import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { _resetKeyCache, decryptToken, encryptToken, getKey } from "./token";

function setTestKey(): string {
  const key = randomBytes(32).toString("base64");
  process.env.TOKEN_ENCRYPTION_KEY = key;
  _resetKeyCache();
  return key;
}

describe("token crypto", () => {
  beforeEach(() => {
    setTestKey();
  });

  it("round-trips a typical WB JWT", () => {
    const plaintext =
      "eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYwMzAydjEiLCJ0eXAiOiJKV1QifQ.payload.sig";

    const enc = encryptToken(plaintext);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv.length).toBeGreaterThan(0);
    expect(enc.tag.length).toBeGreaterThan(0);

    const dec = decryptToken(enc);
    expect(dec).toBe(plaintext);
  });

  it("round-trips unicode and long inputs", () => {
    const plaintext = "Привет мир " + "x".repeat(4096);
    const dec = decryptToken(encryptToken(plaintext));
    expect(dec).toBe(plaintext);
  });

  it("generates a different IV (and ciphertext) for every call", () => {
    const plaintext = "same-plaintext";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("throws when the auth tag is wrong", () => {
    const enc = encryptToken("secret");
    const tampered = {
      ...enc,
      tag: Buffer.alloc(16, 0).toString("base64"),
    };
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws when ciphertext is tampered with", () => {
    const enc = encryptToken("secret");
    const buf = Buffer.from(enc.ciphertext, "base64");
    buf[0] ^= 0xff;
    const tampered = { ...enc, ciphertext: buf.toString("base64") };
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws when env key is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    _resetKeyCache();
    expect(() => getKey()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("throws when env key is wrong length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    _resetKeyCache();
    expect(() => getKey()).toThrow(/32 bytes/);
  });
});
