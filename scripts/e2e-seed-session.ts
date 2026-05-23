/**
 * Programmatically create a Better Auth session for luckyzwj@gmail.com.
 * Outputs the signed cookie value to stdout (the e2e Playwright script picks it up).
 *
 * Bypasses the need for the test user's password — this only runs locally against
 * the dev DB and never touches production secrets.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

import { randomBytes, createHmac } from "node:crypto";

async function main() {
  const email = process.env.STUDIO_SMOKE_EMAIL || "luckyzwj@gmail.com";
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET missing in .env.local");

  const { db } = await import("../lib/db");
  const { user, session } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const found = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!found.length) throw new Error(`No user found for ${email}`);
  const userId = found[0].id;

  // Ensure email is verified so SessionGuard does not show the "verify email" gate.
  if (!found[0].emailVerified) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  }

  const token = randomBytes(32).toString("base64url");
  const sessionId = randomBytes(16).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  await db.insert(session).values({
    id: sessionId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    userId,
    ipAddress: "127.0.0.1",
    userAgent: "playwright-e2e",
  });

  const sig = createHmac("sha256", secret).update(token).digest("base64");
  const signedValue = `${token}.${sig}`;
  const cookieValue = encodeURIComponent(signedValue);

  process.stdout.write(JSON.stringify({
    name: "better-auth.session_token",
    value: cookieValue,
    domain: "localhost",
    path: "/",
    expiresUnix: Math.floor(expiresAt.getTime() / 1000),
    userId,
    sessionId,
  }));
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-session] failed:", err);
  process.exit(1);
});
