import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";
import {
  type StorageBackend,
  type UploadBase64Params,
  type UploadBase64Result,
  extensionFromFormat,
  getMimeFromFormat,
  normalizeBase64,
} from "./types";

type R2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  publicUrlBase: string;
};

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.includes(".r2.cloudflarestorage.com")) {
    const parts = endpoint.split("/");
    return `${parts[0]}//${parts[2]}`;
  }
  return endpoint;
}

export class R2StorageBackend implements StorageBackend {
  readonly name = "r2" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(config: R2Config) {
    if (!config.accessKeyId || !config.secretAccessKey || !config.endpoint || !config.publicUrlBase) {
      throw new Error("R2StorageBackend requires accessKeyId, secretAccessKey, endpoint, and publicUrlBase");
    }
    this.client = new S3Client({
      region: "auto",
      endpoint: normalizeEndpoint(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.bucket = config.bucket;
    this.publicUrlBase = config.publicUrlBase.replace(/\/+$/, "");
  }

  async uploadBase64({ base64, userId, kind = "image", format = "png" }: UploadBase64Params): Promise<UploadBase64Result> {
    const cleanBase64 = normalizeBase64(base64);
    const mimeType = getMimeFromFormat(format);
    const buffer = Buffer.from(cleanBase64, "base64");

    const ext = extensionFromFormat(format);
    const timestamp = Date.now();
    const random = randomBytes(6).toString("hex");
    const storageKey = `studio/${kind}/${userId}/${timestamp}_${random}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return {
      publicUrl: `${this.publicUrlBase}/${storageKey}`,
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      }),
    );
  }
}

export function buildR2ConfigFromEnv(): R2Config | null {
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY || "";
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  const publicUrlBase = process.env.STORAGE_PUBLIC_URL || "";
  const bucket = process.env.STORAGE_BUCKET_NAME || "starter";

  if (!accessKeyId || !secretAccessKey || !endpoint || !publicUrlBase) {
    return null;
  }

  return { accessKeyId, secretAccessKey, endpoint, bucket, publicUrlBase };
}
