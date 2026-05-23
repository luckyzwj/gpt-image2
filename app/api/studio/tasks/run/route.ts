import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { runQueuedStudioTasks } from "@/lib/studio/task-runner";
import { getErrorMessage } from "@/lib/error-utils";

function isCronAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${secret}`;
}

async function isAdminAuthorized(req: NextRequest) {
  const access = await getActiveSessionUser(req.headers);
  if (!access.ok) {
    return false;
  }
  return access.user.role === "admin";
}

async function run(req: NextRequest) {
  const cronAuthorized = isCronAuthorized(req);
  const adminAuthorized = cronAuthorized ? false : await isAdminAuthorized(req);
  const userAccess = cronAuthorized || adminAuthorized
    ? null
    : await getActiveSessionUser(req.headers);
  const userAuthorized = Boolean(userAccess && userAccess.ok);

  if (!cronAuthorized && !adminAuthorized && !userAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const queryLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") || "", 10);
  const bodyLimit = Number.parseInt(String((body as { limit?: number }).limit || ""), 10);
  const limit = Number.isFinite(bodyLimit)
    ? bodyLimit
    : Number.isFinite(queryLimit)
      ? queryLimit
      : 2;

  const summary = await runQueuedStudioTasks(limit);
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest) {
  try {
    return await run(req);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to run tasks") }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    return await run(req);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to run tasks") }, { status: 500 });
  }
}
