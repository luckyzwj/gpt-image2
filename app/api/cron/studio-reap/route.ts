import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import { reapStaleStudioTasks } from "@/lib/studio/task-service";

const CRON_SECRET = process.env.CRON_SECRET;
const CRON_JOBS_USERNAME = process.env.CRON_JOBS_USERNAME;
const CRON_JOBS_PASSWORD = process.env.CRON_JOBS_PASSWORD;

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;
const MIN_STALE_AFTER_MS = 60 * 1000;
const MAX_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const hasBasicCreds = Boolean(CRON_JOBS_USERNAME && CRON_JOBS_PASSWORD);
  const hasBearer = Boolean(CRON_SECRET);

  if (!hasBasicCreds && !hasBearer) {
    return false;
  }

  if (hasBearer && authHeader === `Bearer ${CRON_SECRET}`) {
    return true;
  }

  if (hasBasicCreds && authHeader.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const [username, password] = decoded.split(":");
      return username === CRON_JOBS_USERNAME && password === CRON_JOBS_PASSWORD;
    } catch {
      return false;
    }
  }

  return false;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleAfterParam = req.nextUrl.searchParams.get("staleAfterMs");
  const parsedStale = staleAfterParam ? Number.parseInt(staleAfterParam, 10) : DEFAULT_STALE_AFTER_MS;
  const staleAfterMs = Number.isFinite(parsedStale)
    ? Math.min(Math.max(parsedStale, MIN_STALE_AFTER_MS), MAX_STALE_AFTER_MS)
    : DEFAULT_STALE_AFTER_MS;

  const maxBatchParam = req.nextUrl.searchParams.get("maxBatch");
  const parsedBatch = maxBatchParam ? Number.parseInt(maxBatchParam, 10) : 25;
  const maxBatch = Number.isFinite(parsedBatch) ? Math.min(Math.max(parsedBatch, 1), 100) : 25;

  try {
    const result = await reapStaleStudioTasks({ staleAfterMs, maxBatch });
    return NextResponse.json({
      ok: true,
      ...result,
      staleAfterMs,
      maxBatch,
    });
  } catch (error) {
    console.error("[cron/studio-reap] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Reap failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
