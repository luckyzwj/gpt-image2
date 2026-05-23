#!/usr/bin/env tsx
/**
 * W6 smoke: stale-task reaper.
 *
 * 1. Pick (or create + queue) a small task for luckyzwj@gmail.com
 * 2. Forcibly transition it to status=running and rewind updated_at by 20 min so it looks stale
 * 3. Snapshot user credits + task state
 * 4. Invoke reapStaleStudioTasks (in-process, bypassing cron auth)
 * 5. Assert:
 *    - returned reaped list includes the task
 *    - studio_task row now status=failed, errorCode=task_stale_reaped
 *    - creditsRefunded grew by the previously-reservable amount
 *    - user.credits restored to pre-task value
 *    - studio_task_event has a task_reaped row
 *
 * Usage: pnpm exec tsx scripts/smoke-w6-reap.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const email = process.env.STUDIO_SMOKE_EMAIL || "luckyzwj@gmail.com";

  const { db } = await import("../lib/db");
  const { user, studioTask, studioTaskEvent } = await import("../lib/db/schema");
  const { eq, and, desc } = await import("drizzle-orm");
  const { createStudioTask, reapStaleStudioTasks, getStudioTaskById } = await import("../lib/studio/task-service");

  const userRows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!userRows.length) {
    console.error(`User ${email} not found`);
    process.exit(1);
  }
  const u = userRows[0];
  const creditsBefore = u.credits;
  console.log(`User ${u.email} id=${u.id.slice(0, 8)}… credits=${creditsBefore}`);

  // ── Phase 1: create a tiny throwaway task and force it into a fake-stale state ────
  console.log("\n═══ Phase 1: create + stall a task ═══");
  const idem = `w6-reap-${Date.now()}`;
  const { task } = await createStudioTask({
    userId: u.id,
    taskType: "image_single",
    requestPayload: {
      prompt: "w6 reap test (intentionally never run)",
      size: "1024x1024",
      format: "png",
    },
    idempotencyKey: idem,
  });
  console.log(`task=${task.id.slice(0, 8)}… reserved=${task.creditsReserved} status=${task.status}`);

  const credAfterCreate = (await db.select().from(user).where(eq(user.id, u.id)).limit(1))[0].credits;
  console.log(`user.credits ${creditsBefore} → ${credAfterCreate} (Δ=${credAfterCreate - creditsBefore})`);
  if (credAfterCreate !== creditsBefore - task.creditsReserved) {
    console.warn(`  ⚠ unexpected: expected pre-deduct of ${task.creditsReserved}`);
  }

  const fakeOld = new Date(Date.now() - 20 * 60 * 1000);
  await db
    .update(studioTask)
    .set({ status: "running", startedAt: fakeOld, updatedAt: fakeOld })
    .where(eq(studioTask.id, task.id));
  console.log(`forced status=running, updatedAt=${fakeOld.toISOString()} (20m ago)`);

  // ── Phase 2: invoke reaper ─────────────────────────────────────────────────────
  console.log("\n═══ Phase 2: reapStaleStudioTasks(staleAfterMs=600000) ═══");
  const result = await reapStaleStudioTasks({ staleAfterMs: 10 * 60 * 1000, maxBatch: 50 });
  console.log(`reaped count=${result.totalReaped} refunded=${result.totalRefunded} cutoff=${result.cutoffIso}`);
  const ourEntry = result.reaped.find(r => r.taskId === task.id);
  if (!ourEntry) {
    console.error(`✗ our task not in reaped list (saw ${result.reaped.length} others)`);
    process.exit(2);
  }
  console.log(`  → our task refunded=${ourEntry.refunded}`);

  // ── Phase 3: verify ─────────────────────────────────────────────────────────────
  console.log("\n═══ Phase 3: verify ═══");
  const after = await getStudioTaskById(task.id);
  if (!after) {
    console.error("task vanished");
    process.exit(3);
  }
  console.log(`status:           ${after.status}        (expect failed)`);
  console.log(`errorCode:        ${after.errorCode}    (expect task_stale_reaped)`);
  console.log(`creditsReserved:  ${after.creditsReserved}`);
  console.log(`creditsFinal:     ${after.creditsFinal}    (expect 0)`);
  console.log(`creditsRefunded:  ${after.creditsRefunded}    (expect = creditsReserved)`);

  const credAfterReap = (await db.select().from(user).where(eq(user.id, u.id)).limit(1))[0].credits;
  console.log(`user.credits:     ${creditsBefore} → ${credAfterCreate} → ${credAfterReap}`);

  const events = await db
    .select()
    .from(studioTaskEvent)
    .where(and(eq(studioTaskEvent.taskId, task.id), eq(studioTaskEvent.eventType, "task_reaped")))
    .orderBy(desc(studioTaskEvent.createdAt))
    .limit(1);
  console.log(`reap event:       ${events.length > 0 ? "✓ present" : "✗ missing"}`);

  const allOk =
    after.status === "failed" &&
    after.errorCode === "task_stale_reaped" &&
    after.creditsFinal === 0 &&
    after.creditsRefunded === after.creditsReserved &&
    credAfterReap === creditsBefore &&
    events.length > 0;

  console.log(`\n${allOk ? "✓" : "✗"} W6 reap smoke ${allOk ? "OK" : "FAILED"}`);
  process.exit(allOk ? 0 : 2);
}

void main().catch(err => {
  console.error("[smoke-w6-reap] FATAL:", err);
  process.exit(1);
});
