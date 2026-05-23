export type AssetKind = "image" | "video" | "reference";

export type AssetFormat = "png" | "jpeg" | "jpg" | "webp" | "mp4" | "webm" | "mov";

export type UploadBase64Params = {
  base64: string;
  userId: string;
  kind?: AssetKind;
  format?: AssetFormat;
};

export type UploadBase64Result = {
  publicUrl: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

export type FetchResult = {
  body: Buffer;
  mimeType: string;
  sizeBytes: number;
};

export interface StorageBackend {
  readonly name: "fs" | "r2" | "data-url";
  uploadBase64(params: UploadBase64Params): Promise<UploadBase64Result>;
  fetch?(storageKey: string): Promise<FetchResult | null>;
  delete?(storageKey: string): Promise<void>;
}

export function getMimeFromFormat(format: string): string {
  const normalized = format.toLowerCase();
  switch (normalized) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "png":
    default:
      return "image/png";
  }
}

export function normalizeBase64(value: string): string {
  return String(value).replace(/^data:[^;]+;base64,/, "").trim();
}

export function extensionFromFormat(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized === "jpeg") return "jpg";
  return normalized;
}
