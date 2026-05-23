/**
 * End-to-end smoke test for the Studio /studio page.
 *
 * 1. Seed a Better Auth session (calls scripts/e2e-seed-session.ts).
 * 2. Inject cookie into Playwright chromium.
 * 3. Visit /zh/studio, click through 7 tabs, screenshot each.
 * 4. Collect console errors and page-render assertions.
 */
import { chromium, type ConsoleMessage } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const OUT_DIR = resolve(process.cwd(), ".e2e-out");

mkdirSync(OUT_DIR, { recursive: true });

type TabSpec = { key: string; label: string };

const TABS: TabSpec[] = [
  { key: "single", label: "提示词生图" },
  { key: "decompose", label: "图片拆解" },
  { key: "creation", label: "电商套图" },
  { key: "article", label: "文章插图" },
  { key: "ppt", label: "PPT 生成" },
  { key: "gallery", label: "画廊" },
  { key: "prompt-kit", label: "提示词模板" },
];

function seedSession(): { name: string; value: string; domain: string; path: string; expiresUnix: number; userId: string; sessionId: string } {
  const res = spawnSync("pnpm", ["exec", "tsx", "scripts/e2e-seed-session.ts"], {
    encoding: "utf-8",
    shell: true,
  });
  if (res.status !== 0) {
    console.error("seeder stderr:", res.stderr);
    throw new Error("Failed to seed session");
  }
  const lines = res.stdout.split("\n").map(l => l.trim()).filter(Boolean);
  const jsonLine = lines.find(l => l.startsWith("{"));
  if (!jsonLine) throw new Error("Seeder did not output JSON: " + res.stdout);
  return JSON.parse(jsonLine);
}

async function main() {
  console.log(`[e2e] Base URL: ${BASE_URL}`);
  console.log("[e2e] Seeding session…");
  const cookie = seedSession();
  console.log(`[e2e] Got cookie for userId=${cookie.userId.slice(0, 6)}…`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expiresUnix,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  }]);

  const page = await ctx.newPage();
  const allLogs: { tab: string; type: string; text: string }[] = [];
  const pageErrors: { tab: string; text: string }[] = [];
  let currentTab = "init";

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      allLogs.push({ tab: currentTab, type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ tab: currentTab, text: err.message });
  });

  // First navigation: /zh/studio
  console.log("[e2e] Navigating to /zh/studio…");
  const resp = await page.goto(`${BASE_URL}/zh/studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log(`[e2e] /zh/studio responded ${resp?.status()} (final URL: ${page.url()})`);

  if (!page.url().includes("/studio")) {
    console.error("[e2e] FAIL: redirected away from /studio (probably auth issue)");
    await page.screenshot({ path: resolve(OUT_DIR, "00-redirect.png"), fullPage: true });
    await browser.close();
    process.exit(1);
  }

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: resolve(OUT_DIR, "00-initial.png"), fullPage: true });

  const results: Array<{ tab: string; status: "ok" | "fail"; reason?: string; screenshot: string }> = [];

  for (const tab of TABS) {
    currentTab = tab.key;
    console.log(`[e2e] Tab → ${tab.key} (${tab.label})`);
    try {
      const button = page.getByRole("button", { name: tab.label }).first();
      await button.click({ timeout: 10000 });
      await page.waitForTimeout(800);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      const file = resolve(OUT_DIR, `tab-${tab.key}.png`);
      await page.screenshot({ path: file, fullPage: true });

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const isError = bodyText.includes("应用程序错误") || bodyText.includes("Application error") || bodyText.includes("Server Error") || bodyText.match(/^[\s]*Error:/m);
      if (isError) {
        results.push({ tab: tab.key, status: "fail", reason: "page shows error overlay", screenshot: file });
      } else {
        results.push({ tab: tab.key, status: "ok", screenshot: file });
      }
    } catch (err) {
      const file = resolve(OUT_DIR, `tab-${tab.key}-CRASH.png`);
      await page.screenshot({ path: file, fullPage: true }).catch(() => {});
      results.push({ tab: tab.key, status: "fail", reason: String(err), screenshot: file });
    }
  }

  await browser.close();

  const report = {
    baseUrl: BASE_URL,
    timestamp: new Date().toISOString(),
    results,
    consoleErrors: allLogs.filter(l => l.type === "error"),
    consoleWarnings: allLogs.filter(l => l.type === "warning"),
    pageErrors,
  };
  writeFileSync(resolve(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  const okCount = results.filter(r => r.status === "ok").length;
  console.log("\n=== E2E Report ===");
  for (const r of results) {
    console.log(`  ${r.status === "ok" ? "✓" : "✗"} ${r.tab.padEnd(12)} ${r.reason ?? ""}`);
  }
  console.log(`\nTabs: ${okCount}/${results.length} OK`);
  console.log(`Console errors: ${report.consoleErrors.length}`);
  console.log(`Page errors:   ${report.pageErrors.length}`);
  console.log(`Screenshots in: ${OUT_DIR}`);

  if (okCount !== results.length || report.pageErrors.length > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[e2e] FATAL:", err);
  process.exit(1);
});
