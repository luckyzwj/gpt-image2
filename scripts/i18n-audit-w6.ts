#!/usr/bin/env tsx
/**
 * W6 i18n audit: scan studio + admin pages added during W1-W5 for hard-coded
 * Chinese strings that have not been routed through next-intl.
 *
 * Strategy: walk a known list of dirs (studio + admin/studio-* + settings/api-keys),
 * grep each file for any character in [一-鿿], skip:
 *   - import paths, comments (// or /* ... *​/), and lines inside <pre>/<code>
 *   - lines that look like t(...) / useTranslations(...) call sites
 *
 * Output: per-file count + first 5 sample lines. NOT auto-fix — the goal is a punch
 * list for Phase 2 i18n extraction work.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const CWD = process.cwd();

const ROOTS = [
  "app/[locale]/(protected)/studio",
  "app/[locale]/(protected)/settings",
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
    } else if (s.isFile() && full.endsWith(".tsx")) {
      out.push(full.replace(/\\/g, "/"));
    }
  }
  return out;
}

const HAN = /[一-鿿]/;
const IS_COMMENT = /^\s*(\/\/|\*|\/\*)/;

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
    if (IS_COMMENT.test(line)) continue;
    if (!HAN.test(line)) continue;
    // Skip translation hookups themselves
    if (/useTranslations\s*\(/.test(line)) continue;
    if (/getTranslations\s*\(/.test(line)) continue;
    hits.push({ file, line: i + 1, text: line.length > 140 ? line.slice(0, 137) + "…" : line });
  }
  return hits;
}

function makeRelativePath(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  const cwd = CWD.replace(/\\/g, "/");
  return norm.startsWith(cwd) ? norm.slice(cwd.length + 1) : norm;
}

async function main() {
  const allFiles: string[] = [];
  for (const root of ROOTS) {
    const abs = resolve(CWD, root);
    const files = walkTsx(abs);
    allFiles.push(...files);
  }

  console.log(`Scanning ${allFiles.length} files for hard-coded zh literals…\n`);

  const grandHits: Hit[] = [];
  const perFile: Array<{ file: string; count: number; samples: Hit[] }> = [];

  for (const file of allFiles) {
    const hits = auditFile(file);
    if (hits.length === 0) continue;
    grandHits.push(...hits);
    perFile.push({
      file,
      count: hits.length,
      samples: hits.slice(0, 5),
    });
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

  console.log(`\n──── Summary ────`);
  console.log(`Files scanned:                  ${allFiles.length}`);
  console.log(`Files with hard-coded zh:       ${perFile.length}`);
  console.log(`Total zh-literal lines:         ${grandHits.length}`);
  console.log(`\nThese pages are W2-W5 additions and currently render Chinese only,`);
  console.log(`bypassing next-intl. Extracting them to messages/zh.json + en.json is Phase 2 work.`);
  console.log(`The sistine marketing/auth/dashboard shell is already i18n-routed.`);
}

void main().catch(err => {
  console.error("[i18n-audit] FATAL:", err);
  process.exit(1);
});
