// HMAC signing helpers shared by Vercel gateway and Cloudflare Worker.
// Uses WebCrypto so it works in both edge and node runtimes.

const ALGO = { name: "HMAC", hash: "SHA-256" } as const;

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    ALGO,
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(hex: string): ArrayBuffer {
  const len = Math.floor(hex.length / 2);
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) {
    view[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return buf;
}

// Canonical message we sign: timestamp + "." + userId + "." + path
// Path = pathname only (no query, no host) to match what aEboli sees after rewrite.
function canonical(userId: string, path: string, timestampSec: number): string {
  return `${timestampSec}.${userId}.${path}`;
}

export async function signRequest(opts: {
  userId: string;
  path: string;
  secret: string;
  timestampSec?: number;
}): Promise<{ sigHex: string; timestampSec: number }> {
  const timestampSec = opts.timestampSec ?? Math.floor(Date.now() / 1000);
  const key = await importKey(opts.secret);
  const sigBuf = await crypto.subtle.sign(
    ALGO,
    key,
    new TextEncoder().encode(canonical(opts.userId, opts.path, timestampSec)),
  );
  return { sigHex: toHex(sigBuf), timestampSec };
}

export async function verifyRequest(opts: {
  userId: string;
  path: string;
  timestampSec: number;
  sigHex: string;
  secret: string;
  maxSkewSec?: number;
}): Promise<boolean> {
  const maxSkew = opts.maxSkewSec ?? 300; // 5 min
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - opts.timestampSec) > maxSkew) return false;
  const key = await importKey(opts.secret);
  return crypto.subtle.verify(
    ALGO,
    key,
    fromHex(opts.sigHex),
    new TextEncoder().encode(canonical(opts.userId, opts.path, opts.timestampSec)),
  );
}
