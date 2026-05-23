import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioTask, studioTaskEvent } from "@/lib/db/schema";
import { createCreditCompensation } from "@/lib/credit-compensation";
import { deductCredits, refundCredits } from "@/lib/credits";
import { STUDIO_TASK_DEFAULT_LIMIT, STUDIO_TASK_MAX_LIMIT, STUDIO_TASK_DEFAULT_MAX_RETRIES } from "@/lib/studio/domain/constants";
import { estimateStudioTaskCredits } from "@/lib/studio/domain/cost-policy";
import { parseJsonRecord, stringifyJsonRecord } from "@/lib/studio/domain/json";
import { assertQuotaAllowsTask } from "@/lib/studio/quota-service";
import type { StudioTaskEventInput, StudioTaskListParams, StudioTaskRequestPayload, StudioTaskResultPayload, StudioTaskStatus, StudioTaskType } from "@/lib/studio/domain/types";

type StudioTaskRow = typeof studioTask.$inferSelect;

function mapTaskRow(row: StudioTaskRow) {
  return {
    ...row,
    request: parseJsonRecord(row.requestJson),
    result: parseJsonRecord(row.resultJson),
  };
}

function normalizeLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return STUDIO_TASK_DEFAULT_LIMIT;
  }
  return Math.min(STUDIO_TASK_MAX_LIMIT, Math.max(1, Math.floor(limit as number)));
}

export class StudioTaskError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StudioTaskError";
    this.status = status;
  }
}

export async function appendStudioTaskEvent(taskId: string, { eventType, payload, progress }: StudioTaskEventInput) {
  await db.insert(studioTaskEvent).values({
    id: randomUUID(),
    taskId,
    eventType,
    progress: typeof progress === "number" ? progress : null,
    payloadJson: stringifyJsonRecord(payload ?? null),
  });
}

export async function createStudioTask({
  userId,
  taskType,
  requestPayload,
  idempotencyKey,
  maxRetries = STUDIO_TASK_DEFAULT_MAX_RETRIES,
}: {
  userId: string;
  taskType: StudioTaskType;
  requestPayload: StudioTaskRequestPayload;
  idempotencyKey: string;
  maxRetries?: number;
}) {
  const normalizedIdempotencyKey = idempotencyKey.trim();
  if (!normalizedIdempotencyKey) {
    throw new StudioTaskError("idempotencyKey is required", 400);
  }

  const existingTasks = await db
    .select()
    .from(studioTask)
    .where(and(eq(studioTask.userId, userId), eq(studioTask.idempotencyKey, normalizedIdempotencyKey)))
    .limit(1);

  if (existingTasks.length > 0) {
    return {
      created: false,
      task: mapTaskRow(existingTasks[0]),
    };
  }

  const taskId = randomUUID();
  const creditsReserved = await estimateStudioTaskCredits(taskType, requestPayload, { userId });

  const quotaCheck = await assertQuotaAllowsTask({ userId, estimatedCredits: creditsReserved });
  if (!quotaCheck.ok) {
    throw new StudioTaskError(quotaCheck.reason, 429);
  }

  let deductRemainingCredits: number | null = null;
  if (creditsReserved > 0) {
    const deductResult = await deductCredits(userId, creditsReserved, "studio_task_reserve", taskId);
    if (!deductResult.success) {
      throw new StudioTaskError(deductResult.error || "Insufficient credits", 402);
    }
    deductRemainingCredits = deductResult.remainingCredits;
  }

  const compensation = createCreditCompensation({
    userId,
    amount: creditsReserved,
    reason: "studio_task_reserve_refund",
    referenceId: taskId,
  });

  try {
    await db.insert(studioTask).values({
      id: taskId,
      userId,
      taskType,
      status: "queued",
      requestJson: stringifyJsonRecord(requestPayload),
      creditsReserved,
      idempotencyKey: normalizedIdempotencyKey,
      maxRetries,
      queuedAt: new Date(),
    });

    compensation.settle();

    const rows = await db.select().from(studioTask).where(eq(studioTask.id, taskId)).limit(1);
    const task = rows[0];
    if (!task) {
      throw new StudioTaskError("Failed to create task", 500);
    }

    await appendStudioTaskEvent(taskId, {
      eventType: "task_queued",
      payload: { taskType, creditsReserved },
      progress: 0,
    });

    return {
      created: true,
      task: {
        ...mapTaskRow(task),
        remainingCreditsAfterReserve: deductRemainingCredits,
      },
    };
  } catch (error) {
    await compensation.compensate();
    throw error;
  }
}

