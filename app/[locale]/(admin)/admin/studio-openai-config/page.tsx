import {
  getSystemConfigPublic,
  listModelPresets,
} from "@/lib/studio-gateway/system-config-service";
import { StudioOpenaiConfigForm } from "@/features/admin/components/studio-openai-config-form";

export const dynamic = "force-dynamic";

export default async function StudioOpenaiConfigPage() {
  const [cfg, presets] = await Promise.all([
    getSystemConfigPublic(),
    listModelPresets(),
  ]);

  return <StudioOpenaiConfigForm initialConfig={cfg} initialPresets={presets} />;
}
