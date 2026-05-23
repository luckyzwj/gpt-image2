import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { createStudioTask, StudioTaskError } from "@/lib/studio/task-service";
import { getErrorMessage } from "@/lib/error-utils";

const imageTaskSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  size: z.string().optional(),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  format: z.enum(["png", "jpeg", "jpg", "webp"]).optional(),
  idempotencyKey: z.string().optional(),
  referenceImages: z
    .array(
      z.object({
        base64: z.string().min(1),
        mimeType: z.string().min(1),
        label: z.string().optional(),
      }),
    )
    .max(6)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = imageTaskSchema.parse(await req.json());
    const result = await createStudioTask({
      userId: access.user.id,
      taskType: "image_single",
      requestPayload: {
        prompt: payload.prompt,
        size: payload.size || "1024x1024",
        quality: payload.quality || "high",
        format: payload.format || "png",
        referenceImages: payload.referenceImages || [],
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
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create image task") }, { status: 500 });
  }
}
