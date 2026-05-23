import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { listStudioTasksForUser } from "@/lib/studio/task-service";
import { getErrorMessage } from "@/lib/error-utils";
import type { StudioTaskStatus, StudioTaskType } from "@/lib/studio/domain/types";

export async function GET(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const status = req.nextUrl.searchParams.get("status") as StudioTaskStatus | null;
    const taskType = req.nextUrl.searchParams.get("taskType") as StudioTaskType | null;
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);

    const tasks = await listStudioTasksForUser(access.user.id, {
      status: status || undefined,
      taskType: taskType || undefined,
      limit,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to list tasks") }, { status: 500 });
  }
}
