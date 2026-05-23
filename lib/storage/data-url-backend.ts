import {
  type StorageBackend,
  type UploadBase64Params,
  type UploadBase64Result,
  getMimeFromFormat,
  normalizeBase64,
} from "./types";

export class DataUrlStorageBackend implements StorageBackend {
  readonly name = "data-url" as const;

  async uploadBase64({ base64, format = "png" }: UploadBase64Params): Promise<UploadBase64Result> {
    const cleanBase64 = normalizeBase64(base64);
    const mimeType = getMimeFromFormat(format);
    const buffer = Buffer.from(cleanBase64, "base64");

    return {
      publicUrl: `data:${mimeType};base64,${cleanBase64}`,
      storageKey: "",
      mimeType,
      sizeBytes: buffer.length,
    };
  }
}
