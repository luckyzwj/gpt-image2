#!/usr/bin/env tsx
/**
 * Phase 2 sistine-shell i18n audit: scan the sistine starter pages
 * (marketing / auth / admin non-studio / protected non-studio / etc) for
 * any remaining hard-coded Chinese string literals that bypass next-intl.
 *
 * This complements `i18n-audit-w6.ts` which only scanned W2-W5 studio
 * additions. By 2026-05-23 the studio scan is clean; this one targets
 * the rest of app/[locale]/ that sistine shipped pre-i18n'd already, so
 * any remaining zh hit is either:
 *   (a) a translation mismatch (en.json key missing while zh.json has it
 *       and the page falls back to a Chinese inline default), or
 *   (b) a literal that was never extracted to messages/{zh,en}.json.
 *
 * Output: per-file count + first 5 sample lines, plus key-set diff between
 * messages/zh.json and messages/en.json.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const CWD = process.cwd();

const SHELL_ROOTS = [
  "app/[locale]/(marketing)",
  "app/[locale]/(auth)",
  "app/[locale]/(admin)/admin",
  "app/[locale]/(protected)",
  "app/[locale]/check-email",
  "app/[locale]/verify-email",
  "app/[locale]/demo",
  "components",
  "features",
];

// Already audited in i18n-audit-w6.ts (studio + admin/studio-* + settings/api-keys)
const SKIP_PREFIXES = [
  "app/[locale]/(protected)/studio",
  "app/[locale]/(protected)/settings/api-keys",
  "app/[locale]/(admin)/admin/studio-tasks",
  "app/[locale]/(admin)/admin/studio-assets",
  "app/[locale]/(admin)/admin/studio-usage",
  "app/[locale]/(admin)/admin/studio-pricing",
  "app/[locale]/(admin)/admin/studio-tiers",
];

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...walkTsx(full));
    } else if (s.isFile() && (full.endsWith(".tsx") || full.endsWith(".ts"))) {
      out.push(full.replace(/\\/g, "/"));
    }
  }
  return out;
}

const HAN = /[一-鿿]/;
const IS_COMMENT = /^\s*(\/\/|\*|\/\*)/;

// Strip trailing `// ...` line comments and inline JSX `{/* ... */}` comments
// from a single line, returning whatever code-shaped text remains. This lets us
// detect hard-coded zh literals while ignoring zh that only lives in comments.
// Multi-line JSX comments are handled by the caller's block-comment state.
function stripInlineComments(line: string): string {
  let out = line.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const slashIdx = out.search(/(^|[^:])\/\//);
  if (slashIdx >= 0) {
    const idx = out.indexOf("//", slashIdx);
    if (idx >= 0) out = out.slice(0, idx);
  }
  return out;
}

type Hit = { file: string; line: number; text: string };

function auditFile(file: string): Hit[] {
  const src = readFileSync(file, "utf-8");
  const lines = src.split(/\r?\n/);
  const hits: Hit[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    // Multi-line JSX comments `{/* ... */}` spanning >1 line — enter block-comment
    // state if we see `{/*` without a matching `*/}` on the same line.
    if (line.includes("{/*") && !line.includes("*/}")) {
      inBlockComment = true;
      continue;
    }
    if (IS_COMMENT.test(line)) continue;
    // Strip trailing `// 中文` and inline `{/* 中文 */}` before checking
    const codeOnly = stripInlineComments(line);
    if (!HAN.test(codeOnly)) continue;
    if (/useTranslations\s*\(/.test(codeOnly)) continue;
    if (/getTranslations\s*\(/.test(codeOnly)) continue;
    // Skip translation-table-style files (key: "中文") since both sides of a
    // JSON-shaped object literal containing zh value are part of the
    // messages map, not UI literals.
    if (/^["'][^"']+["']\s*:\s*["']/.test(codeOnly.trim())) continue;
    // Skip console.* statements — debug logging, not UI text
    if (/^\s*console\.(log|error|warn|info|debug)\b/.test(codeOnly)) continue;
    hits.push({ file, line: i + 1, text: line.length > 140 ? line.slice(0, 137) + "…" : line });
  }
  return hits;
}

function makeRelativePath(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  const cwd = CWD.replace(/\\/g, "/");
  return norm.startsWith(cwd) ? norm.slice(cwd.length + 1) : norm;
}

function shouldSkip(rel: string): boolean {
  for (const prefix of SKIP_PREFIXES) {
    if (rel.startsWith(prefix)) return true;
  }
  return false;
}

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenKeys(v, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

async function main() {
  // --- 1) Literal scan ---
  const allFiles: string[] = [];
  for (const root of SHELL_ROOTS) {
    const abs = resolve(CWD, root);
    const files = walkTsx(abs);
    for (const f of files) {
      const rel = makeRelativePath(f);
      if (shouldSkip(rel)) continue;
      allFiles.push(f);
    }
  }

  console.log(`Scanning ${allFiles.length} sistine-shell files for hard-coded zh literals…\n`);

  const grandHits: Hit[] = [];
  const perFile: Array<{ file: string; count: number; samples: Hit[] }> = [];

  for (const file of allFiles) {
    const hits = auditFile(file);
    if (hits.length === 0) continue;
    grandHits.push(...hits);
    perFile.push({ file, count: hits.length, samples: hits.slice(0, 5) });
  }

  perFile.sort((a, b) => b.count - a.count);

  console.log(`Per-file gap counts (descending):`);
  for (const { file, count, samples } of perFile) {
    console.log(`\n  ${makeRelativePath(file)} — ${count} zh-literal line${count === 1 ? "" : "s"}`);
    for (const h of samples) {
      console.log(`    L${h.line}: ${h.text}`);
    }
    if (count > samples.length) {
      console.log(`    … +${count - samples.length} more`);
    }
  }

  // --- 2) Translation key-set diff ---
  console.log(`\n──── Translation key-set diff (messages/zh.json vs en.json) ────`);
  const zh = JSON.parse(readFileSync(resolve(CWD, "messages/zh.json"), "utf-8"));
  const en = JSON.parse(readFileSync(resolve(CWD, "messages/en.json"), "utf-8"));
  const zhKeys = new Set(flattenKeys(zh));
  const enKeys = new Set(flattenKeys(en));
  const onlyZh = [...zhKeys].filter(k => !enKeys.has(k)).sort();
  const onlyEn = [...enKeys].filter(k => !zhKeys.has(k)).sort();
  console.log(`zh-only keys (no English translation): ${onlyZh.length}`);
  onlyZh.slice(0, 20).forEach(k => console.log(`  - ${k}`));
  if (onlyZh.length > 20) console.log(`  … +${onlyZh.length - 20} more`);
  console.log(`en-only keys (no Chinese translation): ${onlyEn.length}`);
  onlyEn.slice(0, 20).forEach(k => console.log(`  - ${k}`));
  if (onlyEn.length > 20) console.log(`  … +${onlyEn.length - 20} more`);

  // --- 3) SEO key-set diff ---
  console.log(`\n──── SEO key-set diff (messages/seo.zh.json vs seo.en.json) ────`);
  const seoZh = JSON.parse(readFileSync(resolve(CWD, "messages/seo.zh.json"), "utf-8"));
  const seoEn = JSON.parse(readFileSync(resolve(CWD, "messages/seo.en.json"), "utf-8"));
  const seoZhKeys = new Set(flattenKeys(seoZh));
  const seoEnKeys = new Set(flattenKeys(seoEn));
  const seoOnlyZh = [...seoZhKeys].filter(k => !seoEnKeys.has(k)).sort();
  const seoOnlyEn = [...seoEnKeys].filter(k => !seoZhKeys.has(k)).sort();
  console.log(`SEO zh-only: ${seoOnlyZh.length}`);
  seoOnlyZh.slice(0, 10).forEach(k => console.log(`  - ${k}`));
  console.log(`SEO en-only: ${seoOnlyEn.length}`);
  seoOnlyEn.slice(0, 10).forEach(k => console.log(`  - ${k}`));

  console.log(`\n──── Summary ────`);
  console.log(`Sistine-shell files scanned:    ${allFiles.length}`);
  console.log(`Files with hard-coded zh:       ${perFile.length}`);
  console.log(`Total zh-literal lines:         ${grandHits.length}`);
  console.log(`zh.json keys missing en:        ${onlyZh.length}`);
  console.log(`en.json keys missing zh:        ${onlyEn.length}`);
  console.log(`seo.zh.json keys missing en:    ${seoOnlyZh.length}`);
  console.log(`seo.en.json keys missing zh:    ${seoOnlyEn.length}`);
}

void main().catch(err => {
  console.error("[i18n-audit-shell] FATAL:", err);
  process.exit(1);
});
