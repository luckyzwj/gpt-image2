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

  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='studio_task' ORDER BY ordinal_position
  `);
  console.log("studio_task columns:");
  console.table(result);

  const row = await db.execute(sql`
    SELECT * FROM studio_task ORDER BY created_at DESC LIMIT 1
  `);
  console.log("\nLatest task row:");
  console.log(JSON.stringify(row, null, 2));

  console.log("\n== Studio Assets ==");
  const assets = await db.execute(sql`
    SELECT id, user_id, task_id, asset_type, public_url, byte_size, created_at
    FROM studio_asset
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.table(assets);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
