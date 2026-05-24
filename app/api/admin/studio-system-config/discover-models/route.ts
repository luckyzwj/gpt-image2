// Admin API: 实时打上游 /v1/models,返回远端的模型 ID 列表。
// 不入库,只是给前端预览;勾选哪些启用、改 displayName/sortOrder,走 /presets PUT。

import { isAdmin } from "@/lib/auth/admin";
import { discoverModels } from "@/lib/studio-gateway/system-config-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAdmin())) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const result = await discoverModels();
    return Response.json(result);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}
