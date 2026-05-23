import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

const url = process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.CRON_SECRET;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_APP_URL and CRON_SECRET required");
  process.exit(1);
}

async function main() {
  const target = `${url}/api/studio/tasks/run?limit=5`;
  console.log(`POST ${target.replace(/\/$/, "")}`);
  const r = await fetch(target, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 5 }),
  });
  console.log(`status: ${r.status}`);
  const text = await r.text();
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
  catch { console.log(text.slice(0, 2000)); }
}

main().catch((e) => { console.error(e); process.exit(1); });
