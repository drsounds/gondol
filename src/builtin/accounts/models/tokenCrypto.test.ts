import { describe, expect, test } from "bun:test";
import { accountEncryptionKey, decryptAccountToken, encryptAccountToken } from "../../../../supabase/functions/_shared/accountTokenCrypto.ts";

describe("account token encryption", () => {
  const key = new Uint8Array(32).fill(42);

  test("round-trips tokens without storing the plaintext", async () => {
    const token = "github-oauth-session";
    const encrypted = await encryptAccountToken(token, key);
    expect(encrypted).not.toContain(token);
    expect(await decryptAccountToken(encrypted, key)).toBe(token);
  });

  test("uses a fresh IV and rejects a different key", async () => {
    const first = await encryptAccountToken("token", key);
    const second = await encryptAccountToken("token", key);
    expect(first).not.toBe(second);
    await expect(decryptAccountToken(first, new Uint8Array(32).fill(7))).rejects.toThrow();
  });

  test("requires a 32-byte encryption key", () => {
    expect(() => accountEncryptionKey(btoa("short"))).toThrow();
    expect(accountEncryptionKey(btoa(String.fromCharCode(...key)))).toHaveLength(32);
  });
});
