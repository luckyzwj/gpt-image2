"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import type { StudioDataBundle } from "../studio-shell";

type Props = {
  bundle: StudioDataBundle;
  onError: (msg: string | null) => void;
};

const SCENARIO_KEYS = [
  { value: "standard", k: "standard" },
  { value: "detail-page", k: "detailPage" },
  { value: "social-seeding", k: "socialSeeding" },
  { value: "launch", k: "launch" },
  { value: "promotion", k: "promotion" },
  { value: "livestream", k: "livestream" },
] as const;

export function CreationTab({ bundle, onError }: Props) {
  const t = useTranslations("studio.creation");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [imageCount, setImageCount] = useState(4);
  const [scenario, setScenario] = useState("standard");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (kind: "plan" | "generate") => {
    if (!productName.trim() || !productDescription.trim()) {
      onError(t("errors.fieldsRequired"));
      return;
    }
    onError(null);
    setSubmitting(true);
    try {
      const url =
        kind === "plan"
          ? "/api/studio/tasks/creation/plan"
          : "/api/studio/tasks/creation/generate";
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: productName.trim(),
          productDescription: productDescription.trim(),
          sellingPoints: sellingPoints
            .split("\n")
            .map(item => item.trim())
            .filter(Boolean),
          imageCount,
          scenario,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Submit failed (${response.status})`);
      }
      await bundle.refresh();
    } catch (submitError) {
      onError(submitError instanceof Error ? submitError.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const creationTasks = bundle.tasks.filter(
    task => task.taskType === "creation_plan" || task.taskType === "creation_generate",
  );

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("nameLabel")}>
          <input
            value={productName}
            onChange={e => setProductName(e.target.value)}
            maxLength={80}
            placeholder={t("namePlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          />
        </Field>
        <Field label={t("scenarioLabel")}>
          <select
            value={scenario}
            onChange={e => setScenario(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          >
            {SCENARIO_KEYS.map(s => (
              <option key={s.value} value={s.value}>
                {t(`scenarios.${s.k}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={t("descLabel")}>
        <textarea
          value={productDescription}
          onChange={e => setProductDescription(e.target.value)}
          rows={3}
          maxLength={600}
          placeholder={t("descPlaceholder")}
          className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
        />
      </Field>

      <Field label={t("sellingPointsLabel")}>
        <textarea
          value={sellingPoints}
          onChange={e => setSellingPoints(e.target.value)}
          rows={3}
          placeholder={t("sellingPointsPlaceholder")}
          className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
        />
      </Field>

      <Field label={t("countLabel")}>
        <select
          value={imageCount}
          onChange={e => setImageCount(Number(e.target.value))}
          className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          {[4, 6, 8, 10, 12].map(n => (
            <option key={n} value={n}>
              {t("countUnit", { n })}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void submit("plan")} disabled={submitting}>
          {submitting ? t("submitting") : t("previewPlan")}
        </Button>
        <Button onClick={() => void submit("generate")} disabled={submitting}>
          {submitting ? t("submitting") : t("generate")}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-background/50 p-4">
        <h3 className="text-sm font-semibold text-card-foreground">{t("recentTitle")}</h3>
        {creationTasks.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {creationTasks.slice(0, 5).map(task => {
              const assets = bundle.taskAssetMap.get(task.id) || [];
              return (
                <li key={task.id} className="rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
                  <div className="flex items-center justify-between text-card-foreground">
                    <span className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</span>
                    <span>{task.taskType}</span>
                    <span>{task.status}</span>
                  </div>
                  {assets.length > 0 && (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {assets.slice(0, 8).map(asset => (
                        <a
                          key={asset.id}
                          href={asset.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-square overflow-hidden rounded-lg border border-border/40"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.publicUrl}
                            alt="creation asset"
                            className="h-full w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-card-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
