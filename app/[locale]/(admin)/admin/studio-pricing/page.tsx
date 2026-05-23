import { requireAdmin } from "@/lib/auth/admin";
import { listPricingRecords } from "@/lib/studio/pricing-service";
import { PricingEditor } from "./pricing-editor";

export default async function AdminStudioPricingPage() {
  await requireAdmin();
  const pricing = await listPricingRecords();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Studio Pricing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Credit prices applied to studio tasks. Changes take effect within 30 seconds (cache TTL); they apply to new tasks only.
        </p>
      </div>

      <PricingEditor initial={pricing} />
    </div>
  );
}
