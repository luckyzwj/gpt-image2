"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { StudioAsset } from "@/lib/client-api";
import type { StudioDataBundle } from "../studio-shell";
import { cn } from "@/lib/utils";

type Props = {
  bundle: StudioDataBundle;
};

const FILTER_KEYS = ["all", "image", "pptx", "reference"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export function GalleryTab({ bundle }: Props) {
  const t = useTranslations("studio.gallery");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<StudioAsset | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return bundle.assets;
    return bundle.assets.filter(asset => asset.assetType === filter);
  }, [bundle.assets, filter]);

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTER_KEYS.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition",
                filter === key
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-background/60 text-card-foreground hover:bg-card",
              )}
            >
              {t(`filters.${key}`)}
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map(asset => (
            <button
              key={asset.id}
              type="button"
              onClick={() => setSelected(asset)}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-border/60 bg-background/40"
            >
              {asset.assetType === "image" || asset.assetType === "reference" ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={asset.publicUrl}
                  alt="gallery asset"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center bg-primary/10 text-primary">
                  <span className="text-xs font-semibold uppercase">
                    {asset.assetType}
                  </span>
                  <span className="mt-1 text-[10px] opacity-80">
                    {asset.mimeType || ""}
                  </span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                <span className="font-mono">{asset.taskId.slice(0, 6)}</span>
                <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90vh] max-w-4xl overflow-auto rounded-2xl border border-border bg-card p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                <div className="font-mono">{selected.id}</div>
                <div className="mt-0.5">
                  task <span className="font-mono">{selected.taskId.slice(0, 8)}</span> ·{" "}
                  {new Date(selected.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={selected.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs text-card-foreground hover:bg-card"
                >
                  {t("download")}
                </a>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs text-card-foreground hover:bg-card"
                >
                  {t("close")}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center">
              {selected.assetType === "image" || selected.assetType === "reference" ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={selected.publicUrl}
                  alt="full asset"
                  className="max-h-[70vh] w-auto rounded-xl"
                />
              ) : (
                <div className="rounded-xl border border-border bg-background/60 p-8 text-sm text-muted-foreground">
                  {t("nonImageHint")}
                  <a
                    href={selected.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-primary underline underline-offset-2"
                  >
                    {selected.publicUrl}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
