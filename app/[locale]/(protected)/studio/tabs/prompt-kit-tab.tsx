"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";

type PromptTemplate = {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  category: string;
  tags: string[];
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Props = {
  onError: (msg: string | null) => void;
};

const CATEGORY_PRESETS = ["general", "portrait", "landscape", "product", "illustration", "logo"];

export function PromptKitTab({ onError }: Props) {
  const t = useTranslations("studio.promptKit");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("general");
  const [tags, setTags] = useState("");
  const [favorite, setFavorite] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.set("category", filterCategory);
      if (favoriteOnly) params.set("favorite", "true");
      const response = await fetch(`/api/studio/prompt-templates?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Load failed (${response.status})`);
      }
      const data = (await response.json()) as { templates: PromptTemplate[] };
      setTemplates(data.templates || []);
    } catch (loadError) {
      onError(loadError instanceof Error ? loadError.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [filterCategory, favoriteOnly, onError]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setPrompt("");
    setCategory("general");
    setTags("");
    setFavorite(false);
  };

  const startEdit = (tpl: PromptTemplate) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setPrompt(tpl.prompt);
    setCategory(tpl.category);
    setTags(tpl.tags.join(", "));
    setFavorite(tpl.favorite);
  };

  const submit = async () => {
    if (!name.trim() || !prompt.trim()) {
      onError(t("errors.fieldsRequired"));
      return;
    }
    onError(null);
    setSubmitting(true);
    try {
      const tagList = tags
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);
      const body = {
        name: name.trim(),
        prompt: prompt.trim(),
        category: category.trim() || undefined,
        tags: tagList.length > 0 ? tagList : undefined,
        favorite,
      };

      const url = editingId
        ? `/api/studio/prompt-templates/${editingId}`
        : "/api/studio/prompt-templates";
      const method = editingId ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Save failed (${response.status})`);
      }
      resetForm();
      await loadTemplates();
    } catch (saveError) {
      onError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFavorite = async (tpl: PromptTemplate) => {
    onError(null);
    try {
      const response = await fetch(`/api/studio/prompt-templates/${tpl.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !tpl.favorite }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Update failed");
      }
      await loadTemplates();
    } catch (toggleError) {
      onError(toggleError instanceof Error ? toggleError.message : "Update failed");
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    onError(null);
    try {
      const response = await fetch(`/api/studio/prompt-templates/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Delete failed");
      }
      if (editingId === id) resetForm();
      await loadTemplates();
    } catch (deleteError) {
      onError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    }
  };

  const copyToClipboard = async (tpl: PromptTemplate) => {
    onError(null);
    try {
      await navigator.clipboard.writeText(tpl.prompt);
      void fetch(`/api/studio/prompt-templates/${tpl.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordUsage: true }),
      }).then(() => loadTemplates());
    } catch {
      onError(t("errors.copyFailed"));
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>(CATEGORY_PRESETS);
    templates.forEach(t => set.add(t.category));
    return Array.from(set);
  }, [templates]);

  return (
    <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-card-foreground">{t("title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 py-1 text-xs"
          >
            <option value="">{t("filterAllCategories")}</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-card-foreground">
            <input
              type="checkbox"
              checked={favoriteOnly}
              onChange={e => setFavoriteOnly(e.target.checked)}
            />
            {t("favoriteOnly")}
          </label>
        </div>
      </header>

      <div className="rounded-2xl border border-border bg-background/50 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-card-foreground">
          {editingId ? t("editTitle") : t("newTitle")}
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t("nameLabel")}>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={120}
              placeholder={t("namePlaceholder")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label={t("categoryLabel")}>
            <input
              value={category}
              onChange={e => setCategory(e.target.value)}
              maxLength={48}
              list="prompt-kit-category-list"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <datalist id="prompt-kit-category-list">
              {categories.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label={t("promptLabel")}>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={5}
            maxLength={8000}
            placeholder={t("promptPlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t("tagsLabel")}>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder={t("tagsPlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-card-foreground">
          <input
            type="checkbox"
            checked={favorite}
            onChange={e => setFavorite(e.target.checked)}
          />
          {t("markFavorite")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? t("saving") : editingId ? t("update") : t("create")}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={resetForm} disabled={submitting}>
              {t("cancelEdit")}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-background/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">{t("listTitle")}</h3>
          <span className="text-[10px] text-muted-foreground">
            {loading ? t("loading") : t("count", { count: templates.length })}
          </span>
        </div>
        {templates.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">{t("listEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {templates.map(tpl => (
              <li
                key={tpl.id}
                className={cn(
                  "rounded-xl border bg-card/40 p-3 text-xs",
                  editingId === tpl.id ? "border-primary" : "border-border/60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-card-foreground">
                      <span className="font-semibold">{tpl.name}</span>
                      {tpl.favorite && <span className="text-amber-500">★</span>}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {tpl.category}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {t("used", { count: tpl.usageCount })}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{tpl.prompt}</p>
                    {tpl.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tpl.tags.map(tag => (
                          <span
                            key={tag}
                            className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(tpl)}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-card-foreground hover:bg-card"
                    >
                      {t("copy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(tpl)}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-card-foreground hover:bg-card"
                    >
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(tpl)}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-card-foreground hover:bg-card"
                    >
                      {tpl.favorite ? t("unfavorite") : t("favorite")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(tpl.id)}
                      className="rounded-full border border-destructive/50 bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/20"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
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
