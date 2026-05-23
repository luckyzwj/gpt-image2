"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import type { StudioTaskType } from "@/lib/studio/domain/types";

type PricingRow = {
  id: string;
  taskType: StudioTaskType;
  quality: string;
  priceCredits: number;
  minBatchSize: number;
  maxBatchSize: number;
  defaultBatchSize: number;
  notes: string | null;
  enabled: boolean;
  updatedBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type RowDraft = {
  priceCredits: string;
  minBatchSize: string;
  maxBatchSize: string;
  defaultBatchSize: string;
  notes: string;
  enabled: boolean;
};

function rowToDraft(row: PricingRow): RowDraft {
  return {
    priceCredits: String(row.priceCredits),
    minBatchSize: String(row.minBatchSize),
    maxBatchSize: String(row.maxBatchSize),
    defaultBatchSize: String(row.defaultBatchSize),
    notes: row.notes ?? "",
    enabled: row.enabled,
  };
}

function parseIntField(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function PricingEditor({ initial }: { initial: PricingRow[] }) {
  const [rows, setRows] = useState<PricingRow[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(
    Object.fromEntries(initial.map(r => [r.id, rowToDraft(r)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ rowId: string; ok: boolean; message: string } | null>(null);

  const updateDraft = (rowId: string, patch: Partial<RowDraft>) => {
    setDrafts(prev => ({ ...prev, [rowId]: { ...prev[rowId], ...patch } }));
  };

  const onSave = async (row: PricingRow) => {
    setSavingId(row.id);
    setFlash(null);
    try {
      const draft = drafts[row.id];
      const body = {
        taskType: row.taskType,
        quality: row.quality,
        priceCredits: parseIntField(draft.priceCredits, row.priceCredits),
        minBatchSize: parseIntField(draft.minBatchSize, row.minBatchSize),
        maxBatchSize: parseIntField(draft.maxBatchSize, row.maxBatchSize),
        defaultBatchSize: parseIntField(draft.defaultBatchSize, row.defaultBatchSize),
        notes: draft.notes ? draft.notes : null,
        enabled: draft.enabled,
      };

      const response = await fetch("/api/admin/studio/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Save failed (${response.status})`);
      }

      const data = (await response.json()) as { record: PricingRow };
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
            <Th>Task Type</Th>
            <Th>Quality</Th>
            <Th className="text-right">Price (credits)</Th>
            <Th className="text-right">Min</Th>
            <Th className="text-right">Max</Th>
            <Th className="text-right">Default</Th>
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
                <Td className="font-mono text-xs">{row.taskType}</Td>
                <Td className="text-xs text-muted-foreground">{row.quality}</Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={0}
                    value={draft.priceCredits}
                    onChange={e => updateDraft(row.id, { priceCredits: e.target.value })}
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={1}
                    value={draft.minBatchSize}
                    onChange={e => updateDraft(row.id, { minBatchSize: e.target.value })}
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={1}
                    value={draft.maxBatchSize}
                    onChange={e => updateDraft(row.id, { maxBatchSize: e.target.value })}
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td className="text-right">
                  <input
                    type="number"
                    min={1}
                    value={draft.defaultBatchSize}
                    onChange={e => updateDraft(row.id, { defaultBatchSize: e.target.value })}
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                </Td>
                <Td>
                  <textarea
                    rows={2}
                    value={draft.notes}
                    onChange={e => updateDraft(row.id, { notes: e.target.value })}
                    className="w-72 rounded-md border border-border bg-background px-2 py-1 text-sm"
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
