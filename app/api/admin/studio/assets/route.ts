import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getErrorMessage } from "@/lib/error-utils";
import { listStudioAssetsForAdmin } from "@/lib/studio/asset-service";
import type { StudioAssetType } from "@/lib/studio/domain/types";

export async function GET(req: NextRequest) {
  try {
    const access = await getActiveSessionUser(req.headers);
    if (!access.ok || access.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const type = req.nextUrl.searchParams.get("type") as StudioAssetType | null;
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") || "100", 10);

    const assets = await listStudioAssetsForAdmin({
      type: type || undefined,
      limit,
    });

    return NextResponse.json({ assets });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to list admin assets") }, { status: 500 });
  }
}
