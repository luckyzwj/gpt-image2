// Admin API: 读写 Studio 系统级 OpenAI 配置(平台 apiKey/baseUrl/responsesModel)。
// GET 不会返回明文,只返 hint(末 4 位)和 hasApiKey 标志。

import { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import {
  getSystemConfigPublic,
  updateSystemConfig,
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
  const cfg = await getSystemConfigPublic();
  return Response.json(cfg);
}

export async function PATCH(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    apiKey?: string;
    baseUrl?: string;
    responsesModel?: string;
  };
  await updateSystemConfig({
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
    responsesModel: body.responsesModel,
  });
  const updated = await getSystemConfigPublic();
  return Response.json(updated);
}
