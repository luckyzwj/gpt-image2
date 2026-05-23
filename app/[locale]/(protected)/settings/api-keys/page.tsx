import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getActiveSessionUser } from "@/lib/auth/session";
import { listUserApiKeys } from "@/lib/studio/providers/openai/user-api-key-service";
import { Background } from "@/components/background";
import { Container } from "@/components/container";
import { ApiKeysEditor } from "./api-keys-editor";

export default async function StudioApiKeysSettingsPage() {
  const access = await getActiveSessionUser(await headers());
  if (!access.ok) {
    redirect("/login");
  }

  const keys = await listUserApiKeys(access.user.id);

  return (
    <div className="relative min-h-screen">
      <Background />
      <Container className="relative z-10 py-20">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-4xl font-bold text-foreground md:text-5xl">Studio API Keys</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Bring your own OpenAI-compatible key to bypass platform credits. When BYO is active you only pay a small per-image platform fee (1 credit). Keys are encrypted at rest and only ever decrypted inside the task runner.
            </p>
          </div>

          <ApiKeysEditor initial={keys.map(k => ({
            id: k.id,
            provider: k.provider,
            keyHint: k.keyHint,
            baseUrl: k.baseUrl,
            enabled: k.enabled,
            lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
            updatedAt: k.updatedAt.toISOString(),
          }))} />
        </div>
      </Container>
    </div>
  );
}
