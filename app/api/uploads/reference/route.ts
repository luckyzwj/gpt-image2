import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getErrorMessage } from "@/lib/error-utils";
import { getStorage } from "@/lib/storage";
import { createStudioAsset, listStudioAssetsForUser } from "@/lib/studio/asset-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_REQUEST = 12;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_PREFIX = "image/";
const ALLOWED_FORMATS = new Set(["png", "jpeg", "jpg", "webp"]);

function formatFromMime(mime: string): "png" | "jpeg" | "webp" {
  const sub = mime.split("/")[1]?.toLowerCase() ?? "";
  if (sub === "jpg" || sub === "jpeg") return "jpeg";
  if (sub === "webp") return "webp";
  return "png";
}

function getImageDimensions(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buffer[0] === 0x89 && buffer[1] === 0x50) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if ((mime === "image/jpeg" || mime === "image/jpg") && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
    if (mime === "image/webp" && buffer.toString("utf8", 0, 4) === "RIFF") {
      return { width: buffer.readUInt16LE(26) + 1, height: buffer.readUInt16LE(28) + 1 };
    }
  } catch {
    // fall through
  }
  return null;
}

type UploadResultItem = {
  ok: true;
  assetId: string;
  publicUrl: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  filename: string;
} | {
  ok: false;
  filename: string;
  error: string;
};

export async function POST(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "Content-Type must be multipart/form-data" }, { status: 400 });
    }

    const formData = await req.formData();
    const fileEntries = formData.getAll("files").filter((v): v is File => v instanceof File);
    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "No files provided (use field name 'files')" }, { status: 400 });
    }
    if (fileEntries.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many files (max ${MAX_FILES_PER_REQUEST} per request)` },
        { status: 400 },
      );
    }

    const storage = getStorage();
    const results: UploadResultItem[] = [];

    for (const file of fileEntries) {
      try {
        if (!file.type.startsWith(ALLOWED_MIME_PREFIX)) {
          results.push({ ok: false, filename: file.name, error: "Only image/* uploads are allowed" });
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          results.push({ ok: false, filename: file.name, error: `File exceeds ${MAX_FILE_BYTES} bytes` });
          continue;
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const format = formatFromMime(file.type);
        if (!ALLOWED_FORMATS.has(format)) {
          results.push({ ok: false, filename: file.name, error: `Unsupported format ${format}` });
          continue;
        }

        const dims = getImageDimensions(buffer, file.type);

        const uploaded = await storage.uploadBase64({
          base64: buffer.toString("base64"),
          userId: access.user.id,
          kind: "reference",
          format,
        });

        const assetId = await createStudioAsset({
          taskId: null,
          userId: access.user.id,
          assetType: "reference",
          publicUrl: uploaded.publicUrl,
          storageKey: uploaded.storageKey,
          mimeType: uploaded.mimeType,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          sizeBytes: uploaded.sizeBytes,
          metadata: { originalFilename: file.name },
        });

        results.push({
          ok: true,
          assetId,
          publicUrl: uploaded.publicUrl,
          storageKey: uploaded.storageKey,
          mimeType: uploaded.mimeType,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          sizeBytes: uploaded.sizeBytes,
          filename: file.name,
        });
      } catch (err) {
        results.push({
          ok: false,
          filename: file.name,
          error: getErrorMessage(err, "Failed to store file"),
        });
      }
    }

    const succeeded = results.filter((r): r is Extract<UploadResultItem, { ok: true }> => r.ok);
    const failed = results.filter((r): r is Extract<UploadResultItem, { ok: false }> => !r.ok);

    return NextResponse.json({
      assetIds: succeeded.map(r => r.assetId),
      assets: succeeded.map(({ ok: _ok, ...rest }) => rest),
      errors: failed,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to upload references") },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") || "40", 10);
    const assets = await listStudioAssetsForUser({
      userId: access.user.id,
      type: "reference",
      limit,
    });
    return NextResponse.json({ assets });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list reference assets") },
      { status: 500 },
    );
  }
}
