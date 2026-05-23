#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const {
    createPromptTemplate,
    deletePromptTemplate,
    getPromptTemplate,
    listPromptTemplates,
    recordPromptTemplateUsage,
    updatePromptTemplate,
  } = await import("../lib/studio/prompt-template-service");
  const { db } = await import("../lib/db");
  const { user } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx scripts/smoke-prompt-templates.ts <email>");
    process.exit(1);
  }

  const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (rows.length === 0) {
    console.error(`User ${email} not found`);
    process.exit(1);
  }
  const u = rows[0];
  console.log(`User: ${u.email} (id=${u.id})`);

  console.log(`\n[1/6] Create two templates...`);
  const t1 = await createPromptTemplate({
    userId: u.id,
    name: "极简白底产品图",
    prompt: "极简静物摄影，主体居中，纯白背景，柔和棚拍光，高分辨率",
    category: "ecommerce",
    tags: ["白底", "极简", "产品"],
    favorite: true,
  });
  console.log(`  t1: id=${t1.id} category=${t1.category} tags=${t1.tags.join("|")} favorite=${t1.favorite}`);

  const t2 = await createPromptTemplate({
    userId: u.id,
    name: "编辑插画 hero",
    prompt: "Editorial illustration, minimalist editorial style, soft palette, focus on subject, magazine-style hero image",
    category: "editorial",
    tags: ["插画", "杂志"],
  });
  console.log(`  t2: id=${t2.id} category=${t2.category} tags=${t2.tags.join("|")} favorite=${t2.favorite}`);

  console.log(`\n[2/6] List all...`);
  const all = await listPromptTemplates({ userId: u.id });
  console.log(`  Total: ${all.length} (favorites first: ${all[0]?.name})`);

  console.log(`\n[3/6] List by category=ecommerce...`);
  const ecomm = await listPromptTemplates({ userId: u.id, category: "ecommerce" });
  console.log(`  Got ${ecomm.length} → ${ecomm.map(t => t.name).join(", ")}`);

  console.log(`\n[4/6] List favoriteOnly...`);
  const favs = await listPromptTemplates({ userId: u.id, favoriteOnly: true });
  console.log(`  Got ${favs.length} → ${favs.map(t => t.name).join(", ")}`);

  console.log(`\n[5/6] Update t2 (rename + favorite=true + add tag) and record usage...`);
  const updated = await updatePromptTemplate({
    id: t2.id,
    userId: u.id,
    name: "杂志风 hero v2",
    favorite: true,
    tags: ["插画", "杂志", "hero"],
  });
  await recordPromptTemplateUsage({ id: t2.id, userId: u.id });
  await recordPromptTemplateUsage({ id: t2.id, userId: u.id });
  const refreshed = await getPromptTemplate({ id: t2.id, userId: u.id });
  console.log(
    `  After: name="${refreshed?.name}" favorite=${refreshed?.favorite} tags=${refreshed?.tags.join("|")} usageCount=${refreshed?.usageCount} lastUsedAt=${refreshed?.lastUsedAt?.toISOString()}`,
  );
  console.log(`  Update return ok: ${updated.name === "杂志风 hero v2"}`);

  console.log(`\n[6/6] Delete both, verify list is empty...`);
  const d1 = await deletePromptTemplate({ id: t1.id, userId: u.id });
  const d2 = await deletePromptTemplate({ id: t2.id, userId: u.id });
  const after = await listPromptTemplates({ userId: u.id });
  console.log(`  Deleted: t1=${d1} t2=${d2}; remaining for user: ${after.length}`);

  console.log(`\nAll prompt-template service operations OK.`);
  process.exit(0);
}

void main().catch(err => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
