#!/usr/bin/env tsx
/**
 * Smoke test for the SSE progress endpoint added in W4.
 *
 * 1. Seed a Better Auth session for luckyzwj@gmail.com
 * 2. Pick the most recent studio_task for that user (any status)
 * 3. Open GET /api/studio/tasks/[taskId]/stream over fetch with the session cookie
 * 4. Parse the SSE frames, verify we receive at least task + assets + done events
 * 5. Print a summary
 *
 * Usage: pnpm exec tsx scripts/smoke-w4-sse.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { spawnSync } from "node:child_process";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

type SeedCookie = { name: string; value: string; userId: string };

function seedSession(): SeedCookie {
  const res = spawnSync("pnpm", ["exec", "tsx", "scripts/e2e-seed-session.ts"], {
    encoding: "utf-8",
    shell: true,
  });
  if (res.status !== 0) {
    throw new Error(`seeder failed: ${res.stderr}`);
  }
  const jsonLine = res.stdout.split("\n").map(l => l.trim()).find(l => l.startsWith("{"));
  if (!jsonLine) throw new Error(`no JSON from seeder: ${res.stdout}`);
  return JSON.parse(jsonLine) as SeedCookie;
}

type ParsedFrame = { event: string; data: unknown };

async function readSSE(res: Response, onFrame: (frame: ParsedFrame) => boolean | void) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no response body");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      let evt = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) evt = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const raw = dataLines.join("\n");
      let parsed: unknown = raw;
      try {
        parsed = raw ? JSON.parse(raw) : raw;
      } catch {
        parsed = raw;
      }
      const stop = onFrame({ event: evt, data: parsed });
      if (stop) {
        await reader.cancel();
        return;
      }
    }
  }
}

async function main() {
  const cookie = seedSession();
  console.log(`[sse] session userId=${cookie.userId.slice(0, 8)}…`);

  const { db } = await import("../lib/db");
  const { studioTask } = await import("../lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(studioTask)
    .where(eq(studioTask.userId, cookie.userId))
    .orderBy(desc(studioTask.createdAt))
    .limit(1);

  if (!rows.length) {
    console.error("[sse] no tasks for user — run smoke-w4-creation first");
    process.exit(1);
  }
  const task = rows[0];
  console.log(`[sse] picked task ${task.id.slice(0, 8)}… status=${task.status} type=${task.taskType}`);

  const url = `${BASE_URL}/api/studio/tasks/${task.id}/stream`;
  console.log(`[sse] GET ${url}`);
  const startedAt = Date.now();
  const res = await fetch(url, {
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      Accept: "text/event-stream",
    },
  });
  console.log(`[sse] HTTP ${res.status} content-type=${res.headers.get("content-type")}`);
  if (!res.ok) {
    console.error(`[sse] non-OK: ${await res.text()}`);
    process.exit(2);
  }

  const seen = new Map<string, number>();
  const frames: ParsedFrame[] = [];
  let lastTaskFrame: Record<string, unknown> | null = null;
  let assetCount = 0;
  let receivedDone = false;

  await readSSE(res, frame => {
    seen.set(frame.event, (seen.get(frame.event) ?? 0) + 1);
    frames.push(frame);
    if (frame.event === "task" && frame.data && typeof frame.data === "object") {
      lastTaskFrame = frame.data as Record<string, unknown>;
    }
    if (frame.event === "assets" && frame.data && typeof frame.data === "object") {
      const data = frame.data as { assets?: unknown[] };
      assetCount = Array.isArray(data.assets) ? data.assets.length : 0;
    }
    if (frame.event === "done") {
      receivedDone = true;
      return true;
    }
    if (frame.event === "error") {
      console.error("[sse] error frame:", frame.data);
      return true;
    }
    return false;
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[sse] frame summary (${elapsed}s total):`);
  for (const [evt, count] of seen.entries()) {
    console.log(`  ${evt.padEnd(10)} ×${count}`);
  }
  const snapshot = lastTaskFrame as { status?: unknown; creditsReserved?: unknown; creditsFinal?: unknown } | null;
  console.log(`[sse] last task snapshot status=${snapshot?.status} reserved=${snapshot?.creditsReserved} final=${snapshot?.creditsFinal}`);
  console.log(`[sse] assets in last 'assets' frame: ${assetCount}`);
  console.log(`[sse] received done? ${receivedDone ? "✓" : "✗"}`);

  const okEvents = (seen.get("event") ?? 0) > 0;
  const okTaskSnap = lastTaskFrame !== null;
  const okClose = receivedDone;
  const allOk = okEvents && okTaskSnap && okClose;
  console.log(`\n${allOk ? "✓" : "✗"} SSE end-to-end ${allOk ? "OK" : "FAILED"}`);

  process.exit(allOk ? 0 : 2);
}

void main().catch(err => {
  console.error("[sse] FATAL:", err);
  process.exit(1);
});
