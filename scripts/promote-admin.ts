import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

// Usage:
//   tsx scripts/promote-admin.ts <email> [--verify]
//   ENV_FILE=.env.production tsx scripts/promote-admin.ts owner@example.com --verify
//
// Promotes the user with the given email to role=admin. If --verify is passed,
// also marks email_verified=true (useful when the owner has not clicked the
// magic link yet).

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const verify = args.includes("--verify");

  if (!email) {
    console.error("Usage: tsx scripts/promote-admin.ts <email> [--verify]");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  const r = verify
    ? await db.execute(sql`
        UPDATE "user"
        SET role = 'admin', email_verified = true, updated_at = NOW()
        WHERE email = ${email}
        RETURNING id, email, role, email_verified
      `)
    : await db.execute(sql`
        UPDATE "user"
        SET role = 'admin', updated_at = NOW()
        WHERE email = ${email}
        RETURNING id, email, role, email_verified
      `);

  console.log(`Promoted ${email}:`);
  console.table(r);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
