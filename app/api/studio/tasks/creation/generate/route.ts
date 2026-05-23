import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { createStudioTask, StudioTaskError } from "@/lib/studio/task-service";
import { getErrorMessage } from "@/lib/error-utils";

const creationGenerateSchema = z.object({
  productName: z.string().min(1, "Product name is required"),
  productDescription: z.string().min(1, "Product description is required"),
  sellingPoints: z.array(z.string().min(1)).default([]),
  imageCount: z.number().int().min(1).max(12).default(4),
  prompts: z.array(z.string().min(1)).optional(),
  size: z.string().optional(),
  format: z.enum(["png", "jpeg", "jpg", "webp"]).optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = creationGenerateSchema.parse(await req.json());

    const result = await createStudioTask({
      userId: access.user.id,
      taskType: "creation_generate",
      requestPayload: {
        productName: payload.productName,
        productDescription: payload.productDescription,
        sellingPoints: payload.sellingPoints,
        imageCount: payload.imageCount,
        prompts: payload.prompts || [],
        size: payload.size || "1024x1024",
        format: payload.format || "png",
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
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create creation generation task") }, { status: 500 });
  }
}
