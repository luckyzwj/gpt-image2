import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log("== Users ==");
  const users = await db.execute(sql`
    SELECT id, email, email_verified, credits, role, created_at
    FROM "user"
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(users);

  console.log("\n== Credit Ledger (last 10) ==");
  const ledger = await db.execute(sql`
    SELECT cl.id, cl.user_id, u.email, cl.delta, cl.reason, cl.created_at
    FROM credit_ledger cl
    LEFT JOIN "user" u ON cl.user_id = u.id
    ORDER BY cl.created_at DESC
    LIMIT 10
  `);
  console.table(ledger);

  console.log("\n== Studio Tasks (last 5) ==");
  try {
    const tasks = await db.execute(sql`
      SELECT id, user_id, status, created_at, completed_at
      FROM studio_task
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.table(tasks);
  } catch (e: any) {
    console.log("(no studio_task rows or table missing)");
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
