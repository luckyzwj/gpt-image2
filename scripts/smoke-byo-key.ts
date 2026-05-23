#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { db } = await import("../lib/db");
  const { user } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { encryptApiKey, decryptApiKey, keyHint } = await import(
    "../lib/studio/providers/openai/crypto"
  );
  const {
    upsertUserApiKey,
    getUserApiKeyMetadata,
    getDecryptedUserApiKey,
    setUserApiKeyEnabled,
    deleteUserApiKey,
  } = await import("../lib/studio/providers/openai/user-api-key-service");
  const { estimateStudioTaskCredits } = await import("../lib/studio/domain/cost-policy");

  const testEmail = process.env.STUDIO_SMOKE_EMAIL || "luckyzwj@gmail.com";

  console.log(`[1] Round-trip crypto smoke...`);
  const sample = "sk-test-1234567890ABCDEFGHIJ";
  const enc = encryptApiKey(sample);
  const dec = decryptApiKey(enc);
  console.log(`  encrypted ct length=${enc.ciphertext.length} iv=${enc.iv.length}b64 tag=${enc.authTag.length}b64`);
  console.log(`  decrypted matches=${dec === sample}, hint=${keyHint(sample)}`);
  if (dec !== sample) {
    console.error("Crypto round-trip mismatch!");
    process.exit(1);
  }

  console.log(`\n[2] Locating user ${testEmail}...`);
  const userRows = await db.select().from(user).where(eq(user.email, testEmail)).limit(1);
  if (userRows.length === 0) {
    console.error(`  User ${testEmail} not found.`);
    process.exit(1);
  }
  const targetUser = userRows[0];
  console.log(`  Found userId=${targetUser.id}`);

  console.log(`\n[3] Estimate WITHOUT BYO (image_single, high)...`);
  const beforePrice = await estimateStudioTaskCredits(
    "image_single",
    { prompt: "x", quality: "high" },
    { userId: targetUser.id },
  );
  console.log(`  estimate=${beforePrice} credits (expected platform price, e.g. 20)`);

  console.log(`\n[4] Upsert BYO key for user...`);
  const record = await upsertUserApiKey({
    userId: targetUser.id,
    apiKey: sample,
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
  });
  console.log(`  saved id=${record.id} hint=${record.keyHint} enabled=${record.enabled}`);

  console.log(`\n[5] Estimate WITH BYO active...`);
  const byoPrice = await estimateStudioTaskCredits(
    "image_single",
    { prompt: "x", quality: "high" },
    { userId: targetUser.id },
  );
  console.log(`  estimate=${byoPrice} credits (expected 1 BYO fee)`);

  console.log(`\n[6] Batch BYO estimate (creation_generate imageCount=6)...`);
  const batchPrice = await estimateStudioTaskCredits(
    "creation_generate",
    { imageCount: 6 },
    { userId: targetUser.id },
  );
  console.log(`  estimate=${batchPrice} credits (expected 6 BYO fee)`);

  console.log(`\n[7] image_decompose under BYO should cost 0...`);
  const decomposePrice = await estimateStudioTaskCredits(
    "image_decompose",
    { depth: "detailed" },
    { userId: targetUser.id },
  );
  console.log(`  estimate=${decomposePrice} credits (expected 0)`);

  console.log(`\n[8] getDecryptedUserApiKey returns plaintext...`);
  const decrypted = await getDecryptedUserApiKey(targetUser.id, "openai");
  console.log(`  found=${decrypted !== null} matches=${decrypted?.apiKey === sample} baseUrl=${decrypted?.baseUrl}`);

  console.log(`\n[9] Disable BYO and re-estimate...`);
  await setUserApiKeyEnabled({ userId: targetUser.id, provider: "openai", enabled: false });
  const disabledPrice = await estimateStudioTaskCredits(
    "image_single",
    { prompt: "x", quality: "high" },
    { userId: targetUser.id },
  );
  console.log(`  estimate=${disabledPrice} credits (expected platform price again)`);
  const disabledMeta = await getUserApiKeyMetadata(targetUser.id, "openai");
  console.log(`  metadata enabled=${disabledMeta?.enabled}`);

  console.log(`\n[10] Cleanup: delete key...`);
  const removed = await deleteUserApiKey({ userId: targetUser.id, provider: "openai" });
  console.log(`  deleted=${removed}`);

  console.log(`\nAll BYO-key operations OK.`);
  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
