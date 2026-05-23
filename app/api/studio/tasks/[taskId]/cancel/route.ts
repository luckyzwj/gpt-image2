import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { cancelStudioTaskForUser, StudioTaskError } from "@/lib/studio/task-service";
import { getErrorMessage } from "@/lib/error-utils";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ taskId: string }> },
) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { taskId } = await props.params;
    const task = await cancelStudioTaskForUser(taskId, access.user.id);
    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof StudioTaskError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: getErrorMessage(error, "Failed to cancel task") }, { status: 500 });
  }
}