export async function listStudioTasksForUser(userId: string, params: StudioTaskListParams = {}) {
  const limit = normalizeLimit(params.limit);
  const clauses = [eq(studioTask.userId, userId)];

  if (params.status) {
    clauses.push(eq(studioTask.status, params.status));
  }

  if (params.taskType) {
    clauses.push(eq(studioTask.taskType, params.taskType));
  }

  const rows = await db
    .select()
    .from(studioTask)
    .where(and(...clauses))
    .orderBy(desc(studioTask.createdAt))
    .limit(limit);

  return rows.map(mapTaskRow);
}

export async function listStudioTasksForAdmin(params: StudioTaskListParams = {}) {
  const limit = normalizeLimit(params.limit);
  const clauses: Array<ReturnType<typeof eq>> = [];

  if (params.status) {
    clauses.push(eq(studioTask.status, params.status));
  }
  if (params.taskType) {
    clauses.push(eq(studioTask.taskType, params.taskType));
  }

  const rows = await db
    .select()
    .from(studioTask)
    .where(clauses.length > 0 ? and(...clauses) : undefined)
    .orderBy(desc(studioTask.createdAt))
    .limit(limit);

  return rows.map(mapTaskRow);
}

export async function getStudioTaskForUser(taskId: string, userId: string) {
  const rows = await db
    .select()
    .from(studioTask)
    .where(and(eq(studioTask.id, taskId), eq(studioTask.userId, userId)))
    .limit(1);

  return rows[0] ? mapTaskRow(rows[0]) : null;
}

export async function getStudioTaskById(taskId: string) {
  const rows = await db.select().from(studioTask).where(eq(studioTask.id, taskId)).limit(1);
  return rows[0] ? mapTaskRow(rows[0]) : null;
}

export async function getStudioTaskEvents(taskId: string, limit = 100) {
  const rows = await db
    .select()
    .from(studioTaskEvent)
    .where(eq(studioTaskEvent.taskId, taskId))
    .orderBy(asc(studioTaskEvent.createdAt))
    .limit(normalizeLimit(limit));

  return rows.map(row => ({
    ...row,
    payload: parseJsonRecord(row.payloadJson),
  }));
}

export async function markStudioTaskRunning(taskId: string) {
  await db
    .update(studioTask)
    .set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(studioTask.id, taskId));

  await appendStudioTaskEvent(taskId, {
    eventType: "task_running",
    progress: 5,
  });
}

async function adjustCreditsForSettlement(task: StudioTaskRow, creditsFinal: number) {
  const safeFinal = Math.max(0, creditsFinal);
  const refundable = Math.max(0, task.creditsReserved - safeFinal);
  const extraCharge = Math.max(0, safeFinal - task.creditsReserved);

  if (refundable > 0) {
    await refundCredits(task.userId, refundable, "studio_task_settlement_refund", task.id);
  }

  if (extraCharge > 0) {
    const extraChargeResult = await deductCredits(task.userId, extraCharge, "studio_task_extra_charge", task.id);
    if (!extraChargeResult.success) {
      throw new StudioTaskError("Failed to settle extra credits", 500);
    }
  }

  return {
    creditsFinal: safeFinal,
    creditsRefunded: refundable,
  };
}

