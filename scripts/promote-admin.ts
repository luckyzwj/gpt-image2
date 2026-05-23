import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const PRIMARY_EMAIL = "luckyzwj@qq.com";
const SECONDARY_EMAIL = "kreegerkorman@gmail.com";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // Promote primary to admin + mark email_verified
  const r1 = await db.execute(sql`
    UPDATE "user"
    SET role = 'admin', email_verified = true, updated_at = NOW()
    WHERE email = ${PRIMARY_EMAIL}
    RETURNING id, email, role, email_verified
  `);
  console.log(`Promoted ${PRIMARY_EMAIL}:`);
  console.table(r1);

  // Also promote gmail backup to admin
  const r2 = await db.execute(sql`
    UPDATE "user"
    SET role = 'admin', updated_at = NOW()
    WHERE email = ${SECONDARY_EMAIL}
    RETURNING id, email, role, email_verified
  `);
  console.log(`Promoted ${SECONDARY_EMAIL}:`);
  console.table(r2);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
