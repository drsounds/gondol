function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function keyFor(material: Uint8Array): Promise<CryptoKey> {
  if (material.length !== 32) throw new Error("The account token encryption key must be 32 bytes");
  return await crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts an OAuth token for storage. The returned base64 contains a fresh IV and authenticated ciphertext. */
export async function encryptAccountToken(token: string, material: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(material), new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return base64(combined);
}

/** Decrypts a token previously returned by `encryptAccountToken`. */
export async function decryptAccountToken(value: string, material: Uint8Array): Promise<string> {
  const combined = bytes(value);
  if (combined.length < 29) throw new Error("The stored account token is invalid");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, await keyFor(material), combined.slice(12));
  return new TextDecoder().decode(plaintext);
}

export function accountEncryptionKey(encoded: string): Uint8Array {
  const key = bytes(encoded);
  if (key.length !== 32) throw new Error("ACCOUNT_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return key;
}
