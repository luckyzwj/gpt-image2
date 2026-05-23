"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import type { StudioDataBundle } from "../studio-shell";

type Props = {
  bundle: StudioDataBundle;
  onError: (msg: string | null) => void;
};

export function SingleImageTab({ bundle, onError }: Props) {
  const t = useTranslations("studio.single");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState<"low" | "medium" | "high" | "auto">("high");
  const [format, setFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!prompt.trim()) {
      onError(t("errors.promptRequired"));
      return;
    }
    onError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/studio/tasks/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), size, quality, format }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Submit failed (${response.status})`);
      }
      setPrompt("");
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

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <label className="block">
        <span className="text-sm font-medium text-card-foreground">{t("promptLabel")}</span>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={6}
          maxLength={1000}
          placeholder={t("promptPlaceholder")}
          className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary"
        />
        <span className="mt-1 block text-right text-[10px] text-muted-foreground">
          {prompt.length} / 1000
        </span>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t("sizeLabel")}>
          <select
            value={size}
            onChange={e => setSize(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="1024x1024">1024 × 1024</option>
            <option value="1024x1536">1024 × 1536</option>
            <option value="1536x1024">1536 × 1024</option>
            <option value="auto">auto</option>
          </select>
        </Field>
        <Field label={t("qualityLabel")}>
          <select
            value={quality}
            onChange={e => setQuality(e.target.value as typeof quality)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="low">{t("qualityOptions.low")}</option>
            <option value="medium">{t("qualityOptions.medium")}</option>
            <option value="high">{t("qualityOptions.high")}</option>
            <option value="auto">{t("qualityOptions.auto")}</option>
          </select>
        </Field>
        <Field label={t("formatLabel")}>
          <select
            value={format}
            onChange={e => setFormat(e.target.value as typeof format)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WEBP</option>
          </select>
        </Field>
      </div>

      <Button onClick={() => void submit()} disabled={submitting}>
        {submitting ? t("submitting") : t("submit")}
      </Button>
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
