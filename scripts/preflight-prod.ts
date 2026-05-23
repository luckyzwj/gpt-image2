#!/usr/bin/env tsx
// Production env preflight check.
//
// Usage:
//   pnpm exec tsx scripts/preflight-prod.ts                # checks .env.local
//   ENV_FILE=.env.production pnpm exec tsx scripts/preflight-prod.ts
//
// Pings DB, storage, OpenAI, Resend; self-tests Creem HMAC; validates secrets.
// Never logs key fragments — only presence + last-4 hint where needed.
//
// Exit 0 if every required check passes; 1 if any required fails.

import dotenv from "dotenv";
import { resolve } from "path";
import { createHmac, randomBytes } from "crypto";

const envFile = process.env.ENV_FILE || ".env.local";
dotenv.config({ path: resolve(process.cwd(), envFile) });

type Status = "pass" | "fail" | "warn" | "skip";
type CheckResult = {
  name: string;
  status: Status;
  required: boolean;
  detail: string;
};

const results: CheckResult[] = [];

function record(name: string, status: Status, required: boolean, detail: string) {
  results.push({ name, status, required, detail });
  const badge = status === "pass" ? "✓" : status === "fail" ? "✗" : status === "warn" ? "⚠" : "→";
  const tag = required ? "(required)" : "(optional)";
  console.log(`${badge} ${name} ${tag}: ${detail}`);
}

function hint(value: string | undefined, take = 4): string {
  if (!value) return "(unset)";
  if (value.length <= take) return "****";
  return `…${value.slice(-take)} (len=${value.length})`;
}

async function checkAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    record("auth.BETTER_AUTH_SECRET", "fail", true, "not set");
  } else if (secret.length < 32) {
    record("auth.BETTER_AUTH_SECRET", "fail", true, `length ${secret.length} < 32`);
  } else {
    record("auth.BETTER_AUTH_SECRET", "pass", true, `length ${secret.length}`);
  }

  const authUrl = process.env.BETTER_AUTH_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!authUrl) {
    record("auth.BETTER_AUTH_URL", "fail", true, "not set");
  } else {
    record("auth.BETTER_AUTH_URL", "pass", true, authUrl);
  }
  if (!appUrl) {
    record("auth.NEXT_PUBLIC_APP_URL", "fail", true, "not set");
  } else {
    record("auth.NEXT_PUBLIC_APP_URL", "pass", true, appUrl);
    if (authUrl && new URL(authUrl).origin !== new URL(appUrl).origin) {
      record(
        "auth.origin-match",
        "warn",
        false,
        `BETTER_AUTH_URL (${new URL(authUrl).origin}) != NEXT_PUBLIC_APP_URL (${new URL(appUrl).origin}) — cookies may misfire`,
      );
    }
  }

  const gId = process.env.AUTH_GOOGLE_ID;
  const gSecret = process.env.AUTH_GOOGLE_SECRET;
  if (gId && gSecret) {
    record("auth.google", "pass", false, "Google OAuth configured");
  } else if (gId || gSecret) {
    record("auth.google", "warn", false, "only one of AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET is set — button will hide");
  } else {
    record("auth.google", "skip", false, "Google OAuth disabled (no creds)");
  }
}

