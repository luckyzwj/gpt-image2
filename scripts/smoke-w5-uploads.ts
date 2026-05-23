#!/usr/bin/env tsx
/**
 * W5 smoke test:
 *   1. POST /api/uploads/reference with 3 small in-memory PNGs (multipart/form-data)
 *   2. Verify response carries 3 assetIds + per-asset storageKey + width/height + sizeBytes
 *   3. GET /api/studio/assets?type=reference → confirm all 3 show up at top of the user's gallery
 *   4. GET /api/storage/<storageKey> → confirm bytes round-trip
 *   5. Prompt-template CRUD roundtrip: POST → GET list → PATCH (recordUsage) → DELETE
 *
 * Usage:
 *   pnpm exec tsx scripts/smoke-w5-uploads.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

type SeedCookie = { name: string; value: string; userId: string };

function seedSession(): SeedCookie {
  const res = spawnSync("pnpm", ["exec", "tsx", "scripts/e2e-seed-session.ts"], {
    encoding: "utf-8",
    shell: true,
  });
  if (res.status !== 0) throw new Error(`seeder failed: ${res.stderr}`);
  const line = res.stdout.split("\n").map(l => l.trim()).find(l => l.startsWith("{"));
  if (!line) throw new Error(`no JSON from seeder: ${res.stdout}`);
  return JSON.parse(line) as SeedCookie;
}

const crcTable: number[] = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function makePNG(size: number, r: number, g: number, b: number, a: number): Buffer {
  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(size * rowBytes);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0;
    for (let x = 0; x < size; x++) {
      const off = y * rowBytes + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const idatData = deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

type UploadedAsset = {
  assetId: string;
  publicUrl: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  filename: string;
};
type UploadResponse = {
  assetIds: string[];
  assets: UploadedAsset[];
  errors: Array<{ filename: string; error: string }>;
  succeededCount: number;
  failedCount: number;
};

async function main() {
  const cookie = seedSession();
  console.log(`[w5] session userId=${cookie.userId.slice(0, 8)}…`);

  // ── Phase 1: multi-file POST /api/uploads/reference ─────────────────────────
  console.log("\n═══ Phase 1: POST /api/uploads/reference (3 PNGs) ═══");
  const samples = [
    { name: "ref-red.png", buf: makePNG(16, 255, 32, 32, 255) },
    { name: "ref-green.png", buf: makePNG(20, 32, 255, 32, 255) },
    { name: "ref-blue.png", buf: makePNG(24, 32, 32, 255, 255) },
  ];
  const fd = new FormData();
  for (const { name, buf } of samples) {
    fd.append("files", new File([new Uint8Array(buf)], name, { type: "image/png" }));
  }
  const postRes = await fetch(`${BASE_URL}/api/uploads/reference`, {
    method: "POST",
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
    body: fd,
  });
  console.log(`HTTP ${postRes.status} ${postRes.headers.get("content-type")}`);
  if (!postRes.ok) {
    console.error(`✗ POST failed: ${await postRes.text()}`);
    process.exit(2);
  }
  const uploaded = (await postRes.json()) as UploadResponse;
  console.log(`Uploaded: ${uploaded.succeededCount}/${samples.length} ok, ${uploaded.failedCount} failed`);
  for (const a of uploaded.assets) {
    console.log(`  ${a.filename}  ${a.width}x${a.height}  ${a.sizeBytes}B  → ${a.storageKey}`);
  }
  if (uploaded.errors.length > 0) {
    for (const e of uploaded.errors) console.log(`  ✗ ${e.filename}: ${e.error}`);
  }
  const okUpload =
    uploaded.succeededCount === samples.length &&
    uploaded.assetIds.length === samples.length &&
    uploaded.assets.every(a => a.width === 16 || a.width === 20 || a.width === 24);
  console.log(okUpload ? "  ✓ upload invariants hold" : "  ✗ upload invariants FAILED");

  // ── Phase 2: GET /api/studio/assets?type=reference ──────────────────────────
  console.log("\n═══ Phase 2: GET /api/studio/assets?type=reference ═══");
  const listRes = await fetch(`${BASE_URL}/api/studio/assets?type=reference&limit=20`, {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  if (!listRes.ok) {
    console.error(`✗ GET failed: ${listRes.status} ${await listRes.text()}`);
    process.exit(3);
  }
  const { assets: gallery } = (await listRes.json()) as { assets: Array<{ id: string; assetType: string; taskId: string | null }> };
  console.log(`Gallery returned ${gallery.length} reference assets`);
  const uploadedSet = new Set(uploaded.assetIds);
  const foundInGallery = gallery.filter(a => uploadedSet.has(a.id));
  console.log(`  ${foundInGallery.length}/${samples.length} just-uploaded assets visible`);
  const allRefs = gallery.every(a => a.assetType === "reference");
  const allTaskNull = foundInGallery.every(a => a.taskId === null);
  console.log(`  all assetType=reference?  ${allRefs ? "✓" : "✗"}`);
  console.log(`  all taskId=null?          ${allTaskNull ? "✓" : "✗"}`);
  const okGallery = foundInGallery.length === samples.length && allRefs && allTaskNull;

  // ── Phase 3: GET /api/storage/<key> → byte roundtrip ───────────────────────
  console.log("\n═══ Phase 3: GET /api/storage/<key> byte roundtrip ═══");
  const first = uploaded.assets[0];
  const storageRes = await fetch(`${BASE_URL}${first.publicUrl}`, {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  console.log(`HTTP ${storageRes.status} ${storageRes.headers.get("content-type")} len=${storageRes.headers.get("content-length")}`);
  let okBytes = false;
  if (storageRes.ok) {
    const body = Buffer.from(await storageRes.arrayBuffer());
    const matches = body.equals(samples[0].buf);
    console.log(`  got ${body.length}B, original ${samples[0].buf.length}B, equal? ${matches ? "✓" : "✗"}`);
    okBytes = matches;
  } else {
    console.error(`  ✗ ${await storageRes.text()}`);
  }

  // ── Phase 4: prompt-template CRUD roundtrip ────────────────────────────────
  console.log("\n═══ Phase 4: /api/studio/prompt-templates CRUD ═══");
  const ptCreate = await fetch(`${BASE_URL}/api/studio/prompt-templates`, {
    method: "POST",
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "w5-smoke template",
      prompt: "A photo of {productName} on a soft beige backdrop, soft shadows.",
      category: "creation",
      tags: ["smoke", "w5"],
    }),
  });
  if (!ptCreate.ok) {
    console.error(`✗ POST template failed: ${ptCreate.status} ${await ptCreate.text()}`);
    process.exit(5);
  }
  const created = (await ptCreate.json()) as { template: { id: string; name: string; usageCount: number } };
  console.log(`  POST → id=${created.template.id.slice(0, 8)}… name=${created.template.name} usage=${created.template.usageCount}`);

  const ptList = await fetch(`${BASE_URL}/api/studio/prompt-templates?category=creation`, {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  const listJson = (await ptList.json()) as { templates: Array<{ id: string }> };
  const inList = listJson.templates.some(t => t.id === created.template.id);
  console.log(`  GET list (category=creation) → ${listJson.templates.length} items, includes new? ${inList ? "✓" : "✗"}`);

  const ptPatch = await fetch(`${BASE_URL}/api/studio/prompt-templates/${created.template.id}`, {
    method: "PATCH",
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recordUsage: true }),
  });
  const patched = (await ptPatch.json()) as { template: { usageCount: number; lastUsedAt: string | null } };
  const usageBumped = patched.template.usageCount === 1 && !!patched.template.lastUsedAt;
  console.log(`  PATCH recordUsage → usage=${patched.template.usageCount} lastUsed=${patched.template.lastUsedAt ? "set" : "null"} ${usageBumped ? "✓" : "✗"}`);

  const ptDelete = await fetch(`${BASE_URL}/api/studio/prompt-templates/${created.template.id}`, {
    method: "DELETE",
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  console.log(`  DELETE → HTTP ${ptDelete.status} ${ptDelete.ok ? "✓" : "✗"}`);

  const ptVerify = await fetch(`${BASE_URL}/api/studio/prompt-templates/${created.template.id}`, {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  const gone = ptVerify.status === 404;
  console.log(`  GET after delete → HTTP ${ptVerify.status} ${gone ? "✓" : "✗"}`);

  const okTemplate = inList && usageBumped && ptDelete.ok && gone;

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n═══ W5 verification summary ═══");
  const allOk = okUpload && okGallery && okBytes && okTemplate;
  console.log(`upload    ${okUpload ? "✓" : "✗"}`);
  console.log(`gallery   ${okGallery ? "✓" : "✗"}`);
  console.log(`bytes     ${okBytes ? "✓" : "✗"}`);
  console.log(`templates ${okTemplate ? "✓" : "✗"}`);
  console.log(allOk ? "✓ W5 smoke OK" : "✗ W5 smoke FAILED");
  process.exit(allOk ? 0 : 2);
}

void main().catch(err => {
  console.error("[w5-smoke] FATAL:", err);
  process.exit(1);
});
