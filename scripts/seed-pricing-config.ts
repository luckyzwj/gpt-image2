#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const overwrite = process.argv.includes("--overwrite");
  const { seedPricingDefaults, listPricingRecords } = await import("../lib/studio/pricing-service");

  console.log(`Seeding studio_pricing_config defaults (overwrite=${overwrite})...`);
  const result = await seedPricingDefaults({ overwrite });
  console.log(`  inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`);

  const records = await listPricingRecords();
  console.log(`\nCurrent pricing config (${records.length} rows):`);
  console.log("  task_type            quality   price  min  max  default  enabled  notes");
  for (const r of records) {
    console.log(
      `  ${r.taskType.padEnd(20)} ${r.quality.padEnd(8)} ${String(r.priceCredits).padStart(5)}  ${String(r.minBatchSize).padStart(3)}  ${String(r.maxBatchSize).padStart(3)}  ${String(r.defaultBatchSize).padStart(7)}  ${String(r.enabled).padEnd(7)}  ${r.notes || ""}`,
    );
  }

  process.exit(0);
}

void main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
