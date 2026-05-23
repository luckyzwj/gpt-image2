#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { db } = await import("../lib/db");
  const { user } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const {
    seedTierDefaults,
    listTierConfigs,
    getEffectiveQuota,
    getQuotaUsage,
    upsertUserQuotaOverride,
    deleteUserQuotaOverride,
    assertQuotaAllowsTask,
    invalidateQuotaCache,
  } = await import("../lib/studio/quota-service");

  const testEmail = process.env.STUDIO_SMOKE_EMAIL || "luckyzwj@gmail.com";

  console.log(`[1] Seeding tier defaults (overwrite=true)...`);
  const seed = await seedTierDefaults({ overwrite: true });
  console.log(`  inserted=${seed.inserted} updated=${seed.updated} skipped=${seed.skipped}`);

  console.log(`\n[2] Listing tiers from DB...`);
  const tiers = await listTierConfigs();
  for (const tier of tiers) {
    console.log(
      `  - ${tier.tierKey} (${tier.displayName}): tasks/day=${tier.dailyTaskLimit}, credits/day=${tier.dailyCreditLimit}, concurrent=${tier.concurrentTaskLimit}, templates=${tier.maxPromptTemplates}, enabled=${tier.enabled}`,
    );
  }

  console.log(`\n[3] Locating user ${testEmail}...`);
  const userRows = await db.select().from(user).where(eq(user.email, testEmail)).limit(1);
  if (userRows.length === 0) {
    console.error(`  User ${testEmail} not found — skipping per-user checks.`);
    process.exit(1);
  }
  const targetUser = userRows[0];
  console.log(`  Found userId=${targetUser.id} planKey=${targetUser.planKey ?? "(null)"} role=${targetUser.role}`);

  console.log(`\n[4] Effective quota without override...`);
  const effective1 = await getEffectiveQuota(targetUser.id);
  console.log(
    `  tier=${effective1.tierKey} tasks/day=${effective1.dailyTaskLimit} credits/day=${effective1.dailyCreditLimit} concurrent=${effective1.concurrentTaskLimit} templates=${effective1.maxPromptTemplates}`,
  );

  console.log(`\n[5] Current usage...`);
  const usage = await getQuotaUsage(targetUser.id);
  console.log(
    `  tasksToday=${usage.tasksToday} creditsReservedToday=${usage.creditsReservedToday} concurrentTasks=${usage.concurrentTasks}`,
  );

  console.log(`\n[6] Quota check with small estimate (5 credits)...`);
  const allowed = await assertQuotaAllowsTask({ userId: targetUser.id, estimatedCredits: 5 });
  console.log(`  ok=${allowed.ok}${allowed.ok ? "" : ` reason="${allowed.reason}"`}`);

  console.log(`\n[7] Apply restrictive override: dailyCreditLimit=1...`);
  await upsertUserQuotaOverride({
    userId: targetUser.id,
    dailyCreditLimit: 1,
    reason: "smoke-test temporary cap",
    grantedBy: "smoke-quota-service",
  });
  invalidateQuotaCache();
  const effective2 = await getEffectiveQuota(targetUser.id);
  console.log(`  After override: credits/day=${effective2.dailyCreditLimit} (expected 1)`);

  console.log(`\n[8] Quota check with 50 credits should now block...`);
  const blocked = await assertQuotaAllowsTask({ userId: targetUser.id, estimatedCredits: 50 });
  console.log(`  ok=${blocked.ok}${blocked.ok ? "" : ` reason="${blocked.reason}"`}`);
  if (blocked.ok) {
    console.error("  Expected block, but got ok=true!");
    process.exit(1);
  }

  console.log(`\n[9] Cleanup: delete override...`);
  const removed = await deleteUserQuotaOverride(targetUser.id);
  invalidateQuotaCache();
  console.log(`  deleted=${removed}`);

  const effective3 = await getEffectiveQuota(targetUser.id);
  console.log(
    `  Final effective: tier=${effective3.tierKey} credits/day=${effective3.dailyCreditLimit} (back to tier default)`,
  );

  console.log(`\nAll quota-service operations OK.`);
  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
