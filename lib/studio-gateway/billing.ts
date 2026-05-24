// Studio gateway billing — credit cost table per aEboli route.
//
// Why a hard-coded table here instead of "ask aEboli for the price":
//   aEboli is stateless about billing; sistine owns credits. We need to know
//   the cost BEFORE we proxy so we can refuse on insufficient balance. If
//   aEboli adds a new billable route, add it here.

export type StudioCostKey = {
  method: string;
  pathname: string; // exact match after /studio is stripped
};

// Costs are in credits. Keep these in sync with the user-facing pricing page.
// 路径列表对齐 aEboli worker 真实路由(见 cloudflare-pages-worker.mjs 路由表):
//   - 旧表的 /api/image/generate / /api/image/decompose / /api/article/generate
//     这 3 条路径 worker 端不存在,永远不会命中(漏配)
//   - worker 真正打 OpenAI 的 11 条路径全部列入,确保所有出 OpenAI 流量都走积分扣费
const COST_TABLE: Array<{ method: string; match: (p: string) => boolean; cost: number; reason: string }> = [
  { method: "POST", match: (p) => p === "/api/generate",                     cost: 20, reason: "studio_image_generate" },
  { method: "POST", match: (p) => p === "/api/creation/generate",            cost: 50, reason: "studio_creation_generate" },
  { method: "POST", match: (p) => p === "/api/portrait/generate",            cost: 30, reason: "studio_portrait_generate" },
  { method: "POST", match: (p) => p === "/api/creation/logo-batch",          cost: 20, reason: "studio_creation_logo_batch" },
  { method: "POST", match: (p) => p === "/api/portrait/reference/analyze",   cost: 5,  reason: "studio_portrait_reference_analyze" },
  { method: "POST", match: (p) => p === "/api/portrait/plan",                cost: 10, reason: "studio_portrait_plan" },
  { method: "POST", match: (p) => p === "/api/ppt/analyze",                  cost: 10, reason: "studio_ppt_analyze" },
  { method: "POST", match: (p) => p === "/api/ppt/generate",                 cost: 80, reason: "studio_ppt_generate" },
  { method: "POST", match: (p) => p === "/api/ppt/complete",                 cost: 80, reason: "studio_ppt_complete" },
  { method: "POST", match: (p) => p === "/api/ppt/slide/edit",               cost: 10, reason: "studio_ppt_slide_edit" },
  { method: "POST", match: (p) => p === "/api/prompt-agent/analyze",         cost: 5,  reason: "studio_prompt_analyze" },
];

export type StudioBillable = {
  cost: number;
  reason: string;
};

export function studioBillableFor(method: string, pathname: string): StudioBillable | null {
  const entry = COST_TABLE.find((e) => e.method === method && e.match(pathname));
  return entry ? { cost: entry.cost, reason: entry.reason } : null;
}
