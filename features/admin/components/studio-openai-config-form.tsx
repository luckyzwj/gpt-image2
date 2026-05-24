"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Settings, KeyRound, Sparkles, ListChecks, Trash2, RefreshCcw } from "lucide-react";

type SystemConfigPublic = {
  baseUrl: string;
  responsesModel: string;
  apiKeyHint: string | null;
  hasApiKey: boolean;
  updatedAt: Date | string | null;
};

type ModelPresetRow = {
  id: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
  source: string;
};

type Props = {
  initialConfig: SystemConfigPublic;
  initialPresets: ModelPresetRow[];
};

export function StudioOpenaiConfigForm({ initialConfig, initialPresets }: Props) {
  const t = useTranslations("Admin.studioOpenaiConfig");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [responsesModel, setResponsesModel] = useState(initialConfig.responsesModel);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  const [discoveredModels, setDiscoveredModels] = useState<Array<{ modelId: string }>>([]);
  const [discoverMessage, setDiscoverMessage] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const [presets, setPresets] = useState<ModelPresetRow[]>(initialPresets);
  const [presetsMessage, setPresetsMessage] = useState<string | null>(null);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setConfigMessage(null);
    const body: Record<string, string> = {
      baseUrl,
      responsesModel,
    };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    const res = await fetch("/api/admin/studio-system-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setConfigMessage(t("saveError", { message: data.error || res.statusText }));
      return;
    }
    setApiKey("");
    setConfigMessage(t("saveOk"));
    startTransition(() => router.refresh());
  }

  async function handleDiscover() {
    setIsDiscovering(true);
    setDiscoverMessage(null);
    try {
      const res = await fetch("/api/admin/studio-system-config/discover-models", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setDiscoverMessage(t("discoverError", { message: data.error || res.statusText }));
        return;
      }
      setDiscoveredModels(data.models || []);
      setDiscoverMessage(t("discoverOk", { count: (data.models || []).length }));
    } finally {
      setIsDiscovering(false);
    }
  }

  function addPresetFromDiscovered(modelId: string) {
    if (presets.some((p) => p.modelId === modelId)) return;
    const nextOrder = presets.length === 0 ? 0 : Math.max(...presets.map((p) => p.sortOrder)) + 10;
    setPresets((prev) => [
      ...prev,
      {
        id: `tmp-${crypto.randomUUID()}`,
        modelId,
        displayName: modelId,
        enabled: true,
        sortOrder: nextOrder,
        source: "discovered",
      },
    ]);
  }

  function addManualPreset() {
    setPresets((prev) => [
      ...prev,
      {
        id: `tmp-${crypto.randomUUID()}`,
        modelId: "",
        displayName: "",
        enabled: false,
        sortOrder: prev.length === 0 ? 0 : Math.max(...prev.map((p) => p.sortOrder)) + 10,
        source: "manual",
      },
    ]);
  }

  function updatePreset(id: string, patch: Partial<ModelPresetRow>) {
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePreset(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleSavePresets() {
    setPresetsMessage(null);
    const cleaned = presets
      .map((p) => ({
        modelId: p.modelId.trim(),
        displayName: p.displayName.trim() || p.modelId.trim(),
        enabled: p.enabled,
        sortOrder: p.sortOrder,
        source: p.source,
      }))
      .filter((p) => p.modelId);
    const res = await fetch("/api/admin/studio-system-config/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presets: cleaned }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPresetsMessage(t("presetsSaveError", { message: data.error || res.statusText }));
      return;
    }
    const data = await res.json();
    setPresets(data.presets || []);
    setPresetsMessage(t("presetsSaveOk", { count: cleaned.filter((p) => p.enabled).length }));
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* 凭据区 */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-medium">{t("credentialsTitle")}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{t("credentialsHelp")}</p>

        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <label className="block">
              <span className="text-sm font-medium">{t("baseUrlLabel")}</span>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">{t("apiKeyLabel")}</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  initialConfig.hasApiKey
                    ? t("apiKeyPlaceholderExisting", { hint: initialConfig.apiKeyHint || "" })
                    : t("apiKeyPlaceholderEmpty")
                }
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("apiKeyHelp")}</p>
            </label>

            <label className="block">
              <span className="text-sm font-medium">{t("responsesModelLabel")}</span>
              <input
                type="text"
                value={responsesModel}
                onChange={(e) => setResponsesModel(e.target.value)}
                placeholder="gpt-5.4"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("responsesModelHelp")}</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("save")}
            </button>
            {configMessage && (
              <span className="text-xs text-muted-foreground">{configMessage}</span>
            )}
          </div>
        </form>
      </section>

      {/* 模型拉取区 */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">{t("discoverTitle")}</h2>
          </div>
          <button
            type="button"
            onClick={handleDiscover}
            disabled={isDiscovering || !initialConfig.hasApiKey}
            className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${isDiscovering ? "animate-spin" : ""}`} />
            {isDiscovering ? t("discovering") : t("discover")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("discoverHelp")}</p>
        {!initialConfig.hasApiKey && (
          <p className="text-xs text-amber-600">{t("discoverNeedsKey")}</p>
        )}
        {discoverMessage && <p className="text-xs text-muted-foreground">{discoverMessage}</p>}

        {discoveredModels.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("colModelId")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {discoveredModels.map((m) => {
                  const already = presets.some((p) => p.modelId === m.modelId);
                  return (
                    <tr key={m.modelId} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{m.modelId}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => addPresetFromDiscovered(m.modelId)}
                          disabled={already}
                          className="rounded border border-input px-2 py-1 text-xs hover:bg-hover disabled:opacity-40"
                        >
                          {already ? t("alreadyAdded") : t("addToCandidates")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 可用模型区 */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">{t("presetsTitle")}</h2>
          </div>
          <button
            type="button"
            onClick={addManualPreset}
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-hover"
          >
            {t("addManual")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("presetsHelp")}</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-center font-medium w-16">{t("colEnabled")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("colModelId")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("colDisplayName")}</th>
                <th className="px-3 py-2 text-center font-medium w-24">{t("colSortOrder")}</th>
                <th className="px-3 py-2 text-center font-medium w-16">{t("colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {presets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("presetsEmpty")}
                  </td>
                </tr>
              ) : (
                presets.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => updatePreset(p.id, { enabled: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={p.modelId}
                        onChange={(e) => updatePreset(p.id, { modelId: e.target.value })}
                        className="w-full rounded border border-input bg-background px-2 py-1 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={p.displayName}
                        onChange={(e) => updatePreset(p.id, { displayName: e.target.value })}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        value={p.sortOrder}
                        onChange={(e) => updatePreset(p.id, { sortOrder: Number(e.target.value) || 0 })}
                        className="w-20 rounded border border-input bg-background px-2 py-1 text-xs text-center"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removePreset(p.id)}
                        className="text-destructive hover:text-destructive/80"
                        aria-label={t("delete")}
                      >
                        <Trash2 className="h-4 w-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSavePresets}
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t("savePresets")}
          </button>
          {presetsMessage && <span className="text-xs text-muted-foreground">{presetsMessage}</span>}
        </div>
      </section>
    </div>
  );
}
