import type { StudioTaskType } from "@/lib/studio/domain/types";
import { getPricingRecord, PRICING_QUALITY_DEFAULT } from "@/lib/studio/pricing-service";
import { getUserApiKeyMetadata } from "@/lib/studio/providers/openai/user-api-key-service";

const BYO_PLATFORM_FEE_PER_ITEM = 1;

function toPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampBatch(value: unknown, min: number, max: number, fallback: number) {
  const parsed = toPositiveInteger(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function getArrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function pickQuality(payload: Record<string, unknown>): string {
  const raw = payload.quality;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim().toLowerCase();
  }
  return PRICING_QUALITY_DEFAULT;
}

function pickBatchCount(taskType: StudioTaskType, payload: Record<string, unknown>, fallback: { min: number; max: number; defaultBatch: number }) {
  switch (taskType) {
    case "creation_generate": {
      const fromImageCount = clampBatch(payload.imageCount, fallback.min, fallback.max, fallback.defaultBatch);
      const fromPrompts = getArrayCount(payload.prompts);
      return Math.max(fromImageCount, fromPrompts || 0);
    }
    case "article_generate": {
      const fromImageCount = clampBatch(payload.imageCount, fallback.min, fallback.max, fallback.defaultBatch);
      const fromPrompts = getArrayCount(payload.prompts);
      return Math.max(fromImageCount, fromPrompts || 0);
    }
    case "ppt_generate": {
      const fromPageCount = clampBatch(payload.pageCount, fallback.min, fallback.max, fallback.defaultBatch);
      const fromSlides = getArrayCount(payload.slides);
      return Math.max(fromPageCount, fromSlides || 0);
    }
    default:
      return 1;
  }
}

export async function estimateStudioTaskCredits(
  taskType: StudioTaskType,
  payload: Record<string, unknown>,
  options: { userId?: string } = {},
): Promise<number> {
  const quality = pickQuality(payload);
  const pricing = await getPricingRecord(taskType, quality);
  if (!pricing) return 0;

  const itemCount = pickBatchCount(taskType, payload, {
    min: pricing.minBatchSize,
    max: pricing.maxBatchSize,
    defaultBatch: pricing.defaultBatchSize,
  });

  if (options.userId) {
    const byoKey = await getUserApiKeyMetadata(options.userId, "openai");
    if (byoKey?.enabled) {
      const billable = taskType === "image_decompose" ? 0 : itemCount;
      return Math.max(0, BYO_PLATFORM_FEE_PER_ITEM * billable);
    }
  }

  return Math.max(0, pricing.priceCredits * itemCount);
}
