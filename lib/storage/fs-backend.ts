import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import {
  type StorageBackend,
  type UploadBase64Params,
  type UploadBase64Result,
  type FetchResult,
  extensionFromFormat,
  getMimeFromFormat,
  normalizeBase64,
} from "./types";

const PATH_TRAVERSAL_RE = /(^|\/)\.\.(\/|$)/;

export class FsStorageBackend implements StorageBackend {
  readonly name = "fs" as const;
  private readonly root: string;

  constructor(root: string) {
    if (!root) {
      throw new Error("FsStorageBackend requires a non-empty root path");
    }
    this.root = path.resolve(root);
  }

  private resolveAbsolute(storageKey: string): string {
    if (PATH_TRAVERSAL_RE.test(storageKey)) {
      throw new Error(`Invalid storage key: ${storageKey}`);
    }
    const absolute = path.resolve(this.root, storageKey);
    if (!absolute.startsWith(this.root + path.sep) && absolute !== this.root) {
      throw new Error(`Storage key escapes root: ${storageKey}`);
    }
    return absolute;
  }

  async uploadBase64({ base64, userId, kind = "image", format = "png" }: UploadBase64Params): Promise<UploadBase64Result> {
    const cleanBase64 = normalizeBase64(base64);
    const mimeType = getMimeFromFormat(format);
    const buffer = Buffer.from(cleanBase64, "base64");

    const ext = extensionFromFormat(format);
    const timestamp = Date.now();
    const random = randomBytes(6).toString("hex");
    const storageKey = `studio/${kind}/${userId}/${timestamp}_${random}.${ext}`;
    const absolute = this.resolveAbsolute(storageKey);

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);

    return {
      publicUrl: `/api/storage/${storageKey}`,
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  async fetch(storageKey: string): Promise<FetchResult | null> {
    try {
      const absolute = this.resolveAbsolute(storageKey);
      const body = await fs.readFile(absolute);
      const ext = path.extname(absolute).slice(1) || "png";
      return {
        body,
        mimeType: getMimeFromFormat(ext),
        sizeBytes: body.length,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      const absolute = this.resolveAbsolute(storageKey);
      await fs.unlink(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
