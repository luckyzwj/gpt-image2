import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const access = await getActiveSessionUser(req.headers);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { path: pathSegments } = await context.params;
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  for (const segment of pathSegments) {
    if (segment === "" || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("/")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
  }

  const storageKey = pathSegments.join("/");

  const ownerSegment = pathSegments[2];
  const isAdmin = access.user.role === "admin";
  if (!isAdmin && ownerSegment !== access.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storage = getStorage();
  if (!storage.fetch) {
    return NextResponse.json(
      { error: `Storage backend '${storage.name}' does not support fetch` },
      { status: 501 },
    );
  }

  const result = await storage.fetch(storageKey);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(result.body), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.sizeBytes),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
