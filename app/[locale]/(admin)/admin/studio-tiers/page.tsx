import { requireAdmin } from "@/lib/auth/admin";
import { listTierConfigs } from "@/lib/studio/quota-service";
import { db } from "@/lib/db";
import { studioUserQuotaOverride, user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TierEditor } from "./tier-editor";
import { OverridesPanel } from "./overrides-panel";

export default async function AdminStudioTiersPage() {
  await requireAdmin();
  const tiers = await listTierConfigs();

  const overrideRows = await db
    .select({
      override: studioUserQuotaOverride,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        planKey: user.planKey,
      },
    })
    .from(studioUserQuotaOverride)
    .innerJoin(user, eq(studioUserQuotaOverride.userId, user.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Studio Tiers & Quotas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Per-plan daily limits applied when users create studio tasks. Changes take effect within 30 seconds (cache TTL).
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Tier defaults</h2>
        <TierEditor initial={tiers} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Per-user overrides</h2>
        <p className="text-xs text-muted-foreground">
          Nullable fields fall back to the user's tier. Use this for temporary boosts or restrictions; set an expiry date to auto-revert.
        </p>
        <OverridesPanel initial={overrideRows} />
      </section>
    </div>
  );
}
