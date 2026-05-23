#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { createStudioTask, getStudioTaskById, getStudioTaskEvents } = await import("../lib/studio/task-service");
  const { runQueuedStudioTasks } = await import("../lib/studio/task-runner");
  const { db } = await import("../lib/db");
  const { user } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx scripts/smoke-plan-tasks.ts <email>");
    process.exit(1);
  }

  const userRows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (userRows.length === 0) {
    console.error(`User ${email} not found`);
    process.exit(1);
  }
  const u = userRows[0];
  console.log(`User: ${u.email} (id=${u.id}, credits before=${u.credits})`);

  const articleTask = await createStudioTask({
    userId: u.id,
    taskType: "article_plan",
    requestPayload: {
      title: "Why Async Image Generation Beats Sync",
      body: "When users wait for image generation, perceived latency matters more than throughput.",
      imageCount: 3,
      style: "minimalist editorial",
    },
    idempotencyKey: `smoke-article-plan-${Date.now()}`,
  });
  console.log(`[article_plan] id=${articleTask.task.id} reserved=${articleTask.task.creditsReserved}`);

  const pptTask = await createStudioTask({
    userId: u.id,
    taskType: "ppt_plan",
    requestPayload: {
      topic: "Migrating a CLI Tool to SaaS",
      pageCount: 5,
      audience: "engineering leads",
      style: "modern flat",
    },
    idempotencyKey: `smoke-ppt-plan-${Date.now()}`,
  });
  console.log(`[ppt_plan] id=${pptTask.task.id} reserved=${pptTask.task.creditsReserved}`);

  console.log(`\nRunning queue (2 tasks)...`);
  const result = await runQueuedStudioTasks(2);
  console.log(`Queue done:`, result);

  const articleFinal = await getStudioTaskById(articleTask.task.id);
  const pptFinal = await getStudioTaskById(pptTask.task.id);

  console.log(`\n[article_plan] status=${articleFinal?.status} final=${articleFinal?.creditsFinal} refunded=${articleFinal?.creditsRefunded}`);
  const articleResult = articleFinal?.result as Record<string, unknown> | null;
  if (articleResult) {
    const slots = Array.isArray(articleResult.slots) ? (articleResult.slots as Array<Record<string, unknown>>) : [];
    console.log(`  Plan: ${slots.length} slots`);
    for (const slot of slots) {
      console.log(`    - [${slot.position}] ${String(slot.prompt).slice(0, 90)}...`);
    }
  }
  if (articleFinal?.errorMessage) {
    console.log(`  ERROR: ${articleFinal.errorCode} — ${articleFinal.errorMessage}`);
  }

  console.log(`\n[ppt_plan] status=${pptFinal?.status} final=${pptFinal?.creditsFinal} refunded=${pptFinal?.creditsRefunded}`);
  const pptResult = pptFinal?.result as Record<string, unknown> | null;
  if (pptResult) {
    const slides = Array.isArray(pptResult.slides) ? (pptResult.slides as Array<Record<string, unknown>>) : [];
    console.log(`  Plan: ${slides.length} slides`);
    for (const slide of slides) {
      console.log(`    - [${slide.index}] ${slide.title} | ${String(slide.imagePrompt).slice(0, 70)}...`);
    }
  }
  if (pptFinal?.errorMessage) {
    console.log(`  ERROR: ${pptFinal.errorCode} — ${pptFinal.errorMessage}`);
  }

  const refreshed = await db.select().from(user).where(eq(user.id, u.id)).limit(1);
  console.log(`\nCredits after: ${refreshed[0].credits} (should equal before since both plans refund)`);

  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
