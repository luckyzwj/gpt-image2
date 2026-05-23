import { randomUUID } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  studioTask,
  studioTierConfig,
  studioUserQuotaOverride,
  user,
} from "@/lib/db/schema";

export const TIER_KEY_DEFAULT = "free";

const PLAN_TO_TIER: Record<string, string> = {
  free: "free",
  starter_monthly: "starter",
  starter_yearly: "starter",
  pro_monthly: "pro",
  pro_yearly: "pro",
};

export type TierConfigRecord = {
  id: string;
  tierKey: string;
  displayName: string;
  dailyTaskLimit: number;
  dailyCreditLimit: number;
  concurrentTaskLimit: number;
  maxPromptTemplates: number;
  enabled: boolean;
  notes: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UserQuotaOverrideRecord = {
  id: string;
  userId: string;
  dailyTaskLimit: number | null;
  dailyCreditLimit: number | null;
  concurrentTaskLimit: number | null;
  maxPromptTemplates: number | null;
  reason: string | null;
  expiresAt: Date | null;
  grantedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EffectiveQuota = {
  tierKey: string;
  dailyTaskLimit: number;
  dailyCreditLimit: number;
  concurrentTaskLimit: number;
  maxPromptTemplates: number;
  source: {
    tier: TierConfigRecord;
    override: UserQuotaOverrideRecord | null;
  };
};

export type QuotaUsage = {
  tasksToday: number;
  creditsReservedToday: number;
  concurrentTasks: number;
};

export type QuotaCheckResult =
  | { ok: true; effective: EffectiveQuota; usage: QuotaUsage }
  | { ok: false; reason: string; effective: EffectiveQuota; usage: QuotaUsage };

const TIER_DEFAULTS: Array<Omit<TierConfigRecord, "id" | "createdAt" | "updatedAt" | "updatedBy" | "notes">> = [
  {
    tierKey: "free",
    displayName: "Free",
    dailyTaskLimit: 20,
    dailyCreditLimit: 300,
    concurrentTaskLimit: 1,
    maxPromptTemplates: 10,
    enabled: true,
  },
  {
    tierKey: "starter",
    displayName: "Starter",
    dailyTaskLimit: 100,
    dailyCreditLimit: 2000,
    concurrentTaskLimit: 3,
    maxPromptTemplates: 50,
    enabled: true,
  },
  {
    tierKey: "pro",
    displayName: "Pro",
    dailyTaskLimit: 500,
    dailyCreditLimit: 20000,
    concurrentTaskLimit: 8,
    maxPromptTemplates: 200,
    enabled: true,
  },
];

const CACHE_TTL_MS = 30_000;
type TierCache = { expiresAt: number; byKey: Map<string, TierConfigRecord> };
let tierCache: TierCache | null = null;

function tierRowToRecord(row: typeof studioTierConfig.$inferSelect): TierConfigRecord {
  return {
    id: row.id,
    tierKey: row.tierKey,
    displayName: row.displayName,
    dailyTaskLimit: row.dailyTaskLimit,
    dailyCreditLimit: row.dailyCreditLimit,
    concurrentTaskLimit: row.concurrentTaskLimit,
    maxPromptTemplates: row.maxPromptTemplates,
    enabled: row.enabled,
    notes: row.notes,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function overrideRowToRecord(
  row: typeof studioUserQuotaOverride.$inferSelect,
): UserQuotaOverrideRecord {
  return {
    id: row.id,
    userId: row.userId,
    dailyTaskLimit: row.dailyTaskLimit,
    dailyCreditLimit: row.dailyCreditLimit,
    concurrentTaskLimit: row.concurrentTaskLimit,
    maxPromptTemplates: row.maxPromptTemplates,
    reason: row.reason,
    expiresAt: row.expiresAt,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildDefaultTierRecord(tierKey: string): TierConfigRecord {
  const match = TIER_DEFAULTS.find(t => t.tierKey === tierKey) || TIER_DEFAULTS[0];
  const now = new Date();
  return {
    ...match,
    id: `default::${tierKey}`,
    notes: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function getTierMap(): Promise<Map<string, TierConfigRecord>> {
  const now = Date.now();
  if (tierCache && tierCache.expiresAt > now) {
    return tierCache.byKey;
  }
  try {
    const rows = await db.select().from(studioTierConfig);
    const map = new Map<string, TierConfigRecord>();
    for (const row of rows) {
      map.set(row.tierKey, tierRowToRecord(row));
    }
    tierCache = { expiresAt: now + CACHE_TTL_MS, byKey: map };
    return map;
  } catch (error) {
    console.warn("[quota-service] tier read failed, using defaults:", error);
    return new Map(TIER_DEFAULTS.map(t => [t.tierKey, buildDefaultTierRecord(t.tierKey)] as const));
  }
}

export function invalidateQuotaCache() {
  tierCache = null;
}

export function planKeyToTierKey(planKey: string | null | undefined): string {
  if (!planKey) return TIER_KEY_DEFAULT;
  return PLAN_TO_TIER[planKey] || TIER_KEY_DEFAULT;
}

export async function getTierConfig(tierKey: string): Promise<TierConfigRecord> {
  const map = await getTierMap();
  const found = map.get(tierKey);
  if (found && found.enabled) return found;
  const fallback = map.get(TIER_KEY_DEFAULT);
  if (fallback) return fallback;
  return buildDefaultTierRecord(tierKey);
}

export async function listTierConfigs(): Promise<TierConfigRecord[]> {
  const map = await getTierMap();
  if (map.size === 0) {
    return TIER_DEFAULTS.map(t => buildDefaultTierRecord(t.tierKey));
  }
  return Array.from(map.values()).sort((a, b) => a.tierKey.localeCompare(b.tierKey));
}

export async function upsertTierConfig(input: {
  tierKey: string;
  displayName?: string;
  dailyTaskLimit: number;
  dailyCreditLimit: number;
  concurrentTaskLimit: number;
  maxPromptTemplates: number;
  enabled?: boolean;
  notes?: string | null;
  updatedBy?: string;
}): Promise<TierConfigRecord> {
  if (!input.tierKey || !/^[a-z0-9_-]{1,48}$/i.test(input.tierKey)) {
    throw new Error("Invalid tier key");
  }
  if (input.dailyTaskLimit < 0) throw new Error("dailyTaskLimit must be >= 0");
  if (input.dailyCreditLimit < 0) throw new Error("dailyCreditLimit must be >= 0");
  if (input.concurrentTaskLimit < 1) throw new Error("concurrentTaskLimit must be >= 1");
  if (input.maxPromptTemplates < 0) throw new Error("maxPromptTemplates must be >= 0");

  const existing = await db
    .select()
    .from(studioTierConfig)
    .where(eq(studioTierConfig.tierKey, input.tierKey))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(studioTierConfig)
      .set({
        displayName: input.displayName ?? existing[0].displayName,
        dailyTaskLimit: input.dailyTaskLimit,
        dailyCreditLimit: input.dailyCreditLimit,
        concurrentTaskLimit: input.concurrentTaskLimit,
        maxPromptTemplates: input.maxPromptTemplates,
        enabled: input.enabled ?? true,
        notes: input.notes ?? null,
        updatedBy: input.updatedBy ?? null,
      })
      .where(eq(studioTierConfig.id, existing[0].id));
  } else {
    await db.insert(studioTierConfig).values({
      id: randomUUID(),
      tierKey: input.tierKey,
      displayName: input.displayName || input.tierKey,
      dailyTaskLimit: input.dailyTaskLimit,
      dailyCreditLimit: input.dailyCreditLimit,
      concurrentTaskLimit: input.concurrentTaskLimit,
      maxPromptTemplates: input.maxPromptTemplates,
      enabled: input.enabled ?? true,
      notes: input.notes ?? null,
      updatedBy: input.updatedBy ?? null,
    });
  }

  invalidateQuotaCache();

  const rows = await db
    .select()
    .from(studioTierConfig)
    .where(eq(studioTierConfig.tierKey, input.tierKey))
    .limit(1);
  return tierRowToRecord(rows[0]);
}

export async function seedTierDefaults({ overwrite = false }: { overwrite?: boolean } = {}) {
  const existing = await db.select().from(studioTierConfig);
  const byKey = new Map(existing.map(r => [r.tierKey, r] as const));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const defaults of TIER_DEFAULTS) {
    if (byKey.has(defaults.tierKey)) {
      if (!overwrite) {
        skipped += 1;
        continue;
      }
      await db
        .update(studioTierConfig)
        .set({
          displayName: defaults.displayName,
          dailyTaskLimit: defaults.dailyTaskLimit,
          dailyCreditLimit: defaults.dailyCreditLimit,
          concurrentTaskLimit: defaults.concurrentTaskLimit,
          maxPromptTemplates: defaults.maxPromptTemplates,
          enabled: defaults.enabled,
        })
        .where(eq(studioTierConfig.id, byKey.get(defaults.tierKey)!.id));
      updated += 1;
    } else {
      await db.insert(studioTierConfig).values({
        id: randomUUID(),
        ...defaults,
        notes: null,
        updatedBy: "system_seed",
      });
      inserted += 1;
    }
  }

  invalidateQuotaCache();
  return { inserted, updated, skipped };
}

export async function getUserQuotaOverride(userId: string): Promise<UserQuotaOverrideRecord | null> {
  const rows = await db
    .select()
    .from(studioUserQuotaOverride)
    .where(eq(studioUserQuotaOverride.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;

  const record = overrideRowToRecord(rows[0]);
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return record;
}

export async function upsertUserQuotaOverride(input: {
  userId: string;
  dailyTaskLimit?: number | null;
  dailyCreditLimit?: number | null;
  concurrentTaskLimit?: number | null;
  maxPromptTemplates?: number | null;
  reason?: string | null;
  expiresAt?: Date | null;
  grantedBy?: string;
}): Promise<UserQuotaOverrideRecord> {
  const existing = await db
    .select()
    .from(studioUserQuotaOverride)
    .where(eq(studioUserQuotaOverride.userId, input.userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(studioUserQuotaOverride)
      .set({
        dailyTaskLimit: input.dailyTaskLimit ?? null,
        dailyCreditLimit: input.dailyCreditLimit ?? null,
        concurrentTaskLimit: input.concurrentTaskLimit ?? null,
        maxPromptTemplates: input.maxPromptTemplates ?? null,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ?? null,
        grantedBy: input.grantedBy ?? null,
      })
      .where(eq(studioUserQuotaOverride.id, existing[0].id));
  } else {
    await db.insert(studioUserQuotaOverride).values({
      id: randomUUID(),
      userId: input.userId,
      dailyTaskLimit: input.dailyTaskLimit ?? null,
      dailyCreditLimit: input.dailyCreditLimit ?? null,
      concurrentTaskLimit: input.concurrentTaskLimit ?? null,
      maxPromptTemplates: input.maxPromptTemplates ?? null,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ?? null,
      grantedBy: input.grantedBy ?? null,
    });
  }

  const rows = await db
    .select()
    .from(studioUserQuotaOverride)
    .where(eq(studioUserQuotaOverride.userId, input.userId))
    .limit(1);
  return overrideRowToRecord(rows[0]);
}

export async function deleteUserQuotaOverride(userId: string): Promise<boolean> {
  const deleted = await db
    .delete(studioUserQuotaOverride)
    .where(eq(studioUserQuotaOverride.userId, userId))
    .returning({ id: studioUserQuotaOverride.id });
  return deleted.length > 0;
}

export async function getEffectiveQuota(userId: string): Promise<EffectiveQuota> {
  const userRows = await db
    .select({ planKey: user.planKey })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const tierKey = planKeyToTierKey(userRows[0]?.planKey);
  const tier = await getTierConfig(tierKey);
  const override = await getUserQuotaOverride(userId);

  const pick = (overrideValue: number | null, tierValue: number) =>
    overrideValue == null || overrideValue < 0 ? tierValue : overrideValue;

  return {
    tierKey,
    dailyTaskLimit: pick(override?.dailyTaskLimit ?? null, tier.dailyTaskLimit),
    dailyCreditLimit: pick(override?.dailyCreditLimit ?? null, tier.dailyCreditLimit),
    concurrentTaskLimit: pick(override?.concurrentTaskLimit ?? null, tier.concurrentTaskLimit),
    maxPromptTemplates: pick(override?.maxPromptTemplates ?? null, tier.maxPromptTemplates),
    source: { tier, override },
  };
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getQuotaUsage(userId: string): Promise<QuotaUsage> {
  const since = startOfTodayUtc();
  const rows = await db
    .select({
      tasksToday: sql<number>`count(*)`,
      creditsReservedToday: sql<number>`coalesce(sum(${studioTask.creditsReserved}), 0)`,
      concurrentTasks: sql<number>`count(*) filter (where ${studioTask.status} = 'running')`,
    })
    .from(studioTask)
    .where(and(eq(studioTask.userId, userId), gte(studioTask.createdAt, since)));

  const row = rows[0];
  return {
    tasksToday: Number(row?.tasksToday || 0),
    creditsReservedToday: Number(row?.creditsReservedToday || 0),
    concurrentTasks: Number(row?.concurrentTasks || 0),
  };
}

export async function assertQuotaAllowsTask({
  userId,
  estimatedCredits,
}: {
  userId: string;
  estimatedCredits: number;
}): Promise<QuotaCheckResult> {
  const effective = await getEffectiveQuota(userId);
  const usage = await getQuotaUsage(userId);

  if (effective.dailyTaskLimit > 0 && usage.tasksToday + 1 > effective.dailyTaskLimit) {
    return {
      ok: false,
      reason: `Daily task limit reached (${usage.tasksToday}/${effective.dailyTaskLimit}). Upgrade or wait until tomorrow.`,
      effective,
      usage,
    };
  }
  if (
    effective.dailyCreditLimit > 0 &&
    usage.creditsReservedToday + estimatedCredits > effective.dailyCreditLimit
  ) {
    return {
      ok: false,
      reason: `Daily credit limit reached (${usage.creditsReservedToday}+${estimatedCredits} > ${effective.dailyCreditLimit}). Upgrade or wait until tomorrow.`,
      effective,
      usage,
    };
  }
  if (effective.concurrentTaskLimit > 0 && usage.concurrentTasks >= effective.concurrentTaskLimit) {
    return {
      ok: false,
      reason: `Concurrent task limit reached (${usage.concurrentTasks}/${effective.concurrentTaskLimit}). Wait for an existing task to finish.`,
      effective,
      usage,
    };
  }

  return { ok: true, effective, usage };
}
