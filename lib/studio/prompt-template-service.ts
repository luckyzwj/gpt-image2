import { randomUUID } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioPromptTemplate } from "@/lib/db/schema";

const MAX_NAME_LENGTH = 120;
const MAX_PROMPT_LENGTH = 8000;
const MAX_CATEGORY_LENGTH = 48;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 32;
const DEFAULT_CATEGORY = "general";

export class PromptTemplateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PromptTemplateError";
  }
}

export type PromptTemplateRecord = {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  category: string;
  tags: string[];
  favorite: boolean;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => (typeof item === "string" ? item.trim() : ""))
      .filter(item => item.length > 0);
  } catch {
    return [];
  }
}

function serializeTags(tags: string[] | undefined): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const cleaned = tags
    .map(tag => String(tag ?? "").trim())
    .filter(tag => tag.length > 0)
    .slice(0, MAX_TAGS)
    .map(tag => (tag.length > MAX_TAG_LENGTH ? tag.slice(0, MAX_TAG_LENGTH) : tag));
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

function normalizeName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new PromptTemplateError("Template name is required", 400);
  }
  return trimmed.length > MAX_NAME_LENGTH ? trimmed.slice(0, MAX_NAME_LENGTH) : trimmed;
}

function normalizePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new PromptTemplateError("Prompt content is required", 400);
  }
  return trimmed.length > MAX_PROMPT_LENGTH ? trimmed.slice(0, MAX_PROMPT_LENGTH) : trimmed;
}

function normalizeCategory(category: string | undefined) {
  const value = (category || DEFAULT_CATEGORY).trim().toLowerCase();
  return value.length > MAX_CATEGORY_LENGTH ? value.slice(0, MAX_CATEGORY_LENGTH) : value || DEFAULT_CATEGORY;
}

type Row = typeof studioPromptTemplate.$inferSelect;

function rowToRecord(row: Row): PromptTemplateRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    prompt: row.prompt,
    category: row.category,
    tags: parseTags(row.tags),
    favorite: row.favorite,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPromptTemplates({
  userId,
  category,
  favoriteOnly,
  limit,
}: {
  userId: string;
  category?: string;
  favoriteOnly?: boolean;
  limit?: number;
}): Promise<PromptTemplateRecord[]> {
  const conditions = [eq(studioPromptTemplate.userId, userId)];
  if (category) {
    conditions.push(eq(studioPromptTemplate.category, normalizeCategory(category)));
  }
  if (favoriteOnly) {
    conditions.push(eq(studioPromptTemplate.favorite, true));
  }

  const safeLimit = Math.min(Math.max(limit ?? 200, 1), 500);

  const rows = await db
    .select()
    .from(studioPromptTemplate)
    .where(and(...conditions))
    .orderBy(desc(studioPromptTemplate.favorite), desc(studioPromptTemplate.updatedAt), asc(studioPromptTemplate.name))
    .limit(safeLimit);

  return rows.map(rowToRecord);
}

export async function getPromptTemplate({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<PromptTemplateRecord | null> {
  const rows = await db
    .select()
    .from(studioPromptTemplate)
    .where(and(eq(studioPromptTemplate.id, id), eq(studioPromptTemplate.userId, userId)))
    .limit(1);
  return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function createPromptTemplate({
  userId,
  name,
  prompt,
  category,
  tags,
  favorite,
}: {
  userId: string;
  name: string;
  prompt: string;
  category?: string;
  tags?: string[];
  favorite?: boolean;
}): Promise<PromptTemplateRecord> {
  const id = randomUUID();
  const now = new Date();

  await db.insert(studioPromptTemplate).values({
    id,
    userId,
    name: normalizeName(name),
    prompt: normalizePrompt(prompt),
    category: normalizeCategory(category),
    tags: serializeTags(tags),
    favorite: favorite === true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const record = await getPromptTemplate({ id, userId });
  if (!record) {
    throw new PromptTemplateError("Failed to create prompt template", 500);
  }
  return record;
}

export async function updatePromptTemplate({
  id,
  userId,
  name,
  prompt,
  category,
  tags,
  favorite,
}: {
  id: string;
  userId: string;
  name?: string;
  prompt?: string;
  category?: string;
  tags?: string[];
  favorite?: boolean;
}): Promise<PromptTemplateRecord> {
  const existing = await getPromptTemplate({ id, userId });
  if (!existing) {
    throw new PromptTemplateError("Prompt template not found", 404);
  }

  const updates: Partial<typeof studioPromptTemplate.$inferInsert> = {};
  if (typeof name === "string") updates.name = normalizeName(name);
  if (typeof prompt === "string") updates.prompt = normalizePrompt(prompt);
  if (typeof category === "string") updates.category = normalizeCategory(category);
  if (Array.isArray(tags)) updates.tags = serializeTags(tags);
  if (typeof favorite === "boolean") updates.favorite = favorite;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  await db
    .update(studioPromptTemplate)
    .set(updates)
    .where(and(eq(studioPromptTemplate.id, id), eq(studioPromptTemplate.userId, userId)));

  const refreshed = await getPromptTemplate({ id, userId });
  if (!refreshed) {
    throw new PromptTemplateError("Prompt template disappeared during update", 500);
  }
  return refreshed;
}

export async function deletePromptTemplate({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(studioPromptTemplate)
    .where(and(eq(studioPromptTemplate.id, id), eq(studioPromptTemplate.userId, userId)))
    .returning({ id: studioPromptTemplate.id });
  return deleted.length > 0;
}

export async function recordPromptTemplateUsage({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<void> {
  await db
    .update(studioPromptTemplate)
    .set({
      usageCount: sql`${studioPromptTemplate.usageCount} + 1`,
      lastUsedAt: new Date(),
    })
    .where(and(eq(studioPromptTemplate.id, id), eq(studioPromptTemplate.userId, userId)));
}
