import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getErrorMessage } from "@/lib/error-utils";
import { listStudioTasksForAdmin } from "@/lib/studio/task-service";
import type { StudioTaskStatus, StudioTaskType } from "@/lib/studio/domain/types";

export async function GET(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok || access.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = req.nextUrl.searchParams.get("status") as StudioTaskStatus | null;
    const taskType = req.nextUrl.searchParams.get("taskType") as StudioTaskType | null;
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
    const tasks = await listStudioTasksForAdmin({
      status: status || undefined,
      taskType: taskType || undefined,
      limit,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to list admin tasks") }, { status: 500 });
  }
}
