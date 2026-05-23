#!/usr/bin/env tsx
/**
 * W4 端到端验证：12 张套图任务跑完整链路
 *
 * 1. plan task → 立即完成（不调 OpenAI）
 * 2. generate task → claim from queue → loop 调 OpenAI → 写 asset → 结算积分
 * 3. 验证：
 *    - task.status ∈ {completed, partial_failed}
 *    - studio_asset 表插入 succeededCount 行
 *    - creditsReserved = imageCount * 20
 *    - creditsFinal = succeededCount * (creditsReserved/imageCount)
 *    - creditsRefunded = creditsReserved - creditsFinal
 *    - user.credits 减少 creditsFinal
 *    - studio_task_event 全程
 * 4. 如果 partial_failed，演示补图链路：
 *    - 用 errors[].prompt 创建一个新 generate task（prompts 子集）
 *    - 不真跑，只验证 createStudioTask + 扣费链路 OK
 *
 * Usage:
 *   pnpm exec tsx scripts/smoke-w4-creation.ts <email> [imageCount=12]
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

type ResultErrors = Array<{ index: number; prompt: string; error: string }>;

async function main() {
  const email = process.argv[2];
  const imageCountArg = Number.parseInt(process.argv[3] || "12", 10);
  const imageCount = Number.isFinite(imageCountArg) && imageCountArg > 0
    ? Math.min(12, Math.max(1, imageCountArg))
    : 12;

  if (!email) {
    console.error("Usage: tsx scripts/smoke-w4-creation.ts <email> [imageCount=12]");
    process.exit(1);
  }

  const { createStudioTask, getStudioTaskById, getStudioTaskEvents } = await import("../lib/studio/task-service");
  const { runQueuedStudioTasks } = await import("../lib/studio/task-runner");
  const { db } = await import("../lib/db");
  const { user, studioAsset } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const userRows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (userRows.length === 0) {
    console.error(`User ${email} not found`);
    process.exit(1);
  }
  const u = userRows[0];
  const startCredits = u.credits;
  console.log(`User: ${u.email} (id=${u.id.slice(0, 8)}… credits=${startCredits})`);
  console.log(`Target imageCount=${imageCount}\n`);

  // ─────────────────────────── Phase 1: creation_plan ───────────────────────────
  console.log("═══ Phase 1: creation_plan ═══");
  const planIdem = `w4-plan-${Date.now()}`;
  const planResult = await createStudioTask({
    userId: u.id,
    taskType: "creation_plan",
    requestPayload: {
      productName: "Smart Pet Feeder",
      productDescription: "Wi-Fi connected automatic feeder for cats and small dogs",
      sellingPoints: ["Auto-schedule meals", "Anti-clog dispenser", "Mobile app control", "Battery backup"],
      imageCount,
      scenario: "ecommerce",
      locale: "en",
    },
    idempotencyKey: planIdem,
  });
  console.log(`Plan task created: id=${planResult.task.id.slice(0, 8)}… reserved=${planResult.task.creditsReserved}`);

  console.log("Running queue for plan task…");
  const planRun = await runQueuedStudioTasks(1);
  console.log(`  → claimed=${planRun.claimed} completed=${planRun.completed} failed=${planRun.failed}`);

  const planFinal = await getStudioTaskById(planResult.task.id);
  if (!planFinal) throw new Error("Plan task vanished");
  console.log(`Plan final status=${planFinal.status} final=${planFinal.creditsFinal} refunded=${planFinal.creditsRefunded}`);
  if (planFinal.status !== "completed") {
    console.error(`✗ Plan task did not complete: ${planFinal.errorMessage}`);
    process.exit(2);
  }
  const planPrompts = (planFinal.result as Record<string, unknown> | null)?.prompts as string[] | undefined;
  console.log(`Plan generated ${planPrompts?.length ?? 0} prompts ✓\n`);

  // ─────────────────────────── Phase 2: creation_generate ───────────────────────────
  console.log(`═══ Phase 2: creation_generate (×${imageCount}, real OpenAI calls) ═══`);
  console.log("⏳ This will take ~30-60s per image. Total ~5-12 min for 12 images.");
  const genIdem = `w4-gen-${Date.now()}`;
  const genResult = await createStudioTask({
    userId: u.id,
    taskType: "creation_generate",
    requestPayload: {
      productName: "Smart Pet Feeder",
      productDescription: "Wi-Fi connected automatic feeder for cats and small dogs",
      sellingPoints: ["Auto-schedule meals", "Anti-clog dispenser", "Mobile app control", "Battery backup"],
      imageCount,
      prompts: planPrompts || [],
      size: "1024x1024",
      format: "png",
    },
    idempotencyKey: genIdem,
  });
  const expectedReserved = imageCount * 20;
  console.log(`Generate task: id=${genResult.task.id.slice(0, 8)}… reserved=${genResult.task.creditsReserved} (expect ${expectedReserved})`);
  if (genResult.task.creditsReserved !== expectedReserved) {
    console.warn(`  ⚠ unexpected reserved amount`);
  }

  const startedAt = Date.now();
  console.log("Running queue for generate task (this is the long one)…");
  const genRun = await runQueuedStudioTasks(1);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  → claimed=${genRun.claimed} completed=${genRun.completed} failed=${genRun.failed} (${elapsedSec}s)\n`);

  // ─────────────────────────── Phase 3: verify ───────────────────────────
  console.log("═══ Phase 3: verification ═══");
  const genFinal = await getStudioTaskById(genResult.task.id);
  if (!genFinal) throw new Error("Generate task vanished");

  const result = (genFinal.result as Record<string, unknown> | null) ?? {};
  const succeededCount = Number(result.succeededCount ?? 0);
  const failedCount = Number(result.failedCount ?? 0);
  const errors = (result.errors as ResultErrors | undefined) ?? [];

  console.log(`Status:            ${genFinal.status}`);
  console.log(`Succeeded:         ${succeededCount}/${imageCount}`);
  console.log(`Failed:            ${failedCount}`);
  console.log(`Reserved:          ${genFinal.creditsReserved}`);
  console.log(`Final:             ${genFinal.creditsFinal}`);
  console.log(`Refunded:          ${genFinal.creditsRefunded}`);
  const sumCheck = genFinal.creditsFinal + genFinal.creditsRefunded;
  console.log(`Final+Refunded:    ${sumCheck} (expect ${genFinal.creditsReserved} — ${sumCheck === genFinal.creditsReserved ? "✓" : "✗ DRIFT"})`);

  const userRowAfter = await db.select().from(user).where(eq(user.id, u.id)).limit(1);
  const endCredits = userRowAfter[0]?.credits ?? 0;
  const consumed = startCredits - endCredits;
  console.log(`User credits:      ${startCredits} → ${endCredits} (consumed ${consumed})`);
  console.log(`Expected consume:  ${genFinal.creditsFinal} (${consumed === genFinal.creditsFinal ? "✓" : "✗ DRIFT"})`);

  const assets = await db.select().from(studioAsset).where(eq(studioAsset.taskId, genFinal.id));
  console.log(`Assets in DB:      ${assets.length} (expect ${succeededCount} — ${assets.length === succeededCount ? "✓" : "✗"})`);

  const events = await getStudioTaskEvents(genFinal.id, 500);
  const eventTypes = new Set(events.map(e => e.eventType));
  console.log(`Event types:       ${[...eventTypes].sort().join(", ")}`);
  console.log(`Total events:      ${events.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    for (const e of errors.slice(0, 3)) {
      console.log(`  [${e.index}] ${e.error.slice(0, 120)}`);
    }
    if (errors.length > 3) console.log(`  …+${errors.length - 3} more`);
  }

  // ─────────────────────────── Phase 4: repair link (no real API) ───────────────────────────
  if (genFinal.status === "partial_failed" && errors.length > 0) {
    console.log(`\n═══ Phase 4: repair-task link verification (no OpenAI call) ═══`);
    const repairPrompts = errors.map(e => e.prompt);
    const repairIdem = `w4-repair-${Date.now()}`;
    const repairResult = await createStudioTask({
      userId: u.id,
      taskType: "creation_generate",
      requestPayload: {
        productName: "Smart Pet Feeder (repair)",
        productDescription: "Re-running failed items only",
        sellingPoints: ["repair"],
        imageCount: repairPrompts.length,
        prompts: repairPrompts,
        size: "1024x1024",
        format: "png",
      },
      idempotencyKey: repairIdem,
    });
    console.log(`Repair task: id=${repairResult.task.id.slice(0, 8)}… reserved=${repairResult.task.creditsReserved} for ${repairPrompts.length} items`);
    console.log(`⚠ Not running this repair task — credits will be refunded when we cancel.`);

    const { cancelStudioTaskForUser } = await import("../lib/studio/task-service");
    const canceled = await cancelStudioTaskForUser(repairResult.task.id, u.id);
    console.log(`Canceled repair task → status=${canceled?.status} refunded=${canceled?.creditsRefunded}`);
  } else {
    console.log(`\nPhase 4 skipped (no partial failure to repair)`);
  }

  // ─────────────────────────── Summary ───────────────────────────
  console.log(`\n═══ W4 verification summary ═══`);
  const allOk =
    (genFinal.status === "completed" || genFinal.status === "partial_failed") &&
    sumCheck === genFinal.creditsReserved &&
    consumed === genFinal.creditsFinal &&
    assets.length === succeededCount;
  console.log(allOk ? "✓ All accounting invariants hold" : "✗ Some accounting invariants violated — see above");
  console.log(`Output: smoke-w4 end (success-${succeededCount}/fail-${failedCount}, ${elapsedSec}s)`);

  process.exit(allOk ? 0 : 2);
}

void main().catch(err => {
  console.error("[smoke-w4] FATAL:", err);
  process.exit(1);
});
