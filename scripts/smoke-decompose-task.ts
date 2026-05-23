#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { createStudioTask, getStudioTaskById, getStudioTaskEvents } = await import("../lib/studio/task-service");
  const { runQueuedStudioTasks } = await import("../lib/studio/task-runner");
  const { db } = await import("../lib/db");
  const { user } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const email = process.argv[2];
  const imagePath = process.argv[3];
  if (!email || !imagePath) {
    console.error("Usage: tsx scripts/smoke-decompose-task.ts <email> <image-path>");
    process.exit(1);
  }

  const userRows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (userRows.length === 0) {
    console.error(`User ${email} not found`);
    process.exit(1);
  }
  const u = userRows[0];
  console.log(`User: ${u.email} (id=${u.id}, credits before=${u.credits})`);

  const buffer = readFileSync(imagePath);
  const imageBase64 = buffer.toString("base64");
  const mimeType = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : imagePath.toLowerCase().endsWith(".webp")
      ? "image/webp"
      : "image/png";
  console.log(`Image: ${imagePath} (${buffer.length} bytes, base64 ${imageBase64.length} chars, ${mimeType})`);

  const idempotencyKey = `smoke-decompose-${Date.now()}`;
  console.log(`\n[1/3] Creating image_decompose task...`);
  const { task } = await createStudioTask({
    userId: u.id,
    taskType: "image_decompose",
    requestPayload: {
      imageBase64,
      mimeType,
      depth: "detailed",
      locale: "zh",
    },
    idempotencyKey,
  });
  console.log(`Task created: id=${task.id} status=${task.status} creditsReserved=${task.creditsReserved}`);

  console.log(`\n[2/3] Running queue (this calls OpenAI /responses through proxy)...`);
  const startedAt = Date.now();
  const result = await runQueuedStudioTasks(1);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Queue run done in ${elapsed}s:`, result);

  console.log(`\n[3/3] Fetching task result...`);
  const updated = await getStudioTaskById(task.id);
  console.log(`Final status: ${updated?.status} creditsFinal=${updated?.creditsFinal} creditsRefunded=${updated?.creditsRefunded}`);
  if (updated?.errorMessage) {
    console.log(`Error: ${updated.errorCode} — ${updated.errorMessage}`);
  }

  const analysis = (updated?.result as Record<string, unknown> | null)?.analysis as Record<string, unknown> | undefined;
  if (analysis) {
    console.log(`\nAnalysis:`);
    console.log(`  description:  ${analysis.description}`);
    console.log(`  subject:      ${analysis.subject}`);
    console.log(`  style:        ${analysis.style}`);
    console.log(`  composition:  ${analysis.composition}`);
    console.log(`  mood:         ${analysis.mood}`);
    console.log(`  lighting:     ${analysis.lighting}`);
    const colors = Array.isArray(analysis.colors) ? analysis.colors : [];
    console.log(`  colors:       ${colors.join(", ")}`);
    const prompts = Array.isArray(analysis.suggestedPrompts) ? analysis.suggestedPrompts : [];
    console.log(`  suggestedPrompts (${prompts.length}):`);
    for (const p of prompts) {
      console.log(`    - ${String(p).slice(0, 120)}`);
    }
  }

  const events = await getStudioTaskEvents(task.id);
  console.log(`\nEvents (${events.length}):`);
  for (const ev of events) {
    console.log(`  - [${ev.progress ?? "?"}%] ${ev.eventType}`);
  }

  const refreshed = await db.select().from(user).where(eq(user.id, u.id)).limit(1);
  console.log(`\nCredits after: ${refreshed[0].credits}`);

  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
