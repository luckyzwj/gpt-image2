import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getStudioTaskEvents, getStudioTaskForUser } from "@/lib/studio/task-service";
import { listStudioAssetsByTask } from "@/lib/studio/asset-service";
import { getErrorMessage } from "@/lib/error-utils";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ taskId: string }> },
) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { taskId } = await props.params;
    const task = await getStudioTaskForUser(taskId, access.user.id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const [events, assets] = await Promise.all([
      getStudioTaskEvents(taskId, 200),
      listStudioAssetsByTask(taskId),
    ]);

    return NextResponse.json({
      task,
      events,
      assets,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to fetch task detail") }, { status: 500 });
  }
}
