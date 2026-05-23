import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import {
  listPricingRecords,
  upsertPricingRecord,
  invalidatePricingCache,
} from "@/lib/studio/pricing-service";
import { STUDIO_TASK_TYPES, type StudioTaskType } from "@/lib/studio/domain/types";
import { getErrorMessage } from "@/lib/error-utils";

const updateBodySchema = z.object({
  taskType: z.enum(STUDIO_TASK_TYPES as unknown as [StudioTaskType, ...StudioTaskType[]]),
  quality: z.string().min(1).max(16).optional(),
  priceCredits: z.number().int().min(0).max(100000),
  minBatchSize: z.number().int().min(1).max(100).optional(),
  maxBatchSize: z.number().int().min(1).max(100).optional(),
  defaultBatchSize: z.number().int().min(1).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
});

async function requireAdminFromRequest(req: NextRequest) {
  const access = await getActiveSessionUser(req.headers);
  if (!access.ok) {
    return { ok: false as const, response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  if (access.user.role !== "admin") {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, user: access.user };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminFromRequest(req);
    if (!auth.ok) return auth.response;

    const records = await listPricingRecords();
    return NextResponse.json({ pricing: records });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list pricing config") },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = updateBodySchema.parse(await req.json());

    const updated = await upsertPricingRecord({
      taskType: payload.taskType,
      quality: payload.quality,
      priceCredits: payload.priceCredits,
      minBatchSize: payload.minBatchSize,
      maxBatchSize: payload.maxBatchSize,
      defaultBatchSize: payload.defaultBatchSize,
      notes: payload.notes ?? null,
      enabled: payload.enabled,
      updatedBy: auth.user.id,
    });

    invalidatePricingCache();
    return NextResponse.json({ record: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to update pricing config") },
      { status: 500 },
    );
  }
}
