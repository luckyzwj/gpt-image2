"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import type { StudioDataBundle } from "../studio-shell";

type Props = {
  bundle: StudioDataBundle;
  onError: (msg: string | null) => void;
};

type SlideOutline = {
  title?: string;
  bullets?: string[];
  imagePrompt?: string;
};

const STYLE_KEYS = [
  { value: "corporate", k: "corporate" },
  { value: "creative", k: "creative" },
  { value: "minimal", k: "minimal" },
  { value: "data-heavy", k: "dataHeavy" },
  { value: "pitch", k: "pitch" },
  { value: "educational", k: "educational" },
] as const;

export function PptTab({ bundle, onError }: Props) {
  const t = useTranslations("studio.ppt");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [style, setStyle] = useState("corporate");
  const [pageCount, setPageCount] = useState(8);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (kind: "plan" | "generate") => {
    if (!topic.trim()) {
      onError(t("errors.topicRequired"));
      return;
    }
    onError(null);
    setSubmitting(true);
    try {
      const url =
        kind === "plan"
          ? "/api/studio/tasks/ppt/plan"
          : "/api/studio/tasks/ppt/generate";
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          audience: audience.trim() || undefined,
          style,
          pageCount,
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

  const pptTasks = bundle.tasks.filter(
    task => task.taskType === "ppt_plan" || task.taskType === "ppt_generate",
  );

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("topicLabel")}>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            maxLength={120}
            placeholder={t("topicPlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          />
        </Field>
        <Field label={t("audienceLabel")}>
          <input
            value={audience}
            onChange={e => setAudience(e.target.value)}
            maxLength={120}
            placeholder={t("audiencePlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("styleLabel")}>
          <select
            value={style}
            onChange={e => setStyle(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          >
            {STYLE_KEYS.map(s => (
              <option key={s.value} value={s.value}>
                {t(`styles.${s.k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("pageCountLabel")}>
          <select
            value={pageCount}
            onChange={e => setPageCount(Number(e.target.value))}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          >
            {[5, 8, 10, 12, 15, 20].map(n => (
              <option key={n} value={n}>
                {t("pageCountUnit", { n })}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void submit("plan")} disabled={submitting}>
          {submitting ? t("submitting") : t("previewOutline")}
        </Button>
        <Button onClick={() => void submit("generate")} disabled={submitting}>
          {submitting ? t("submitting") : t("generate")}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-background/50 p-4">
        <h3 className="text-sm font-semibold text-card-foreground">{t("recentTitle")}</h3>
        {pptTasks.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pptTasks.slice(0, 5).map(task => {
              const assets = bundle.taskAssetMap.get(task.id) || [];
              const result = task.result as { slides?: SlideOutline[] } | null;
              const slides: SlideOutline[] = result && Array.isArray(result.slides) ? result.slides : [];
              return (
                <li key={task.id} className="rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
                  <div className="flex items-center justify-between text-card-foreground">
                    <span className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</span>
                    <span>{task.taskType}</span>
                    <span>{task.status}</span>
                  </div>
                  {slides.length > 0 && (
                    <ol className="mt-2 list-decimal pl-4 text-[11px] text-muted-foreground space-y-1">
                      {slides.slice(0, 6).map((slide, i) => (
                        <li key={i}>
                          <span className="font-medium text-card-foreground">
                            {slide.title || `Slide ${i + 1}`}
                          </span>
                          {slide.bullets && slide.bullets.length > 0 && (
                            <span className="ml-2">· {slide.bullets[0]}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {assets.length > 0 && (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {assets.slice(0, 12).map(asset => (
                        <a
                          key={asset.id}
                          href={asset.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-video overflow-hidden rounded-lg border border-border/40"
                        >
                          {asset.assetType === "pptx" ? (
                            <div className="flex h-full items-center justify-center bg-primary/10 text-[10px] text-primary">
                              PPTX
                            </div>
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={asset.publicUrl}
                              alt="ppt slide"
                              className="h-full w-full object-cover"
                            />
                          )}
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
