import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import {
  deletePromptTemplate,
  getPromptTemplate,
  PromptTemplateError,
  recordPromptTemplateUsage,
  updatePromptTemplate,
} from "@/lib/studio/prompt-template-service";
import { getErrorMessage } from "@/lib/error-utils";

const updateBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(8000).optional(),
  category: z.string().min(1).max(48).optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  favorite: z.boolean().optional(),
  recordUsage: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { templateId } = await context.params;
    const template = await getPromptTemplate({ id: templateId, userId: access.user.id });
    if (!template) {
      return NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof PromptTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to fetch prompt template") },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { templateId } = await context.params;
    const payload = updateBodySchema.parse(await req.json());

    let template = await updatePromptTemplate({
      id: templateId,
      userId: access.user.id,
      name: payload.name,
      prompt: payload.prompt,
      category: payload.category,
      tags: payload.tags,
      favorite: payload.favorite,
    });

    if (payload.recordUsage) {
      await recordPromptTemplateUsage({ id: templateId, userId: access.user.id });
      const refreshed = await getPromptTemplate({ id: templateId, userId: access.user.id });
      if (refreshed) template = refreshed;
    }

    return NextResponse.json({ template });
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
      { error: getErrorMessage(error, "Failed to update prompt template") },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { templateId } = await context.params;
    const deleted = await deletePromptTemplate({ id: templateId, userId: access.user.id });
    if (!deleted) {
      return NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof PromptTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to delete prompt template") },
      { status: 500 },
    );
  }
}
