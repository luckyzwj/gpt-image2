#!/usr/bin/env tsx
/**
 * Admin topup helper — set luckyzwj@gmail.com to 1000 credits for W5 e2e.
 * Authorized by user verbatim: "余额175不够，你就加到1000.然后继续执行w5".
 */
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { db } = await import("../lib/db");
  const { user, creditLedger } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const email = process.argv[2] || "luckyzwj@gmail.com";
  const target = Number.parseInt(process.argv[3] || "1000", 10);

  const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!rows.length) {
    console.error(`no user with email=${email}`);
    process.exit(1);
  }
  const u = rows[0];
  const delta = target - u.credits;
  console.log(`current=${u.credits} target=${target} delta=${delta}`);
  if (delta === 0) {
    console.log("already at target");
    process.exit(0);
  }
  await db.transaction(async tx => {
    await tx.update(user).set({ credits: target }).where(eq(user.id, u.id));
    await tx.insert(creditLedger).values({
      id: crypto.randomUUID(),
      userId: u.id,
      delta,
      reason: "admin_topup_w5",
    });
  });
  const after = await db.select().from(user).where(eq(user.id, u.id)).limit(1);
  console.log(`after=${after[0].credits} ✓`);
  process.exit(0);
}
void main().catch(e => {
  console.error(e);
  process.exit(1);
});
