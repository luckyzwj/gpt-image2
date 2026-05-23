"use client";

import { useState } from "react";
import { Button } from "@/components/button";

type ApiKeyRow = {
  id: string;
  provider: string;
  keyHint: string;
  baseUrl: string | null;
  enabled: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
};

export function ApiKeysEditor({ initial }: { initial: ApiKeyRow[] }) {
  const [rows, setRows] = useState<ApiKeyRow[]>(initial);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = async () => {
    const response = await fetch("/api/studio/user-api-keys");
    if (response.ok) {
      const data = (await response.json()) as { keys: Array<Omit<ApiKeyRow, "lastUsedAt" | "updatedAt"> & { lastUsedAt: string | null; updatedAt: string }> };
      setRows(data.keys);
    }
  };

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/studio/user-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Save failed (${response.status})`);
      }
      setApiKey("");
      setBaseUrl("");
      setInfo("Saved. Future studio tasks will use your key.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = async (row: ApiKeyRow, enabled: boolean) => {
    setBusyId(row.id);
    setError(null);
    try {
      const response = await fetch("/api/studio/user-api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: row.provider, enabled }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Toggle failed (${response.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: ApiKeyRow) => {
    if (!confirm("Delete this API key? Studio tasks will revert to platform billing.")) return;
    setBusyId(row.id);
    setError(null);
    try {
      const response = await fetch("/api/studio/user-api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: row.provider }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Delete failed (${response.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md">
        <h2 className="text-2xl font-semibold text-card-foreground">Add OpenAI-compatible key</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Use your own OpenAI key or a compatible proxy (e.g. an internal gateway). The key is encrypted with AES-256-GCM before it touches the database.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-card-foreground">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none transition focus:border-primary font-mono"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-card-foreground">
              Base URL <span className="text-xs text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none transition focus:border-primary"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave blank to use OpenAI's default endpoint. Use a proxy URL only if your key is for a compatible gateway.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Saving..." : "Save key"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
            {info && <span className="text-sm text-emerald-500">{info}</span>}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card/50 p-6 backdrop-blur-md">
        <h2 className="text-2xl font-semibold text-card-foreground">Your keys</h2>
        <div className="mt-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet. Add one above to enable BYO billing.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <Th>Provider</Th>
                    <Th>Hint</Th>
                    <Th>Base URL</Th>
                    <Th>Enabled</Th>
                    <Th>Last used</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-border/60">
                      <Td>{row.provider}</Td>
                      <Td className="font-mono">****{row.keyHint}</Td>
                      <Td className="font-mono text-xs">{row.baseUrl ?? "(default)"}</Td>
                      <Td>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            disabled={busyId === row.id}
                            onChange={e => void toggle(row, e.target.checked)}
                          />
                          <span className="text-xs text-muted-foreground">
                            {row.enabled ? "active" : "disabled"}
                          </span>
                        </label>
                      </Td>
                      <Td className="text-xs">{row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "—"}</Td>
                      <Td>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void remove(row)}
                          disabled={busyId === row.id}
                        >
                          {busyId === row.id ? "Working..." : "Delete"}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-card-foreground ${className || ""}`}>{children}</td>;
}
