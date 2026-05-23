import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { createStudioTask, StudioTaskError } from "@/lib/studio/task-service";
import { getErrorMessage } from "@/lib/error-utils";

const pptPlanSchema = z.object({
  topic: z.string().min(1, "Topic is required").max(200),
  audience: z.string().max(120).optional(),
  style: z.string().max(120).optional(),
  pageCount: z.number().int().min(1).max(20).default(8),
  idempotencyKey: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = pptPlanSchema.parse(await req.json());

    const result = await createStudioTask({
      userId: access.user.id,
      taskType: "ppt_plan",
      requestPayload: {
        topic: payload.topic,
        audience: payload.audience || "",
        style: payload.style || "",
        pageCount: payload.pageCount,
      },
      idempotencyKey: payload.idempotencyKey || randomUUID(),
    });

    return NextResponse.json(
      {
        task: result.task,
        created: result.created,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    if (error instanceof StudioTaskError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create PPT plan task") },
      { status: 500 },
    );
  }
}
