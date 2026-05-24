// Admin API: 可用图像模型清单 CRUD。
// GET 返回全部 preset 行;PUT 全量替换(简单粗暴,reset 后插入所有传进来的行)。

import { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import {
  listModelPresets,
  replaceModelPresets,
} from "@/lib/studio-gateway/system-config-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  if (!(await isAdmin())) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const presets = await listModelPresets();
  return Response.json({ presets });
}

export async function PUT(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    presets?: Array<{
      modelId: string;
      displayName?: string;
      enabled?: boolean;
      sortOrder?: number;
      source?: string;
    }>;
  };
  if (!body.presets || !Array.isArray(body.presets)) {
    return new Response(JSON.stringify({ error: "presets[] required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  await replaceModelPresets(
    body.presets.map((p) => ({
      modelId: String(p.modelId || "").trim(),
      displayName: String(p.displayName || p.modelId || "").trim(),
      enabled: Boolean(p.enabled),
      sortOrder: Number(p.sortOrder ?? 0),
      source: p.source,
    })).filter((p) => p.modelId),
  );
  const presets = await listModelPresets();
  return Response.json({ presets });
}
