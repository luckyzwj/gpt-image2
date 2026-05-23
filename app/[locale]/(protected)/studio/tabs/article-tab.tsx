"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import type { StudioDataBundle } from "../studio-shell";

type Props = {
  bundle: StudioDataBundle;
  onError: (msg: string | null) => void;
};

const STYLE_KEYS = [
  { value: "editorial", k: "editorial" },
  { value: "minimal", k: "minimal" },
  { value: "cinematic", k: "cinematic" },
  { value: "illustrated", k: "illustrated" },
  { value: "documentary", k: "documentary" },
  { value: "3d-render", k: "threeDRender" },
] as const;

export function ArticleTab({ bundle, onError }: Props) {
  const t = useTranslations("studio.article");
  const tStatus = useTranslations("studio.shell.status");
  const tTypes = useTranslations("studio.shell.taskTypes");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [style, setStyle] = useState("editorial");
  const [imageCount, setImageCount] = useState(4);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (kind: "plan" | "generate") => {
    if (!body.trim()) {
      onError(t("errors.bodyRequired"));
      return;
    }
    onError(null);
    setSubmitting(true);
    try {
      const url =
        kind === "plan"
          ? "/api/studio/tasks/article/plan"
          : "/api/studio/tasks/article/generate";
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          body: body.trim(),
          style,
          imageCount,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Submit failed (${response.status})`);
      }
      fetch("/api/studio/tasks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
      }).catch(() => {});
      await bundle.refresh();
    } catch (submitError) {
      onError(submitError instanceof Error ? submitError.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const articleTasks = bundle.tasks.filter(
    task => task.taskType === "article_plan" || task.taskType === "article_generate",
  );

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("titleLabel")}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
          />
        </Field>
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
      </div>

      <Field label={t("bodyLabel")}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={8}
          maxLength={8000}
          placeholder={t("bodyPlaceholder")}
          className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
        />
        <span className="mt-1 block text-right text-[10px] text-muted-foreground">
          {body.length} / 8000
        </span>
      </Field>

      <Field label={t("countLabel")}>
        <select
          value={imageCount}
          onChange={e => setImageCount(Number(e.target.value))}
          className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          {[2, 3, 4, 5, 6, 8].map(n => (
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
        {articleTasks.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {articleTasks.slice(0, 5).map(task => {
              const assets = bundle.taskAssetMap.get(task.id) || [];
              const result = task.result as { prompts?: string[]; outline?: unknown } | null;
              return (
                <li key={task.id} className="rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
                  <div className="flex items-center justify-between text-card-foreground">
                    <span className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</span>
                    <span>{tTypes(task.taskType)}</span>
                    <span>{tStatus(task.status)}</span>
                  </div>
                  {result?.prompts && Array.isArray(result.prompts) && (
                    <ol className="mt-2 list-decimal pl-4 text-[11px] text-muted-foreground space-y-1">
                      {result.prompts.slice(0, 6).map((p, i) => (
                        <li key={i} className="line-clamp-2">
                          {p}
                        </li>
                      ))}
                    </ol>
                  )}
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
                            alt="article asset"
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