async function checkDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    record("db.DATABASE_URL", "fail", true, "not set");
    return;
  }
  record("db.DATABASE_URL", "pass", true, "set");

  try {
    const { db } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    const tablesResult = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'studio_%'`,
    );
    const rows = (tablesResult as unknown as { rows?: Array<{ table_name: string }> }).rows
      || (tablesResult as unknown as Array<{ table_name: string }>);
    const tableNames = Array.isArray(rows) ? rows.map(r => r.table_name) : [];
    if (tableNames.length < 6) {
      record("db.studio-tables", "fail", true, `found ${tableNames.length} studio_* tables (expected ≥6) — did you run db:push/db:migrate?`);
    } else {
      record("db.studio-tables", "pass", true, `${tableNames.length} studio_* tables present`);
    }
  } catch (err) {
    record("db.connect", "fail", true, `connection failed: ${(err as Error).message}`);
  }
}

async function checkStorage() {
  const backend = (process.env.STORAGE_BACKEND || "").toLowerCase();
  if (!backend) {
    record("storage.STORAGE_BACKEND", "warn", false, "unset — will default to data-url (DB blob); not safe for prod traffic");
  } else if (backend === "data-url") {
    record("storage.STORAGE_BACKEND", "warn", false, "data-url — DB blob mode; not safe for prod traffic");
  } else if (backend === "fs") {
    const root = process.env.STORAGE_FS_ROOT;
    if (!root) {
      record("storage.STORAGE_BACKEND", "warn", false, "fs but STORAGE_FS_ROOT unset — falls back to data-url");
    } else {
      record("storage.STORAGE_BACKEND", "pass", true, `fs root=${root}`);
    }
  } else if (backend === "r2") {
    const missing = [
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
      "STORAGE_ENDPOINT",
      "STORAGE_PUBLIC_URL",
      "STORAGE_BUCKET_NAME",
    ].filter(k => !process.env[k]);
    if (missing.length > 0) {
      record("storage.STORAGE_BACKEND", "fail", true, `r2 but missing: ${missing.join(", ")}`);
    } else {
      record("storage.STORAGE_BACKEND", "pass", true, `r2 bucket=${process.env.STORAGE_BUCKET_NAME}`);
    }
  } else {
    record("storage.STORAGE_BACKEND", "fail", true, `unknown backend "${backend}"`);
  }

  try {
    const { getStorage } = await import("../lib/storage");
    const storage = getStorage();
    // 1×1 transparent PNG.
    const oneByOnePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
    const uploaded = await storage.uploadBase64({
      base64: oneByOnePng,
      userId: "preflight",
      kind: "reference",
      format: "png",
    });
    if (!uploaded.storageKey || !uploaded.publicUrl) {
      record("storage.upload", "fail", true, "upload returned empty key/url");
    } else if (storage.fetch) {
      const got = await storage.fetch(uploaded.storageKey);
      if (!got || got.sizeBytes !== uploaded.sizeBytes) {
        record("storage.roundtrip", "fail", true, `fetched ${got?.sizeBytes ?? 0}B vs uploaded ${uploaded.sizeBytes}B`);
      } else {
        record("storage.roundtrip", "pass", true, `${uploaded.sizeBytes}B (${storage.name})`);
      }
      if (storage.delete) {
        try {
          await storage.delete(uploaded.storageKey);
        } catch {
          /* best-effort cleanup */
        }
      }
    } else {
      record("storage.upload", "pass", true, `${uploaded.sizeBytes}B (${storage.name}, no fetch impl)`);
    }
  } catch (err) {
    record("storage.roundtrip", "fail", true, `error: ${(err as Error).message}`);
  }
}

async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (!key) {
    record("openai.OPENAI_API_KEY", "warn", false, "not set — BYO-only mode (users must bring their own key)");
    return;
  }
  // Never log the key — only confirm presence + last-4 hint.
  record("openai.OPENAI_API_KEY", "pass", false, `set, ${hint(key)}`);
  record("openai.OPENAI_BASE_URL", "pass", false, base);

  try {
    const url = `${base.replace(/\/$/, "")}/models`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.status === 200) {
      record("openai.models", "pass", false, "GET /v1/models → 200");
    } else if (res.status === 401) {
      record("openai.models", "fail", false, "GET /v1/models → 401 (bad key)");
    } else {
      record("openai.models", "warn", false, `GET /v1/models → ${res.status}`);
    }
  } catch (err) {
    record("openai.models", "fail", false, `request failed: ${(err as Error).message}`);
  }
}

async function checkResend() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key) {
    record("resend.RESEND_API_KEY", "warn", false, "not set — auth/billing emails disabled");
    return;
  }
  record("resend.RESEND_API_KEY", "pass", false, `set, ${hint(key)}`);
  if (!from) {
    record("resend.RESEND_FROM_EMAIL", "fail", false, "RESEND_API_KEY set but RESEND_FROM_EMAIL unset");
  } else {
    record("resend.RESEND_FROM_EMAIL", "pass", false, from);
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string }> };
      const verified = body.data?.filter(d => d.status === "verified") ?? [];
      record("resend.domains", "pass", false, `${body.data?.length ?? 0} domain(s), ${verified.length} verified`);
    } else if (res.status === 401) {
      record("resend.domains", "fail", false, "GET /domains → 401 (bad key)");
    } else {
      record("resend.domains", "warn", false, `GET /domains → ${res.status}`);
    }
  } catch (err) {
    record("resend.domains", "fail", false, `request failed: ${(err as Error).message}`);
  }
}

async function checkCreem() {
  const apiKey = process.env.CREEM_API_KEY;
  const whSecret = process.env.CREEM_WEBHOOK_SECRET;
  const simulate = process.env.CREEM_SIMULATE === "true";

  if (simulate) {
    record("creem.mode", "warn", false, "CREEM_SIMULATE=true — staging mode, no real payments");
  }
  if (!apiKey) {
    record("creem.CREEM_API_KEY", "warn", false, "not set — paid plans disabled");
    return;
  }
  record("creem.CREEM_API_KEY", "pass", false, `set, ${hint(apiKey)}`);
  if (!whSecret) {
    record("creem.CREEM_WEBHOOK_SECRET", "fail", false, "API key set but webhook secret unset — webhook will 401");
    return;
  }
  record("creem.CREEM_WEBHOOK_SECRET", "pass", false, `set, ${hint(whSecret)}`);

  try {
    const { verifyWebhookSignature } = await import("../lib/payments/creem");
    const body = JSON.stringify({ event: "preflight", nonce: randomBytes(8).toString("hex") });
    const sig = createHmac("sha256", whSecret).update(body).digest("hex");
    const ok = verifyWebhookSignature(new Headers({ "creem-signature": sig }), body);
    if (ok) {
      record("creem.hmac-roundtrip", "pass", false, "self-signed payload verifies");
    } else {
      record("creem.hmac-roundtrip", "fail", false, "self-signed verify returned false");
    }
    const bad = verifyWebhookSignature(new Headers({ "creem-signature": "deadbeef".repeat(8) }), body);
    if (!bad) {
      record("creem.hmac-reject", "pass", false, "bogus signature correctly rejected");
    } else {
      record("creem.hmac-reject", "fail", false, "bogus signature accepted — verifier is broken");
    }
  } catch (err) {
    record("creem.hmac-roundtrip", "fail", false, `error: ${(err as Error).message}`);
  }
}

function checkCron() {
  const secret = process.env.CRON_SECRET;
  const user = process.env.CRON_JOBS_USERNAME;
  const pass = process.env.CRON_JOBS_PASSWORD;
  if (secret) {
    record("cron.auth", "pass", true, `CRON_SECRET set, ${hint(secret)}`);
  } else if (user && pass) {
    record("cron.auth", "pass", true, "CRON_JOBS_USERNAME/PASSWORD set");
  } else {
    record("cron.auth", "fail", true, "neither CRON_SECRET nor CRON_JOBS_USERNAME/PASSWORD set — cron endpoints will 401");
  }
}

function checkByoKey() {
  const explicit = process.env.BYO_KEY_MASTER_KEY;
  const fallback = process.env.STUDIO_BYO_KEY_SECRET || process.env.BETTER_AUTH_SECRET;
  if (explicit) {
    record("byo-key.master-key", "pass", false, `BYO_KEY_MASTER_KEY set, ${hint(explicit)}`);
  } else if (fallback) {
    record(
      "byo-key.master-key",
      "warn",
      false,
      "BYO_KEY_MASTER_KEY unset — falling back to BETTER_AUTH_SECRET; rotating auth secret will brick stored BYO keys",
    );
  } else {
    record("byo-key.master-key", "fail", false, "no master key and no fallback — BYO key encryption will throw at runtime");
  }
}

async function main() {
  console.log(`# Preflight check — env: ${envFile}`);
  console.log(`# ${new Date().toISOString()}`);
  console.log("");

  await checkAuth();
  await checkDb();
  await checkStorage();
  await checkOpenAI();
  await checkResend();
  await checkCreem();
  checkCron();
  checkByoKey();

  const failed = results.filter(r => r.status === "fail");
  const requiredFailed = failed.filter(r => r.required);
  const warned = results.filter(r => r.status === "warn");
  const passed = results.filter(r => r.status === "pass");
  const skipped = results.filter(r => r.status === "skip");

  console.log("");
  console.log("---");
  console.log(`Pass: ${passed.length}   Warn: ${warned.length}   Fail: ${failed.length}   Skip: ${skipped.length}`);
  if (requiredFailed.length > 0) {
    console.log("");
    console.log("BLOCKERS (required checks that failed):");
    for (const r of requiredFailed) {
      console.log(`  ✗ ${r.name}: ${r.detail}`);
    }
    console.log("");
    console.log("Result: NOT READY — fix blockers above before deploying.");
    process.exit(1);
  }

  const optionalFailed = failed.filter(r => !r.required);
  if (optionalFailed.length > 0) {
    console.log("");
    console.log("Optional checks failed (feature-specific — fix if you need that feature):");
    for (const r of optionalFailed) {
      console.log(`  ✗ ${r.name}: ${r.detail}`);
    }
  }
  console.log("");
  console.log("Result: READY (all required checks pass).");
  process.exit(0);
}

main().catch(err => {
  console.error("preflight crashed:", err);
  process.exit(1);
});