export async function markStudioTaskCompleted({
  taskId,
  resultPayload,
  creditsFinal,
  status = "completed",
}: {
  taskId: string;
  resultPayload: StudioTaskResultPayload;
  creditsFinal: number;
  status?: Extract<StudioTaskStatus, "completed" | "partial_failed">;
}) {
  const rows = await db.select().from(studioTask).where(eq(studioTask.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw new StudioTaskError("Task not found", 404);
  }

  const settlement = await adjustCreditsForSettlement(task, creditsFinal);

  await db
    .update(studioTask)
    .set({
      status,
      resultJson: stringifyJsonRecord(resultPayload),
      creditsFinal: settlement.creditsFinal,
      creditsRefunded: settlement.creditsRefunded,
      completedAt: new Date(),
      updatedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(studioTask.id, taskId));

  await appendStudioTaskEvent(taskId, {
    eventType: status === "completed" ? "task_completed" : "task_partial_failed",
    payload: {
      creditsFinal: settlement.creditsFinal,
      creditsRefunded: settlement.creditsRefunded,
    },
    progress: 100,
  });
}

export async function markStudioTaskFailed({
  taskId,
  errorCode,
  errorMessage,
}: {
  taskId: string;
  errorCode?: string;
  errorMessage: string;
}) {
  const rows = await db.select().from(studioTask).where(eq(studioTask.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw new StudioTaskError("Task not found", 404);
  }

  const refundable = Math.max(0, task.creditsReserved - task.creditsRefunded);
  if (refundable > 0) {
    await refundCredits(task.userId, refundable, "studio_task_failed_refund", task.id);
  }

  await db
    .update(studioTask)
    .set({
      status: "failed",
      creditsFinal: 0,
      creditsRefunded: task.creditsRefunded + refundable,
      completedAt: new Date(),
      updatedAt: new Date(),
      errorCode: errorCode || "task_failed",
      errorMessage,
    })
    .where(eq(studioTask.id, taskId));

  await appendStudioTaskEvent(taskId, {
    eventType: "task_failed",
    payload: {
      errorCode: errorCode || "task_failed",
      errorMessage,
    },
    progress: 100,
  });
}

export async function cancelStudioTaskForUser(taskId: string, userId: string) {
  const rows = await db
    .select()
    .from(studioTask)
    .where(and(eq(studioTask.id, taskId), eq(studioTask.userId, userId)))
    .limit(1);
  const task = rows[0];
  if (!task) {
    throw new StudioTaskError("Task not found", 404);
  }

  if (task.status !== "queued" && task.status !== "running") {
    throw new StudioTaskError("Task cannot be canceled", 409);
  }

  const refundable = Math.max(0, task.creditsReserved - task.creditsRefunded);
  if (refundable > 0) {
    await refundCredits(task.userId, refundable, "studio_task_canceled_refund", task.id);
  }

  await db
    .update(studioTask)
    .set({
      status: "canceled",
      creditsFinal: 0,
      creditsRefunded: task.creditsRefunded + refundable,
      completedAt: new Date(),
      updatedAt: new Date(),
      errorCode: "task_canceled",
      errorMessage: "Task was canceled by user",
    })
    .where(eq(studioTask.id, taskId));

  await appendStudioTaskEvent(taskId, {
    eventType: "task_canceled",
    progress: 100,
  });

  const updatedRows = await db.select().from(studioTask).where(eq(studioTask.id, taskId)).limit(1);
  return updatedRows[0] ? mapTaskRow(updatedRows[0]) : null;
}

export async function claimQueuedStudioTasks(limit = 3) {
  return db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(studioTask)
      .where(eq(studioTask.status, "queued"))
      .orderBy(asc(studioTask.queuedAt))
      .limit(normalizeLimit(limit))
      .for("update", { skipLocked: true });

    if (rows.length === 0) {
      return [];
    }

    const taskIds = rows.map(row => row.id);
    await tx
      .update(studioTask)
      .set({
        status: "running",
        startedAt: sql`COALESCE(${studioTask.startedAt}, NOW())`,
        updatedAt: new Date(),
      })
      .where(inArray(studioTask.id, taskIds));

    return rows.map(mapTaskRow);
  });
}

/**
 * Reap tasks stuck in status=running where updated_at is older than `staleAfterMs`.
 * In short-lived task-runner mode (sistine default), a process crash mid-task leaves the row
 * status=running forever and the reserved credits locked. This sweeper restores invariants:
 *   - status: running → failed
 *   - errorCode/Message: task_stale_reaped / "Task reaped after no progress for Nm"
 *   - creditsFinal: 0
 *   - creditsRefunded: += remaining reservable amount (creditsReserved - creditsRefunded)
 *   - appends a `task_reaped` event
 *
 * Returns the list of reaped task ids and the total credits refunded.
 */
export async function reapStaleStudioTasks(options: {
  staleAfterMs?: number;
  maxBatch?: number;
} = {}) {
  const staleAfterMs = options.staleAfterMs ?? 10 * 60 * 1000;
  const maxBatch = Math.max(1, Math.min(100, options.maxBatch ?? 25));
  const cutoff = new Date(Date.now() - staleAfterMs);

  const candidates = await db
    .select()
    .from(studioTask)
    .where(and(eq(studioTask.status, "running"), lt(studioTask.updatedAt, cutoff)))
    .orderBy(asc(studioTask.updatedAt))
    .limit(maxBatch);

  const reaped: Array<{ taskId: string; userId: string; refunded: number }> = [];

  for (const row of candidates) {
    const refundable = Math.max(0, row.creditsReserved - row.creditsRefunded);
    if (refundable > 0) {
      await refundCredits(row.userId, refundable, "studio_task_stale_reaped", row.id);
    }

    await db
      .update(studioTask)
      .set({
        status: "failed",
        creditsFinal: 0,
        creditsRefunded: row.creditsRefunded + refundable,
        completedAt: new Date(),
        updatedAt: new Date(),
        errorCode: "task_stale_reaped",
        errorMessage: `Task reaped after no progress for ${Math.round(staleAfterMs / 60000)}m`,
      })
      .where(and(eq(studioTask.id, row.id), eq(studioTask.status, "running")));

    await appendStudioTaskEvent(row.id, {
      eventType: "task_reaped",
      progress: 100,
      payload: { staleAfterMs, refunded: refundable },
    });

    reaped.push({ taskId: row.id, userId: row.userId, refunded: refundable });
  }

  return {
    reaped,
    totalReaped: reaped.length,
    totalRefunded: reaped.reduce((sum, r) => sum + r.refunded, 0),
    cutoffIso: cutoff.toISOString(),
  };
}
