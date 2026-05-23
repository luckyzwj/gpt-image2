import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import {
  listUserApiKeys,
  upsertUserApiKey,
  setUserApiKeyEnabled,
  deleteUserApiKey,
  type ApiKeyProvider,
} from "@/lib/studio/providers/openai/user-api-key-service";
import { getErrorMessage } from "@/lib/error-utils";

const SUPPORTED_PROVIDERS: ApiKeyProvider[] = ["openai"];

const upsertBodySchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS as unknown as [ApiKeyProvider, ...ApiKeyProvider[]]).optional(),
  apiKey: z.string().min(10).max(512),
  baseUrl: z.string().max(512).optional().nullable(),
  enabled: z.boolean().optional(),
});

const patchBodySchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS as unknown as [ApiKeyProvider, ...ApiKeyProvider[]]).optional(),
  enabled: z.boolean(),
});

const deleteBodySchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS as unknown as [ApiKeyProvider, ...ApiKeyProvider[]]).optional(),
});

async function requireUserFromRequest(req: NextRequest) {
  const access = await getActiveSessionUser(req.headers);
  if (!access.ok) {
    return { ok: false as const, response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  return { ok: true as const, user: access.user };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const keys = await listUserApiKeys(auth.user.id);
    return NextResponse.json({ keys });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list API keys") },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = upsertBodySchema.parse(await req.json());
    const record = await upsertUserApiKey({
      userId: auth.user.id,
      apiKey: payload.apiKey,
      provider: payload.provider ?? "openai",
      baseUrl: payload.baseUrl ?? null,
      enabled: payload.enabled,
    });
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to save API key") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = patchBodySchema.parse(await req.json());
    const record = await setUserApiKeyEnabled({
      userId: auth.user.id,
      provider: payload.provider ?? "openai",
      enabled: payload.enabled,
    });
    if (!record) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to toggle API key") },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const payload = deleteBodySchema.parse(await req.json().catch(() => ({})));
    const removed = await deleteUserApiKey({
      userId: auth.user.id,
      provider: payload.provider ?? "openai",
    });
    return NextResponse.json({ removed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to delete API key") },
      { status: 500 },
    );
  }
}
