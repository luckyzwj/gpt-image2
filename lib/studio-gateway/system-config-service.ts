// Studio 系统配置服务 — 给 sistine 反代 + admin API 提供统一读写入口。
//
// 缓存策略:30 秒内存缓存。反代每个 OpenAI 请求都需要 apiKey/baseUrl/responsesModel,
// 没缓存的话每次都打一次 DB,延迟敏感。30s 足够大多场景,admin 改完最多等 30s 生效。

import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { studioSystemConfig, studioModelPreset } from "@/lib/db/schema";
import { decryptApiKey, encryptApiKey, buildApiKeyHint } from "./crypto";

const CACHE_TTL_MS = 30_000;

type SystemConfigSecrets = {
  apiKey: string;
  baseUrl: string;
  responsesModel: string;
};

type CacheEntry<T> = { value: T; expiresAt: number };

let systemConfigCache: CacheEntry<SystemConfigSecrets> | null = null;
let enabledModelsCache: CacheEntry<EnabledModel[]> | null = null;

export type EnabledModel = {
  modelId: string;
  displayName: string;
};

export type SystemConfigPublic = {
  baseUrl: string;
  responsesModel: string;
  apiKeyHint: string | null;
  hasApiKey: boolean;
  updatedAt: Date | null;
};

export type ModelPresetRow = {
  id: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
  source: string;
};

function invalidateCache() {
  systemConfigCache = null;
  enabledModelsCache = null;
}

async function loadConfigRow() {
  const rows = await db
    .select()
    .from(studioSystemConfig)
    .where(eq(studioSystemConfig.id, "default"))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSystemConfigPublic(): Promise<SystemConfigPublic> {
  const row = await loadConfigRow();
  if (!row) {
    return {
      baseUrl: "https://api.openai.com/v1",
      responsesModel: "gpt-5.4",
      apiKeyHint: null,
      hasApiKey: false,
      updatedAt: null,
    };
  }
  return {
    baseUrl: row.baseUrl,
    responsesModel: row.responsesModel,
    apiKeyHint: row.apiKeyHint,
    hasApiKey: Boolean(row.apiKeyCiphertext),
    updatedAt: row.updatedAt,
  };
}

// 仅给反代调:解密 apiKey 拿到明文。无 key 时 throw,反代要捕获后返回 502。
export async function getSystemConfigSecrets(): Promise<SystemConfigSecrets> {
  if (systemConfigCache && systemConfigCache.expiresAt > Date.now()) {
    return systemConfigCache.value;
  }
  const row = await loadConfigRow();
  if (!row || !row.apiKeyCiphertext) {
    throw new Error(
      "Studio system OPENAI_API_KEY 未配置。请管理员到 /admin/studio-openai-config 填写。",
    );
  }
  const value: SystemConfigSecrets = {
    apiKey: decryptApiKey(row.apiKeyCiphertext),
    baseUrl: row.baseUrl,
    responsesModel: row.responsesModel,
  };
  systemConfigCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function updateSystemConfig(input: {
  apiKey?: string | null;
  baseUrl?: string;
  responsesModel?: string;
}) {
  const existing = await loadConfigRow();
  const patch: {
    apiKeyCiphertext?: string;
    apiKeyHint?: string;
    baseUrl?: string;
    responsesModel?: string;
  } = {};

  if (input.apiKey && input.apiKey.trim()) {
    patch.apiKeyCiphertext = encryptApiKey(input.apiKey.trim());
    patch.apiKeyHint = buildApiKeyHint(input.apiKey.trim());
  }
  if (input.baseUrl !== undefined) {
    const trimmed = input.baseUrl.trim();
    if (trimmed) patch.baseUrl = trimmed;
  }
  if (input.responsesModel !== undefined) {
    const trimmed = input.responsesModel.trim();
    if (trimmed) patch.responsesModel = trimmed;
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  if (existing) {
    await db
      .update(studioSystemConfig)
      .set(patch)
      .where(eq(studioSystemConfig.id, "default"));
  } else {
    await db.insert(studioSystemConfig).values({
      id: "default",
      apiKeyCiphertext: patch.apiKeyCiphertext ?? null,
      apiKeyHint: patch.apiKeyHint ?? null,
      baseUrl: patch.baseUrl ?? "https://api.openai.com/v1",
      responsesModel: patch.responsesModel ?? "gpt-5.4",
    });
  }
  invalidateCache();
}

export async function discoverModels(): Promise<{
  models: Array<{ modelId: string }>;
  discoveredAt: string;
}> {
  const secrets = await getSystemConfigSecrets();
  const url = `${secrets.baseUrl.replace(/\/$/, "")}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secrets.apiKey}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `discoverModels 上游返回 ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const models = Array.isArray(data.data)
    ? data.data.map((m) => ({ modelId: String(m.id) })).filter((m) => m.modelId)
    : [];
  return { models, discoveredAt: new Date().toISOString() };
}

export async function listModelPresets(): Promise<ModelPresetRow[]> {
  const rows = await db
    .select()
    .from(studioModelPreset)
    .orderBy(studioModelPreset.sortOrder);
  return rows.map((r) => ({
    id: r.id,
    modelId: r.modelId,
    displayName: r.displayName,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    source: r.source,
  }));
}

export async function replaceModelPresets(
  presets: Array<{
    modelId: string;
    displayName: string;
    enabled: boolean;
    sortOrder: number;
    source?: string;
  }>,
) {
  await db.transaction(async (tx) => {
    await tx.delete(studioModelPreset);
    if (presets.length === 0) return;
    await tx.insert(studioModelPreset).values(
      presets.map((p) => ({
        id: randomUUID(),
        modelId: p.modelId.trim(),
        displayName: p.displayName.trim() || p.modelId.trim(),
        enabled: Boolean(p.enabled),
        sortOrder: Number.isFinite(p.sortOrder) ? p.sortOrder : 0,
        source: p.source ?? "manual",
      })),
    );
  });
  invalidateCache();
}

export async function getEnabledImageModels(): Promise<EnabledModel[]> {
  if (enabledModelsCache && enabledModelsCache.expiresAt > Date.now()) {
    return enabledModelsCache.value;
  }
  const rows = await db
    .select({
      modelId: studioModelPreset.modelId,
      displayName: studioModelPreset.displayName,
    })
    .from(studioModelPreset)
    .where(eq(studioModelPreset.enabled, true))
    .orderBy(studioModelPreset.sortOrder);
  const value = rows.map((r) => ({
    modelId: r.modelId,
    displayName: r.displayName,
  }));
  enabledModelsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}
