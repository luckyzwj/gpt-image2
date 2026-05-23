import { NextRequest } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getStudioTaskForUser, getStudioTaskEvents } from "@/lib/studio/task-service";
import { listStudioAssetsByTask } from "@/lib/studio/asset-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled", "partial_failed"]);
const POLL_INTERVAL_MS = 800;
const MAX_DURATION_MS = 10 * 60 * 1000;

function sseFrame(event: string, data: unknown) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ taskId: string }> },
) {
  const access = await getActiveSessionUser(req.headers);
  if (!access.ok) {
    return new Response(JSON.stringify({ error: access.error }), {
      status: access.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { taskId } = await props.params;
  const initialTask = await getStudioTaskForUser(taskId, access.user.id);
  if (!initialTask) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sinceParam = req.nextUrl.searchParams.get("since");
  const sinceTs = sinceParam ? Number.parseInt(sinceParam, 10) : 0;
  const initialSince = Number.isFinite(sinceTs) && sinceTs > 0 ? sinceTs : 0;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const userId = access.user.id;
      let lastEventTs = initialSince;
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", close);

      send("retry", "2000");

      try {
        const events = await getStudioTaskEvents(taskId, 500);
        const fresh = events.filter(ev => ev.createdAt.getTime() > lastEventTs);
        for (const ev of fresh) {
          send("event", {
            id: ev.id,
            eventType: ev.eventType,
            progress: ev.progress,
            payload: ev.payload,
            createdAt: ev.createdAt.toISOString(),
          });
          lastEventTs = Math.max(lastEventTs, ev.createdAt.getTime());
        }

        send("task", {
          id: initialTask.id,
          status: initialTask.status,
          creditsReserved: initialTask.creditsReserved,
          creditsFinal: initialTask.creditsFinal,
          creditsRefunded: initialTask.creditsRefunded,
          result: initialTask.result,
          errorMessage: initialTask.errorMessage,
          errorCode: initialTask.errorCode,
        });

        if (TERMINAL_STATUSES.has(initialTask.status)) {
          const assets = await listStudioAssetsByTask(taskId);
          send("assets", { assets });
          send("done", { status: initialTask.status });
          close();
          return;
        }

        let lastStatus = initialTask.status;

        while (!closed) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          if (closed) break;

          if (Date.now() - startedAt > MAX_DURATION_MS) {
            send("error", { reason: "stream_timeout" });
            close();
            break;
          }

          const [task, newEvents] = await Promise.all([
            getStudioTaskForUser(taskId, userId),
            getStudioTaskEvents(taskId, 500),
          ]);

          if (!task) {
            send("error", { reason: "task_vanished" });
            close();
            break;
          }

          const incoming = newEvents.filter(ev => ev.createdAt.getTime() > lastEventTs);
          for (const ev of incoming) {
            send("event", {
              id: ev.id,
              eventType: ev.eventType,
              progress: ev.progress,
              payload: ev.payload,
              createdAt: ev.createdAt.toISOString(),
            });
            lastEventTs = Math.max(lastEventTs, ev.createdAt.getTime());
          }

          if (task.status !== lastStatus || incoming.length > 0) {
            send("task", {
              id: task.id,
              status: task.status,
              creditsReserved: task.creditsReserved,
              creditsFinal: task.creditsFinal,
              creditsRefunded: task.creditsRefunded,
              result: task.result,
              errorMessage: task.errorMessage,
              errorCode: task.errorCode,
            });
            lastStatus = task.status;
          }

          if (TERMINAL_STATUSES.has(task.status)) {
            const assets = await listStudioAssetsByTask(taskId);
            send("assets", { assets });
            send("done", { status: task.status });
            close();
            break;
          }
        }
      } catch (err) {
        send("error", {
          reason: "stream_error",
          message: err instanceof Error ? err.message : "Unknown stream error",
        });
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
