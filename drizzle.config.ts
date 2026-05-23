import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;