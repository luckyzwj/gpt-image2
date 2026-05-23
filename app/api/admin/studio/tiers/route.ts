import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import {
  listTierConfigs,
  upsertTierConfig,
  invalidateQuotaCache,
} from "@/lib/studio/quota-service";
import { getErrorMessage } from "@/lib/error-utils";

const updateBodySchema = z.object({
  tierKey: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i),
  displayName: z.string().min(1).max(120).optional(),
  dailyTaskLimit: z.number().int().min(0).max(1_000_000),
  dailyCreditLimit: z.number().int().min(0).max(10_000_000),
  concurrentTaskLimit: z.number().int().min(1).max(1000),
  maxPromptTemplates: z.number().int().min(0).max(10_000),
  enabled: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
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

    const tiers = await listTierConfigs();
    return NextResponse.json({ tiers });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list tier configs") },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = updateBodySchema.parse(await req.json());
    const updated = await upsertTierConfig({
      tierKey: payload.tierKey,
      displayName: payload.displayName,
      dailyTaskLimit: payload.dailyTaskLimit,
      dailyCreditLimit: payload.dailyCreditLimit,
      concurrentTaskLimit: payload.concurrentTaskLimit,
      maxPromptTemplates: payload.maxPromptTemplates,
      enabled: payload.enabled,
      notes: payload.notes ?? null,
      updatedBy: auth.user.id,
    });
    invalidateQuotaCache();
    return NextResponse.json({ record: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to update tier config") },
      { status: 500 },
    );
  }
}
