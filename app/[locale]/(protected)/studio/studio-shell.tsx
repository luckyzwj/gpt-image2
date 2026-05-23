"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { StudioAsset, StudioTaskSummary } from "@/lib/client-api";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import { SingleImageTab } from "./tabs/single-image-tab";
import { ImageDecomposeTab } from "./tabs/image-decompose-tab";
import { CreationTab } from "./tabs/creation-tab";
import { ArticleTab } from "./tabs/article-tab";
import { PptTab } from "./tabs/ppt-tab";
import { GalleryTab } from "./tabs/gallery-tab";
import { PromptKitTab } from "./tabs/prompt-kit-tab";

const TAB_DEFS = [
  { key: "single" },
  { key: "decompose" },
  { key: "creation" },
  { key: "article" },
  { key: "ppt" },
  { key: "gallery" },
  { key: "prompt-kit" },
] as const;

export type StudioTabKey = (typeof TAB_DEFS)[number]["key"];

export type StudioDataBundle = {
  tasks: StudioTaskSummary[];
  assets: StudioAsset[];
  taskAssetMap: Map<string, StudioAsset[]>;
  refresh: () => Promise<void>;
  isRunningQueue: boolean;
  runQueueNow: () => Promise<void>;
};

const TAB_LABEL_KEY: Record<StudioTabKey, string> = {
  single: "tabs.single",
  decompose: "tabs.decompose",
  creation: "tabs.creation",
  article: "tabs.article",
  ppt: "tabs.ppt",
  gallery: "tabs.gallery",
  "prompt-kit": "tabs.promptKit",
};

const TERMINAL_STATUSES = new Set<StudioTaskSummary["status"]>([
  "completed",
  "failed",
  "canceled",
  "partial_failed",
]);

const SAFETY_POLL_MS = 30_000;

type SseTaskFrame = {
  id: string;
  status: StudioTaskSummary["status"];
  creditsReserved: number;
  creditsFinal: number;
  creditsRefunded: number;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  errorCode: string | null;
};

type SseAssetsFrame = { assets: StudioAsset[] };

