#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { createStudioTask, getStudioTaskById, getStudioTaskEvents } = await import("../lib/studio/task-service");
  const { runQueuedStudioTasks } = await import("../lib/studio/task-runner");
  const { db } = await import("../lib/db");
  const { studioAsset } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx scripts/smoke-image-task.ts <email>");
    process.exit(1);
  }

  const { user } = await import("../lib/db/schema");
  const userRows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (userRows.length === 0) {
    console.error(`User ${email} not found`);
    process.exit(1);
  }
  const u = userRows[0];
  console.log(`User: ${u.email} (id=${u.id}, credits=${u.credits})`);

  const idempotencyKey = `smoke-${Date.now()}`;
  console.log(`\n[1/3] Creating image_single task (idempotencyKey=${idempotencyKey})...`);
  const { task } = await createStudioTask({
    userId: u.id,
    taskType: "image_single",
    requestPayload: {
      prompt: "A small red apple on a white background, photographic style",
      size: "1024x1024",
      quality: "low",
      format: "png",
    },
    idempotencyKey,
  });
  console.log(`Task created: id=${task.id} status=${task.status} creditsReserved=${task.creditsReserved}`);

  console.log(`\n[2/3] Running queue (this calls OpenAI through proxy)...`);
  const startedAt = Date.now();
  const result = await runQueuedStudioTasks(1);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Queue run done in ${elapsed}s:`, result);

  console.log(`\n[3/3] Fetching task + assets...`);
  const updated = await getStudioTaskById(task.id);
  console.log(`Final status: ${updated?.status} creditsFinal=${updated?.creditsFinal} creditsRefunded=${updated?.creditsRefunded}`);
  if (updated?.errorMessage) {
    console.log(`Error: ${updated.errorCode} — ${updated.errorMessage}`);
  }

  const events = await getStudioTaskEvents(task.id);
  console.log(`\nEvents (${events.length}):`);
  for (const ev of events) {
    console.log(`  - [${ev.progress ?? "?"}%] ${ev.eventType}`);
  }

  const assets = await db.select().from(studioAsset).where(eq(studioAsset.taskId, task.id));
  console.log(`\nAssets (${assets.length}):`);
  for (const a of assets) {
    const urlPreview = a.publicUrl.startsWith("data:")
      ? `data:... (${a.publicUrl.length} chars, ${a.sizeBytes} bytes decoded)`
      : a.publicUrl;
    console.log(`  - ${a.assetType} ${a.mimeType}: ${urlPreview}`);
  }

  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
