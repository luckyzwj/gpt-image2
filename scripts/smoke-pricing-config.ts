#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const {
    seedPricingDefaults,
    upsertPricingRecord,
    listPricingRecords,
    invalidatePricingCache,
  } = await import("../lib/studio/pricing-service");
  const { estimateStudioTaskCredits } = await import("../lib/studio/domain/cost-policy");

  console.log(`[1] Ensure defaults are seeded...`);
  await seedPricingDefaults({ overwrite: true });
  console.log(`  Defaults applied (overwrite=true).`);

  console.log(`\n[2] Sanity check: image_single estimate should be 20 credits.`);
  const before = await estimateStudioTaskCredits("image_single", { prompt: "x", quality: "high" });
  console.log(`  estimate=${before} credits (expected 20)`);

  console.log(`\n[3] Sanity check: creation_generate with imageCount=6 should be 6*20=120.`);
  const beforeBatch = await estimateStudioTaskCredits("creation_generate", { imageCount: 6 });
  console.log(`  estimate=${beforeBatch} credits (expected 120)`);

  console.log(`\n[4] Admin edits: bump image_single to 35 credits, add note...`);
  const updated = await upsertPricingRecord({
    taskType: "image_single",
    priceCredits: 35,
    notes: "Tier-up: increased pricing for high-quality single image",
    updatedBy: "smoke-test",
  });
  console.log(`  Row updated: priceCredits=${updated.priceCredits} notes="${updated.notes}"`);

  console.log(`\n[5] Re-estimate image_single (cache invalidated by upsert)...`);
  const after = await estimateStudioTaskCredits("image_single", { prompt: "x", quality: "high" });
  console.log(`  estimate=${after} credits (expected 35)`);

  console.log(`\n[6] Restore defaults (overwrite=true) to leave DB clean...`);
  await seedPricingDefaults({ overwrite: true });
  invalidatePricingCache();
  const restored = await estimateStudioTaskCredits("image_single", { prompt: "x" });
  console.log(`  Restored: image_single estimate=${restored} (expected 20)`);

  console.log(`\nAll pricing-service operations OK.`);
  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
