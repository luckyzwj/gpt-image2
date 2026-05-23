import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioUserQuotaOverride, user } from "@/lib/db/schema";
import { getActiveSessionUser } from "@/lib/auth/session";
import {
  upsertUserQuotaOverride,
  deleteUserQuotaOverride,
  getEffectiveQuota,
  invalidateQuotaCache,
} from "@/lib/studio/quota-service";
import { getErrorMessage } from "@/lib/error-utils";

const updateBodySchema = z.object({
  userId: z.string().min(1).max(64),
  dailyTaskLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  dailyCreditLimit: z.number().int().min(0).max(10_000_000).nullable().optional(),
  concurrentTaskLimit: z.number().int().min(1).max(1000).nullable().optional(),
  maxPromptTemplates: z.number().int().min(0).max(10_000).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const deleteBodySchema = z.object({
  userId: z.string().min(1).max(64),
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

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");

    if (userId) {
      const effective = await getEffectiveQuota(userId);
      const userRows = await db
        .select({ id: user.id, email: user.email, name: user.name, planKey: user.planKey })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (userRows.length === 0) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ user: userRows[0], effective });
    }

    const rows = await db
      .select({
        override: studioUserQuotaOverride,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          planKey: user.planKey,
        },
      })
      .from(studioUserQuotaOverride)
      .innerJoin(user, eq(studioUserQuotaOverride.userId, user.id));

    return NextResponse.json({ overrides: rows });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list quota overrides") },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = updateBodySchema.parse(await req.json());

    const userRows = await db.select({ id: user.id }).from(user).where(eq(user.id, payload.userId)).limit(1);
    if (userRows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updated = await upsertUserQuotaOverride({
      userId: payload.userId,
      dailyTaskLimit: payload.dailyTaskLimit ?? null,
      dailyCreditLimit: payload.dailyCreditLimit ?? null,
      concurrentTaskLimit: payload.concurrentTaskLimit ?? null,
      maxPromptTemplates: payload.maxPromptTemplates ?? null,
      reason: payload.reason ?? null,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      grantedBy: auth.user.id,
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
      { error: getErrorMessage(error, "Failed to update quota override") },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAdminFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = deleteBodySchema.parse(await req.json());
    const removed = await deleteUserQuotaOverride(payload.userId);
    invalidateQuotaCache();
    return NextResponse.json({ removed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to delete quota override") },
      { status: 500 },
    );
  }
}
