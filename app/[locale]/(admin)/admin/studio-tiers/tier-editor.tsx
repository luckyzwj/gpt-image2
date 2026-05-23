"use client";

import { useState } from "react";
import { Button } from "@/components/button";

type TierRow = {
  id: string;
  tierKey: string;
  displayName: string;
  dailyTaskLimit: number;
  dailyCreditLimit: number;
  concurrentTaskLimit: number;
  maxPromptTemplates: number;
  enabled: boolean;
  notes: string | null;
  updatedBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type RowDraft = {
  displayName: string;
  dailyTaskLimit: string;
  dailyCreditLimit: string;
  concurrentTaskLimit: string;
  maxPromptTemplates: string;
  notes: string;
  enabled: boolean;
};

function rowToDraft(row: TierRow): RowDraft {
  return {
    displayName: row.displayName,
    dailyTaskLimit: String(row.dailyTaskLimit),
    dailyCreditLimit: String(row.dailyCreditLimit),
    concurrentTaskLimit: String(row.concurrentTaskLimit),
    maxPromptTemplates: String(row.maxPromptTemplates),
    notes: row.notes ?? "",
    enabled: row.enabled,
  };
}

function parseIntField(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function TierEditor({ initial }: { initial: TierRow[] }) {
  const [rows, setRows] = useState<TierRow[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(
    Object.fromEntries(initial.map(r => [r.id, rowToDraft(r)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ rowId: string; ok: boolean; message: string } | null>(null);

  const updateDraft = (rowId: string, patch: Partial<RowDraft>) => {
    setDrafts(prev => ({ ...prev, [rowId]: { ...prev[rowId], ...patch } }));
  };

  const onSave = async (row: TierRow) => {
    setSavingId(row.id);
    setFlash(null);
    try {
      const draft = drafts[row.id];
      const body = {
        tierKey: row.tierKey,
        displayName: draft.displayName,
        dailyTaskLimit: parseIntField(draft.dailyTaskLimit, row.dailyTaskLimit),
        dailyCreditLimit: parseIntField(draft.dailyCreditLimit, row.dailyCreditLimit),
        concurrentTaskLimit: parseIntField(draft.concurrentTaskLimit, row.concurrentTaskLimit),
        maxPromptTemplates: parseIntField(draft.maxPromptTemplates, row.maxPromptTemplates),
        notes: draft.notes ? draft.notes : null,
        enabled: draft.enabled,
      };

      const response = await fetch("/api/admin/studio/tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Save failed (${response.status})`);
      }

      const data = (await response.json()) as { record: TierRow };
      setRows(prev => prev.map(r => (r.id === row.id ? data.record : r)));
      setDrafts(prev => ({ ...prev, [data.record.id]: rowToDraft(data.record) }));
      setFlash({ rowId: row.id, ok: true, message: "Saved." });
    } catch (error) {
      setFlash({
        rowId: row.id,
        ok: false,
        message: error instanceof Error ? error.message : "Save failed",
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <Th>Tier Key</Th>
            <Th>Display Name</Th>
            <Th className="text-right">Tasks/day</Th>
            <Th className="text-right">Credits/day</Th>
            <Th className="text-right">Concurrent</Th>
            <Th className="text-right">Max Templates</Th>
            <Th>Notes</Th>
            <Th>Enabled</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const draft = drafts[row.id];
            const isFlashed = flash?.rowId === row.id;
            return (
              <tr key={row.id} className="border-b border-border/60 align-top">
                <Td className="font-mono text-xs">{row.tierKey}</Td>
                <Td>
                  <input
                    type="text"
                    value={draft.displayName}
                    onChange={e => updateDraft(row.id, { displayName: e.target.value })}
                    className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={0}
                    value={draft.dailyTaskLimit}
                    onChange={e => updateDraft(row.id, { dailyTaskLimit: e.target.value })}
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={0}
                    value={draft.dailyCreditLimit}
                    onChange={e => updateDraft(row.id, { dailyCreditLimit: e.target.value })}
                    className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={1}
                    value={draft.concurrentTaskLimit}
                    onChange={e => updateDraft(row.id, { concurrentTaskLimit: e.target.value })}
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={0}
                    value={draft.maxPromptTemplates}
                    onChange={e => updateDraft(row.id, { maxPromptTemplates: e.target.value })}
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td>
                  <textarea
                    rows={2}
                    value={draft.notes}
                    onChange={e => updateDraft(row.id, { notes: e.target.value })}
                    className="w-60 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                </Td>
                <Td>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={e => updateDraft(row.id, { enabled: e.target.checked })}
                    />
                    <span className="text-xs text-muted-foreground">enabled</span>
                  </label>
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <Button onClick={() => void onSave(row)} disabled={savingId === row.id}>
                      {savingId === row.id ? "Saving..." : "Save"}
                    </Button>
                    {isFlashed && (
                      <span className={`text-xs ${flash.ok ? "text-emerald-500" : "text-destructive"}`}>
                        {flash.message}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      Updated {new Date(row.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground ${className || ""}`}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-card-foreground ${className || ""}`}>{children}</td>;
}
