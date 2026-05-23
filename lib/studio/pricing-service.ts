import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioPricingConfig } from "@/lib/db/schema";
import { STUDIO_TASK_TYPES, type StudioTaskType } from "@/lib/studio/domain/types";

export const PRICING_QUALITY_DEFAULT = "default";

export type PricingRecord = {
  id: string;
  taskType: StudioTaskType;
  quality: string;
  priceCredits: number;
  minBatchSize: number;
  maxBatchSize: number;
  defaultBatchSize: number;
  notes: string | null;
  enabled: boolean;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Built-in defaults — used to seed an empty pricing_config table and as a fallback
// when a row is missing or the DB read fails. Keep these aligned with the constants
// that used to live directly in cost-policy.ts.
export const PRICING_DEFAULTS: Array<{
  taskType: StudioTaskType;
  quality: string;
  priceCredits: number;
  minBatchSize: number;
  maxBatchSize: number;
  defaultBatchSize: number;
  notes?: string;
}> = [
  {
    taskType: "image_single",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 20,
    minBatchSize: 1,
    maxBatchSize: 1,
    defaultBatchSize: 1,
    notes: "Single image generation — flat fee",
  },
  {
    taskType: "image_decompose",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 5,
    minBatchSize: 1,
    maxBatchSize: 1,
    defaultBatchSize: 1,
    notes: "Image-to-text structured analysis",
  },
  {
    taskType: "creation_plan",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 0,
    minBatchSize: 1,
    maxBatchSize: 1,
    defaultBatchSize: 1,
    notes: "Template-only planning step, refunded on settle",
  },
  {
    taskType: "creation_generate",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 20,
    minBatchSize: 1,
    maxBatchSize: 12,
    defaultBatchSize: 4,
    notes: "Per-image credit price for creation sets",
  },
  {
    taskType: "article_plan",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 10,
    minBatchSize: 1,
    maxBatchSize: 1,
    defaultBatchSize: 1,
    notes: "Article slot planning — flat reservation, refunded on settle",
  },
  {
    taskType: "article_generate",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 20,
    minBatchSize: 1,
    maxBatchSize: 20,
    defaultBatchSize: 4,
    notes: "Per-image credit price for article illustrations",
  },
  {
    taskType: "ppt_plan",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 30,
    minBatchSize: 1,
    maxBatchSize: 1,
    defaultBatchSize: 1,
    notes: "Deck planning — flat reservation, refunded on settle",
  },
  {
    taskType: "ppt_generate",
    quality: PRICING_QUALITY_DEFAULT,
    priceCredits: 20,
    minBatchSize: 1,
    maxBatchSize: 20,
    defaultBatchSize: 8,
    notes: "Per-slide credit price for PPT decks",
  },
];

const STUDIO_TASK_TYPE_SET = new Set<string>(STUDIO_TASK_TYPES);

function rowToRecord(row: typeof studioPricingConfig.$inferSelect): PricingRecord {
  return {
    id: row.id,
    taskType: row.taskType as StudioTaskType,
    quality: row.quality,
    priceCredits: row.priceCredits,
    minBatchSize: row.minBatchSize,
    maxBatchSize: row.maxBatchSize,
    defaultBatchSize: row.defaultBatchSize,
    notes: row.notes,
    enabled: row.enabled,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const CACHE_TTL_MS = 30_000;
type PricingCache = {
  expiresAt: number;
  map: Map<string, PricingRecord>;
};
let pricingCache: PricingCache | null = null;

function cacheKey(taskType: string, quality: string) {
  return `${taskType}::${quality}`;
}

async function loadAllPricingFromDb(): Promise<PricingRecord[]> {
  const rows = await db
    .select()
    .from(studioPricingConfig)
    .orderBy(asc(studioPricingConfig.taskType), asc(studioPricingConfig.quality));
  return rows.map(rowToRecord);
}

async function getCachedPricingMap(): Promise<Map<string, PricingRecord>> {
  const now = Date.now();
  if (pricingCache && pricingCache.expiresAt > now) {
    return pricingCache.map;
  }

  const records = await loadAllPricingFromDb();
  const map = new Map<string, PricingRecord>();
  for (const record of records) {
    map.set(cacheKey(record.taskType, record.quality), record);
  }
  pricingCache = { expiresAt: now + CACHE_TTL_MS, map };
  return map;
}

export function invalidatePricingCache() {
  pricingCache = null;
}

function fallbackPriceFor(taskType: StudioTaskType, quality: string): PricingRecord | null {
  const match =
    PRICING_DEFAULTS.find(d => d.taskType === taskType && d.quality === quality) ||
    PRICING_DEFAULTS.find(d => d.taskType === taskType && d.quality === PRICING_QUALITY_DEFAULT);
  if (!match) return null;
  const now = new Date();
  return {
    id: `default::${match.taskType}::${match.quality}`,
    taskType: match.taskType,
    quality: match.quality,
    priceCredits: match.priceCredits,
    minBatchSize: match.minBatchSize,
    maxBatchSize: match.maxBatchSize,
    defaultBatchSize: match.defaultBatchSize,
    notes: match.notes ?? null,
    enabled: true,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getPricingRecord(
  taskType: StudioTaskType,
  quality: string = PRICING_QUALITY_DEFAULT,
): Promise<PricingRecord | null> {
  try {
    const map = await getCachedPricingMap();
    const exact = map.get(cacheKey(taskType, quality));
    if (exact && exact.enabled) return exact;
    const fallback = map.get(cacheKey(taskType, PRICING_QUALITY_DEFAULT));
    if (fallback && fallback.enabled) return fallback;
  } catch (error) {
    console.warn("[pricing-service] DB read failed, falling back to defaults:", error);
  }
  return fallbackPriceFor(taskType, quality);
}

export async function listPricingRecords(): Promise<PricingRecord[]> {
  try {
    const map = await getCachedPricingMap();
    if (map.size > 0) {
      return Array.from(map.values()).sort((a, b) => a.taskType.localeCompare(b.taskType));
    }
  } catch (error) {
    console.warn("[pricing-service] listPricingRecords DB read failed:", error);
  }
  return PRICING_DEFAULTS.map(d => fallbackPriceFor(d.taskType, d.quality)!).filter(Boolean);
}

export async function upsertPricingRecord(input: {
  taskType: StudioTaskType;
  quality?: string;
  priceCredits: number;
  minBatchSize?: number;
  maxBatchSize?: number;
  defaultBatchSize?: number;
  notes?: string | null;
  enabled?: boolean;
  updatedBy?: string;
}): Promise<PricingRecord> {
  if (!STUDIO_TASK_TYPE_SET.has(input.taskType)) {
    throw new Error(`Unknown task type: ${input.taskType}`);
  }
  if (!Number.isFinite(input.priceCredits) || input.priceCredits < 0) {
    throw new Error("priceCredits must be a non-negative integer");
  }
  const quality = (input.quality || PRICING_QUALITY_DEFAULT).trim() || PRICING_QUALITY_DEFAULT;
  const min = input.minBatchSize ?? 1;
  const max = input.maxBatchSize ?? Math.max(min, 1);
  const def = input.defaultBatchSize ?? Math.min(Math.max(input.defaultBatchSize ?? min, min), max);

  if (min < 1) throw new Error("minBatchSize must be >= 1");
  if (max < min) throw new Error("maxBatchSize must be >= minBatchSize");
  if (def < min || def > max) throw new Error("defaultBatchSize must be within [min, max]");

  const existingRows = await db
    .select()
    .from(studioPricingConfig)
    .where(and(eq(studioPricingConfig.taskType, input.taskType), eq(studioPricingConfig.quality, quality)))
    .limit(1);

  if (existingRows.length > 0) {
    await db
      .update(studioPricingConfig)
      .set({
        priceCredits: Math.floor(input.priceCredits),
        minBatchSize: min,
        maxBatchSize: max,
        defaultBatchSize: def,
        notes: input.notes ?? null,
        enabled: input.enabled ?? true,
        updatedBy: input.updatedBy ?? null,
      })
      .where(eq(studioPricingConfig.id, existingRows[0].id));
  } else {
    await db.insert(studioPricingConfig).values({
      id: randomUUID(),
      taskType: input.taskType,
      quality,
      priceCredits: Math.floor(input.priceCredits),
      minBatchSize: min,
      maxBatchSize: max,
      defaultBatchSize: def,
      notes: input.notes ?? null,
      enabled: input.enabled ?? true,
      updatedBy: input.updatedBy ?? null,
    });
  }

  invalidatePricingCache();

  const rows = await db
    .select()
    .from(studioPricingConfig)
    .where(and(eq(studioPricingConfig.taskType, input.taskType), eq(studioPricingConfig.quality, quality)))
    .limit(1);
  return rowToRecord(rows[0]);
}

export async function seedPricingDefaults({ overwrite = false }: { overwrite?: boolean } = {}) {
  const existing = await loadAllPricingFromDb();
  const existingByKey = new Map(existing.map(r => [cacheKey(r.taskType, r.quality), r] as const));

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const defaults of PRICING_DEFAULTS) {
    const key = cacheKey(defaults.taskType, defaults.quality);
    if (existingByKey.has(key)) {
      if (!overwrite) {
        skipped += 1;
        continue;
      }
      await db
        .update(studioPricingConfig)
        .set({
          priceCredits: defaults.priceCredits,
          minBatchSize: defaults.minBatchSize,
          maxBatchSize: defaults.maxBatchSize,
          defaultBatchSize: defaults.defaultBatchSize,
          notes: defaults.notes ?? null,
          enabled: true,
        })
        .where(eq(studioPricingConfig.id, existingByKey.get(key)!.id));
      updated += 1;
    } else {
      await db.insert(studioPricingConfig).values({
        id: randomUUID(),
        taskType: defaults.taskType,
        quality: defaults.quality,
        priceCredits: defaults.priceCredits,
        minBatchSize: defaults.minBatchSize,
        maxBatchSize: defaults.maxBatchSize,
        defaultBatchSize: defaults.defaultBatchSize,
        notes: defaults.notes ?? null,
        enabled: true,
        updatedBy: "system_seed",
      });
      inserted += 1;
    }
  }

  invalidatePricingCache();
  return { inserted, updated, skipped };
}
