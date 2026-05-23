import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { Background } from "@/components/background";
import { Container } from "@/components/container";
import { StudioShell } from "./studio-shell";
import { getUserApiKeyMetadata } from "@/lib/studio/providers/openai/user-api-key-service";

export default async function StudioPage() {
  const access = await getActiveSessionUser(await headers());
  if (!access.ok) {
    redirect("/login");
  }

  const byoMeta = await getUserApiKeyMetadata(access.user.id, "openai");
  const t = await getTranslations("studio.page");

  return (
    <div className="relative min-h-screen">
      <Background />
      <Container className="relative z-10 py-16 md:py-20">
        <div className="space-y-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-bold text-foreground md:text-5xl">{t("title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-full border border-border bg-card/60 px-3 py-1 text-card-foreground">
                {byoMeta?.enabled
                  ? t("byoEnabled", { hint: byoMeta.keyHint })
                  : t("byoDisabled")}
              </span>
              <Link
                href="/settings/api-keys"
                className="rounded-full border border-border bg-card/60 px-3 py-1 text-card-foreground hover:bg-card"
              >
                {t("manageApiKey")}
              </Link>
            </div>
          </div>
          <StudioShell />
        </div>
      </Container>
    </div>
  );
}
