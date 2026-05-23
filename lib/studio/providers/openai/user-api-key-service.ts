import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioUserApiKey } from "@/lib/db/schema";
import { encryptApiKey, decryptApiKey, keyHint } from "@/lib/studio/providers/openai/crypto";

export type ApiKeyProvider = "openai";
const DEFAULT_PROVIDER: ApiKeyProvider = "openai";

export type ApiKeyMetadata = {
  id: string;
  userId: string;
  provider: ApiKeyProvider;
  keyHint: string;
  baseUrl: string | null;
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToMetadata(row: typeof studioUserApiKey.$inferSelect): ApiKeyMetadata {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as ApiKeyProvider,
    keyHint: row.keyHint,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listUserApiKeys(userId: string): Promise<ApiKeyMetadata[]> {
  const rows = await db
    .select()
    .from(studioUserApiKey)
    .where(eq(studioUserApiKey.userId, userId));
  return rows.map(rowToMetadata);
}

export async function getUserApiKeyMetadata(
  userId: string,
  provider: ApiKeyProvider = DEFAULT_PROVIDER,
): Promise<ApiKeyMetadata | null> {
  const rows = await db
    .select()
    .from(studioUserApiKey)
    .where(and(eq(studioUserApiKey.userId, userId), eq(studioUserApiKey.provider, provider)))
    .limit(1);
  return rows[0] ? rowToMetadata(rows[0]) : null;
}

export async function getDecryptedUserApiKey(
  userId: string,
  provider: ApiKeyProvider = DEFAULT_PROVIDER,
): Promise<{ apiKey: string; baseUrl: string | null; metadata: ApiKeyMetadata } | null> {
  const rows = await db
    .select()
    .from(studioUserApiKey)
    .where(and(eq(studioUserApiKey.userId, userId), eq(studioUserApiKey.provider, provider)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) return null;
  const apiKey = decryptApiKey({
    ciphertext: row.encryptedKey,
    iv: row.iv,
    authTag: row.authTag,
  });
  await db
    .update(studioUserApiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(studioUserApiKey.id, row.id));
  return {
    apiKey,
    baseUrl: row.baseUrl,
    metadata: rowToMetadata(row),
  };
}

export async function upsertUserApiKey(input: {
  userId: string;
  apiKey: string;
  provider?: ApiKeyProvider;
  baseUrl?: string | null;
  enabled?: boolean;
}): Promise<ApiKeyMetadata> {
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const trimmed = input.apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (trimmed.length < 10) throw new Error("apiKey looks invalid");

  const encrypted = encryptApiKey(trimmed);
  const hint = keyHint(trimmed);
  const baseUrl = (input.baseUrl ?? "").trim() || null;

  const existing = await db
    .select()
    .from(studioUserApiKey)
    .where(and(eq(studioUserApiKey.userId, input.userId), eq(studioUserApiKey.provider, provider)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(studioUserApiKey)
      .set({
        encryptedKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyHint: hint,
        baseUrl,
        enabled: input.enabled ?? true,
      })
      .where(eq(studioUserApiKey.id, existing[0].id));
  } else {
    await db.insert(studioUserApiKey).values({
      id: randomUUID(),
      userId: input.userId,
      provider,
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyHint: hint,
      baseUrl,
      enabled: input.enabled ?? true,
    });
  }

  const rows = await db
    .select()
    .from(studioUserApiKey)
    .where(and(eq(studioUserApiKey.userId, input.userId), eq(studioUserApiKey.provider, provider)))
    .limit(1);
  return rowToMetadata(rows[0]);
}

export async function setUserApiKeyEnabled({
  userId,
  provider = DEFAULT_PROVIDER,
  enabled,
}: {
  userId: string;
  provider?: ApiKeyProvider;
  enabled: boolean;
}): Promise<ApiKeyMetadata | null> {
  await db
    .update(studioUserApiKey)
    .set({ enabled })
    .where(and(eq(studioUserApiKey.userId, userId), eq(studioUserApiKey.provider, provider)));
  return getUserApiKeyMetadata(userId, provider);
}

export async function deleteUserApiKey({
  userId,
  provider = DEFAULT_PROVIDER,
}: {
  userId: string;
  provider?: ApiKeyProvider;
}): Promise<boolean> {
  const deleted = await db
    .delete(studioUserApiKey)
    .where(and(eq(studioUserApiKey.userId, userId), eq(studioUserApiKey.provider, provider)))
    .returning({ id: studioUserApiKey.id });
  return deleted.length > 0;
}