export function StudioShell() {
  const t = useTranslations("studio.shell");
  const [active, setActive] = useState<StudioTabKey>("single");
  const [tasks, setTasks] = useState<StudioTaskSummary[]>([]);
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [isRunningQueue, setIsRunningQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskAssetMap = useMemo(() => {
    const map = new Map<string, StudioAsset[]>();
    for (const asset of assets) {
      if (!asset.taskId) continue;
      const list = map.get(asset.taskId) || [];
      list.push(asset);
      map.set(asset.taskId, list);
    }
    return map;
  }, [assets]);

  const refresh = useCallback(async () => {
    try {
      const [tasksRes, assetsRes] = await Promise.all([
        fetch("/api/studio/tasks?limit=40"),
        fetch("/api/studio/assets?limit=80"),
      ]);
      if (tasksRes.ok) {
        const data = (await tasksRes.json()) as { tasks: StudioTaskSummary[] };
        setTasks(data.tasks || []);
      }
      if (assetsRes.ok) {
        const data = (await assetsRes.json()) as { assets: StudioAsset[] };
        setAssets(data.assets || []);
      }
    } catch (refreshError) {
      console.warn("[studio] refresh failed", refreshError);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, SAFETY_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const activeTaskKey = useMemo(
    () =>
      tasks
        .filter(task => !TERMINAL_STATUSES.has(task.status))
        .map(task => task.id)
        .sort()
        .join(","),
    [tasks],
  );

  const streamsRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    const want = new Set(activeTaskKey ? activeTaskKey.split(",") : []);
    const open = streamsRef.current;

    for (const [taskId, es] of open.entries()) {
      if (!want.has(taskId)) {
        es.close();
        open.delete(taskId);
      }
    }

    for (const taskId of want) {
      if (open.has(taskId)) continue;
      const es = new EventSource(`/api/studio/tasks/${taskId}/stream`);
      open.set(taskId, es);

      const closeFor = () => {
        es.close();
        open.delete(taskId);
      };

      es.addEventListener("task", evt => {
        try {
          const frame = JSON.parse((evt as MessageEvent).data) as SseTaskFrame;
          setTasks(prev =>
            prev.map(task =>
              task.id === frame.id
                ? {
                    ...task,
                    status: frame.status,
                    creditsReserved: frame.creditsReserved,
                    creditsFinal: frame.creditsFinal,
                    creditsRefunded: frame.creditsRefunded,
                    result: frame.result ?? task.result,
                    errorMessage: frame.errorMessage,
                  }
                : task,
            ),
          );
        } catch (parseError) {
          console.warn("[studio] sse task parse failed", parseError);
        }
      });

      es.addEventListener("assets", evt => {
        try {
          const frame = JSON.parse((evt as MessageEvent).data) as SseAssetsFrame;
          if (!Array.isArray(frame.assets) || frame.assets.length === 0) return;
          setAssets(prev => {
            const byId = new Map(prev.map(a => [a.id, a]));
            for (const asset of frame.assets) byId.set(asset.id, asset);
            return Array.from(byId.values()).sort((a, b) => {
              const ta = new Date(a.createdAt).getTime();
              const tb = new Date(b.createdAt).getTime();
              return tb - ta;
            });
          });
        } catch (parseError) {
          console.warn("[studio] sse assets parse failed", parseError);
        }
      });

      es.addEventListener("done", () => {
        closeFor();
        void refresh();
      });

      es.addEventListener("error", () => {
        closeFor();
      });

      es.onerror = () => {
        closeFor();
      };
    }
  }, [activeTaskKey, refresh]);

  useEffect(() => {
    const open = streamsRef.current;
    return () => {
      for (const es of open.values()) es.close();
      open.clear();
    };
  }, []);

  const runQueueNow = useCallback(async () => {
    setError(null);
    setIsRunningQueue(true);
    try {
      const response = await fetch("/api/studio/tasks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 3 }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to run queue");
      }
      await refresh();
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "Failed to run queue");
    } finally {
      setIsRunningQueue(false);
    }
  }, [refresh]);

  const bundle: StudioDataBundle = {
    tasks,
    assets,
    taskAssetMap,
    refresh,
    isRunningQueue,
    runQueueNow,
  };

  return (
    <div className="space-y-5">
      <nav
        className="flex flex-wrap gap-2 rounded-3xl border border-border bg-card/40 p-2 backdrop-blur-md"
        aria-label={t("aria")}
      >
        {TAB_DEFS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "flex flex-col items-start rounded-2xl px-4 py-2 text-left transition",
              active === tab.key
                ? "bg-primary text-primary-foreground shadow"
                : "text-card-foreground hover:bg-card/80",
            )}
            aria-pressed={active === tab.key}
          >
            <span className="text-sm font-semibold">{t(TAB_LABEL_KEY[tab.key])}</span>
          </button>
        ))}
      </nav>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div>
          {active === "single" && <SingleImageTab bundle={bundle} onError={setError} />}
          {active === "decompose" && <ImageDecomposeTab bundle={bundle} onError={setError} />}
          {active === "creation" && <CreationTab bundle={bundle} onError={setError} />}
          {active === "article" && <ArticleTab bundle={bundle} onError={setError} />}
          {active === "ppt" && <PptTab bundle={bundle} onError={setError} />}
          {active === "gallery" && <GalleryTab bundle={bundle} />}
          {active === "prompt-kit" && <PromptKitTab onError={setError} />}
        </div>
        <aside className="space-y-3">
          <section className="rounded-3xl border border-border bg-card/50 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-card-foreground">{t("queue.title")}</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  {t("queue.refresh")}
                </Button>
                <Button size="sm" onClick={() => void runQueueNow()} disabled={isRunningQueue}>
                  {isRunningQueue ? t("queue.running") : t("queue.runNow")}
                </Button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("queue.hint")}</p>
            <ul className="mt-3 space-y-2 max-h-[420px] overflow-auto pr-1">
              {tasks.length === 0 && (
                <li className="text-xs text-muted-foreground">{t("queue.empty")}</li>
              )}
              {tasks.map(task => {
                const taskAssets = taskAssetMap.get(task.id) || [];
                return (
                  <li
                    key={task.id}
                    className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] uppercase",
                          task.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-500"
                            : task.status === "failed"
                            ? "bg-destructive/15 text-destructive"
                            : task.status === "partial_failed"
                            ? "bg-amber-500/15 text-amber-500"
                            : task.status === "running"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {t(`status.${task.status}`)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-card-foreground">
                      <span>{t(`taskTypes.${task.taskType}`)}</span>
                      <span>
                        {t("creditsUnit", { n: task.creditsFinal || task.creditsReserved })}
                      </span>
                    </div>
                    {taskAssets.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {taskAssets.slice(0, 4).map(asset => (
                          <a
                            key={asset.id}
                            href={asset.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-primary underline underline-offset-2"
                          >
                            {t("queue.assetLink")}
                          </a>
                        ))}
                      </div>
                    )}
                    {task.errorMessage && (
                      <p className="mt-1 text-[10px] text-destructive line-clamp-2">
                        {task.errorMessage}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
