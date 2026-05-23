import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { createStudioTask, StudioTaskError } from "@/lib/studio/task-service";
import { getErrorMessage } from "@/lib/error-utils";

const decomposeTaskSchema = z.object({
  imageBase64: z.string().min(1, "imageBase64 is required"),
  mimeType: z.string().min(1).optional(),
  depth: z.enum(["brief", "detailed"]).optional(),
  locale: z.string().min(2).max(8).optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = decomposeTaskSchema.parse(await req.json());

    const result = await createStudioTask({
      userId: access.user.id,
      taskType: "image_decompose",
      requestPayload: {
        imageBase64: payload.imageBase64,
        mimeType: payload.mimeType || "image/png",
        depth: payload.depth || "detailed",
        locale: payload.locale || "zh",
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
      { error: getErrorMessage(error, "Failed to create decompose task") },
      { status: 500 },
    );
  }
}
