import { FsStorageBackend } from "./fs-backend";
import { R2StorageBackend, buildR2ConfigFromEnv } from "./r2-backend";
import { DataUrlStorageBackend } from "./data-url-backend";
import type { StorageBackend } from "./types";

export type { StorageBackend, UploadBase64Params, UploadBase64Result, FetchResult } from "./types";

let cached: StorageBackend | null = null;
let cachedKey: string | null = null;

function selectBackend(): StorageBackend {
  const backend = (process.env.STORAGE_BACKEND || "").toLowerCase();

  if (backend === "fs") {
    const root = process.env.STORAGE_FS_ROOT;
    if (!root) {
      console.warn("[storage] STORAGE_BACKEND=fs but STORAGE_FS_ROOT is empty; falling back to data-url");
      return new DataUrlStorageBackend();
    }
    return new FsStorageBackend(root);
  }

  if (backend === "r2") {
    const r2Config = buildR2ConfigFromEnv();
    if (!r2Config) {
      console.warn("[storage] STORAGE_BACKEND=r2 but R2 env vars incomplete; falling back to data-url");
      return new DataUrlStorageBackend();
    }
    return new R2StorageBackend(r2Config);
  }

  if (!backend) {
    const r2Config = buildR2ConfigFromEnv();
    if (r2Config) {
      return new R2StorageBackend(r2Config);
    }
    return new DataUrlStorageBackend();
  }

  console.warn(`[storage] Unknown STORAGE_BACKEND=${backend}; falling back to data-url`);
  return new DataUrlStorageBackend();
}

export function getStorage(): StorageBackend {
  const envKey = [
    process.env.STORAGE_BACKEND,
    process.env.STORAGE_FS_ROOT,
    process.env.STORAGE_ACCESS_KEY_ID,
    process.env.STORAGE_SECRET_ACCESS_KEY,
    process.env.STORAGE_ENDPOINT,
    process.env.STORAGE_PUBLIC_URL,
    process.env.STORAGE_BUCKET_NAME,
  ].join("|");

  if (!cached || cachedKey !== envKey) {
    cached = selectBackend();
    cachedKey = envKey;
  }
  return cached;
}

export function resetStorageCache() {
  cached = null;
  cachedKey = null;
}
