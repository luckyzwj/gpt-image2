import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import {
  createPromptTemplate,
  listPromptTemplates,
  PromptTemplateError,
} from "@/lib/studio/prompt-template-service";
import { getErrorMessage } from "@/lib/error-utils";

const listQuerySchema = z.object({
  category: z.string().min(1).max(48).optional(),
  favorite: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const createBodySchema = z.object({
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(8000),
  category: z.string().min(1).max(48).optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  favorite: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const url = new URL(req.url);
    const parsed = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));

    const templates = await listPromptTemplates({
      userId: access.user.id,
      category: parsed.category,
      favoriteOnly: parsed.favorite === "true",
      limit: parsed.limit,
    });

    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid query" },
        { status: 400 },
      );
    }
    if (error instanceof PromptTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list prompt templates") },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = createBodySchema.parse(await req.json());
    const template = await createPromptTemplate({
      userId: access.user.id,
      name: payload.name,
      prompt: payload.prompt,
      category: payload.category,
      tags: payload.tags,
      favorite: payload.favorite,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    if (error instanceof PromptTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create prompt template") },
      { status: 500 },
    );
  }
}
