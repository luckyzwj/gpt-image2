"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import type { StudioDataBundle } from "../studio-shell";

type Props = {
  bundle: StudioDataBundle;
  onError: (msg: string | null) => void;
};

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({ base64, mimeType: file.type || "image/png" });
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function ImageDecomposeTab({ bundle, onError }: Props) {
  const t = useTranslations("studio.decompose");
  const tStatus = useTranslations("studio.shell.status");
  const [file, setFile] = useState<File | null>(null);
  const [depth, setDepth] = useState<"brief" | "detailed">("detailed");
  const [locale, setLocale] = useState("zh");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!file) {
      onError(t("errors.fileRequired"));
      return;
    }
    onError(null);
    setSubmitting(true);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const response = await fetch("/api/studio/tasks/image/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType, depth, locale }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Submit failed (${response.status})`);
      }
      setFile(null);
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

  const decomposedTasks = bundle.tasks.filter(t => t.taskType === "image_decompose");

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <label className="block">
        <span className="text-sm font-medium text-card-foreground">{t("sourceLabel")}</span>
        <input
          type="file"
          accept="image/*"
          onChange={e => setFile(e.target.files?.[0] || null)}
          className="mt-1 w-full rounded-xl border border-dashed border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        {file && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("fileMeta", { name: file.name, kb: (file.size / 1024).toFixed(1) })}
          </span>
        )}
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("depthLabel")}>
          <select
            value={depth}
            onChange={e => setDepth(e.target.value as typeof depth)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="brief">{t("depthBrief")}</option>
            <option value="detailed">{t("depthDetailed")}</option>
          </select>
        </Field>
        <Field label={t("localeLabel")}>
          <select
            value={locale}
            onChange={e => setLocale(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="zh">{t("localeZh")}</option>
            <option value="en">{t("localeEn")}</option>
            <option value="ja">{t("localeJa")}</option>
          </select>
        </Field>
      </div>

      <Button onClick={() => void submit()} disabled={submitting}>
        {submitting ? t("submitting") : t("submit")}
      </Button>

      <div className="rounded-2xl border border-border bg-background/50 p-4">
        <h3 className="text-sm font-semibold text-card-foreground">{t("resultsTitle")}</h3>
        {decomposedTasks.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {decomposedTasks.slice(0, 5).map(task => {
              const result = task.result as { analysis?: unknown } | null;
              const analysis = result?.analysis;
              return (
                <li key={task.id} className="rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</span>
                    <span className="text-card-foreground">{tStatus(task.status)}</span>
                  </div>
                  {analysis ? (
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-card-foreground">
                      {typeof analysis === "string" ? analysis : JSON.stringify(analysis, null, 2)}
                    </pre>
                  ) : (
                    <p className="mt-2 text-muted-foreground">{t("waiting")}</p>
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
