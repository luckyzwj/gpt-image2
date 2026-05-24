// AES-256-GCM 对称加密,用于把 admin 配的平台 OPENAI_API_KEY 加密后入库。
//
// 密钥派生:HKDF-SHA256(BETTER_AUTH_SECRET, salt="studio-system-config-v1") 取前 32 字节。
// 之所以从 BETTER_AUTH_SECRET 派生而不是独立 env:
//   - BETTER_AUTH_SECRET 已经强制 ≥32 字符,preflight 也在校验
//   - 单一 secret 轮换路径明确(轮 BETTER_AUTH_SECRET = 失效所有现有密文,admin 重填 key)
//   - 不引入新 env,减少 owner 部署时的环境变量负担
//
// 密文存储格式:base64( iv(12B) || tag(16B) || ciphertext )

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const HKDF_SALT = "studio-system-config-v1";
const HKDF_INFO = "aes-256-gcm-key";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Studio crypto requires BETTER_AUTH_SECRET to be set and at least 32 characters",
    );
  }
  const derived = hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32);
  return Buffer.from(derived);
}

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) {
    throw new Error("encryptApiKey: plaintext is empty");
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptApiKey(ciphertextB64: string): string {
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("decryptApiKey: ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const key = getMasterKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export function buildApiKeyHint(plaintext: string): string {
  if (!plaintext) return "";
  const tail = plaintext.slice(-4);
  return `…${tail} (len=${plaintext.length})`;
}
