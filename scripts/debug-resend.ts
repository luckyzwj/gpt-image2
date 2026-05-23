import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error("RESEND_API_KEY not set");
  process.exit(1);
}

async function api(path: string) {
  const r = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function main() {
  console.log("== Domains ==");
  const d = await api("/domains");
  console.log(JSON.stringify(d.json, null, 2));

  console.log("\n== Recent emails (last 10) ==");
  const e = await api("/emails?limit=10");
  console.log(JSON.stringify(e.json, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
