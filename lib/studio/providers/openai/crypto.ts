import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  if (/^[A-Za-z0-9+/=]+$/.test(secret)) {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length === 32) return decoded;
  }
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return createHash("sha256").update(secret).digest();
}

function getKey(): Buffer {
  const secret =
    process.env.BYO_KEY_MASTER_KEY ||
    process.env.STUDIO_BYO_KEY_SECRET ||
    process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BYO_KEY_MASTER_KEY (or STUDIO_BYO_KEY_SECRET / BETTER_AUTH_SECRET fallback) must be set to encrypt user API keys",
    );
  }
  return deriveKey(secret);
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptApiKey(plaintext: string): EncryptedPayload {
  if (!plaintext) throw new Error("plaintext is required");
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptApiKey(payload: EncryptedPayload): string {
  const key = getKey();
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function keyHint(plaintext: string): string {
  if (plaintext.length <= 4) return "****";
  return plaintext.slice(-4);
}
