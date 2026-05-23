import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioAsset } from "@/lib/db/schema";
import { parseJsonRecord, stringifyJsonRecord } from "@/lib/studio/domain/json";
import type { StudioAssetType } from "@/lib/studio/domain/types";

export async function createStudioAsset({
  taskId,
  userId,
  assetType,
  publicUrl,
  storageKey,
  mimeType,
  width,
  height,
  sizeBytes,
  metadata,
}: {
  taskId: string | null;
  userId: string;
  assetType: StudioAssetType;
  publicUrl: string;
  storageKey?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  const id = randomUUID();
  await db.insert(studioAsset).values({
    id,
    taskId: taskId ?? null,
    userId,
    assetType,
    publicUrl,
    storageKey: storageKey ?? null,
    mimeType: mimeType ?? null,
    width: width ?? null,
    height: height ?? null,
    sizeBytes: sizeBytes ?? null,
    metadataJson: stringifyJsonRecord(metadata ?? null),
  });

  return id;
}

export async function listStudioAssetsForUser({
  userId,
  type,
  limit = 40,
}: {
  userId: string;
  type?: StudioAssetType;
  limit?: number;
}) {
  const rows = await db
    .select()
    .from(studioAsset)
    .where(type ? and(eq(studioAsset.userId, userId), eq(studioAsset.assetType, type)) : eq(studioAsset.userId, userId))
    .orderBy(desc(studioAsset.createdAt))
    .limit(Math.max(1, Math.min(200, limit)));

  return rows.map(row => ({
    ...row,
    metadata: parseJsonRecord(row.metadataJson),
  }));
}

export async function listStudioAssetsByTask(taskId: string) {
  const rows = await db
    .select()
    .from(studioAsset)
    .where(eq(studioAsset.taskId, taskId))
    .orderBy(desc(studioAsset.createdAt));

  return rows.map(row => ({
    ...row,
    metadata: parseJsonRecord(row.metadataJson),
  }));
}

export async function listStudioAssetsForAdmin({
  type,
  limit = 80,
}: {
  type?: StudioAssetType;
  limit?: number;
}) {
  const rows = await db
    .select()
    .from(studioAsset)
    .where(type ? eq(studioAsset.assetType, type) : undefined)
    .orderBy(desc(studioAsset.createdAt))
    .limit(Math.max(1, Math.min(300, limit)));

  return rows.map(row => ({
    ...row,
    metadata: parseJsonRecord(row.metadataJson),
  }));
}
