#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  credits: integer("credits").default(0).notNull(),
  role: text("role").default("user").notNull(),
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim();
  const databaseUrl = (process.env.DATABASE_URL || "").trim();

  if (!adminEmail) {
    console.error("Missing ADMIN_EMAIL.");
    console.error("Example (PowerShell): $env:ADMIN_EMAIL='admin@example.com'; npm run admin:setup");
    process.exit(1);
  }

  if (!databaseUrl) {
    console.error("Missing DATABASE_URL in .env.local.");
    process.exit(1);
  }

  const sql = postgres(databaseUrl);
  const db = drizzle(sql);

  try {
    const rows = await db.select().from(user).where(eq(user.email, adminEmail)).limit(1);
    if (rows.length === 0) {
      console.error(`User not found: ${adminEmail}`);
      console.error("Please sign up first with this email, then run this script again.");
      process.exit(1);
    }

    const current = rows[0];
    if (current.role === "admin") {
      console.log(`Already admin: ${adminEmail}`);
      process.exit(0);
    }

    await db
      .update(user)
      .set({
        role: "admin",
        updatedAt: new Date(),
      })
      .where(eq(user.email, adminEmail));

    console.log(`Admin granted: ${adminEmail}`);
  } finally {
    await sql.end();
  }
}

void main();
