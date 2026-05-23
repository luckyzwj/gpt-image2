import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { listStudioAssetsForUser } from "@/lib/studio/asset-service";
import { getErrorMessage } from "@/lib/error-utils";
import type { StudioAssetType } from "@/lib/studio/domain/types";

export async function GET(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const type = req.nextUrl.searchParams.get("type") as StudioAssetType | null;
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") || "40", 10);
    const assets = await listStudioAssetsForUser({
      userId: access.user.id,
      type: type || undefined,
      limit,
    });

    return NextResponse.json({ assets });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to list assets") }, { status: 500 });
  }
}
