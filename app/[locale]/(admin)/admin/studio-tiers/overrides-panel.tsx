"use client";

import { useState } from "react";
import { Button } from "@/components/button";

type OverrideRow = {
  override: {
    id: string;
    userId: string;
    dailyTaskLimit: number | null;
    dailyCreditLimit: number | null;
    concurrentTaskLimit: number | null;
    maxPromptTemplates: number | null;
    reason: string | null;
    expiresAt: string | Date | null;
    grantedBy: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    planKey: string | null;
  };
};

type NewDraft = {
  userId: string;
  dailyTaskLimit: string;
  dailyCreditLimit: string;
  concurrentTaskLimit: string;
  maxPromptTemplates: string;
  reason: string;
  expiresAt: string;
};

const EMPTY_DRAFT: NewDraft = {
  userId: "",
  dailyTaskLimit: "",
  dailyCreditLimit: "",
  concurrentTaskLimit: "",
  maxPromptTemplates: "",
  reason: "",
  expiresAt: "",
};

function parseNullableInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtDate(d: string | Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleString();
}

export function OverridesPanel({ initial }: { initial: OverrideRow[] }) {
  const [rows, setRows] = useState<OverrideRow[]>(initial);
  const [draft, setDraft] = useState<NewDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const updateDraft = (patch: Partial<NewDraft>) => setDraft(prev => ({ ...prev, ...patch }));

  const submit = async () => {
    setError(null);
    if (!draft.userId.trim()) {
      setError("User ID is required");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        userId: draft.userId.trim(),
        dailyTaskLimit: parseNullableInt(draft.dailyTaskLimit),
        dailyCreditLimit: parseNullableInt(draft.dailyCreditLimit),
        concurrentTaskLimit: parseNullableInt(draft.concurrentTaskLimit),
        maxPromptTemplates: parseNullableInt(draft.maxPromptTemplates),
        reason: draft.reason.trim() || null,
        expiresAt: draft.expiresAt.trim() ? new Date(draft.expiresAt).toISOString() : null,
      };

      const response = await fetch("/api/admin/studio/quota-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Save failed (${response.status})`);
      }

      const listResp = await fetch("/api/admin/studio/quota-overrides");
      const listData = (await listResp.json()) as { overrides: OverrideRow[] };
      setRows(listData.overrides);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const removeOverride = async (userId: string) => {
    setDeleting(userId);
    try {
      const response = await fetch("/api/admin/studio/quota-overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Delete failed (${response.status})`);
      }
      setRows(prev => prev.filter(r => r.override.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Add or update override</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <Field label="User ID" required>
            <input
              type="text"
              value={draft.userId}
              onChange={e => updateDraft({ userId: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
              placeholder="user_id"
            />
          </Field>
          <Field label="Tasks/day (blank = inherit)">
            <input
              type="number"
              min={0}
              value={draft.dailyTaskLimit}
              onChange={e => updateDraft({ dailyTaskLimit: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Credits/day (blank = inherit)">
            <input
              type="number"
              min={0}
              value={draft.dailyCreditLimit}
              onChange={e => updateDraft({ dailyCreditLimit: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Concurrent (blank = inherit)">
            <input
              type="number"
              min={1}
              value={draft.concurrentTaskLimit}
              onChange={e => updateDraft({ concurrentTaskLimit: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Max templates (blank = inherit)">
            <input
              type="number"
              min={0}
              value={draft.maxPromptTemplates}
              onChange={e => updateDraft({ maxPromptTemplates: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Expires at (optional)">
            <input
              type="datetime-local"
              value={draft.expiresAt}
              onChange={e => updateDraft({ expiresAt: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Reason" className="md:col-span-3 lg:col-span-2">
            <input
              type="text"
              value={draft.reason}
              onChange={e => updateDraft({ reason: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              placeholder="e.g. Beta tester boost"
            />
          </Field>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Saving..." : "Apply override"}
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <Th>User</Th>
              <Th>Plan</Th>
              <Th className="text-right">Tasks/day</Th>
              <Th className="text-right">Credits/day</Th>
              <Th className="text-right">Concurrent</Th>
              <Th className="text-right">Templates</Th>
              <Th>Reason</Th>
              <Th>Expires</Th>
              <Th>Updated</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No per-user overrides yet.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.override.id} className="border-b border-border/60 align-top">
                  <Td>
                    <div className="text-sm">{row.user.name}</div>
                    <div className="text-xs text-muted-foreground">{row.user.email}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{row.user.id}</div>
                  </Td>
                  <Td className="text-xs">{row.user.planKey ?? "free"}</Td>
                  <Td className="text-right">{row.override.dailyTaskLimit ?? "—"}</Td>
                  <Td className="text-right">{row.override.dailyCreditLimit ?? "—"}</Td>
                  <Td className="text-right">{row.override.concurrentTaskLimit ?? "—"}</Td>
                  <Td className="text-right">{row.override.maxPromptTemplates ?? "—"}</Td>
                  <Td className="text-xs">{row.override.reason ?? ""}</Td>
                  <Td className="text-xs">{fmtDate(row.override.expiresAt)}</Td>
                  <Td className="text-xs">{fmtDate(row.override.updatedAt)}</Td>
                  <Td>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void removeOverride(row.override.userId)}
                      disabled={deleting === row.override.userId}
                    >
                      {deleting === row.override.userId ? "Removing..." : "Remove"}
                    </Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground ${className || ""}`}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-card-foreground ${className || ""}`}>{children}</td>;
}
