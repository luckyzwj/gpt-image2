import type { ReactNode } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioTask, user } from "@/lib/db/schema";

export default async function AdminStudioTasksPage() {
  const [tasks, stats] = await Promise.all([
    db
      .select({
        id: studioTask.id,
        userId: studioTask.userId,
        userEmail: user.email,
        userName: user.name,
        taskType: studioTask.taskType,
        status: studioTask.status,
        creditsReserved: studioTask.creditsReserved,
        creditsFinal: studioTask.creditsFinal,
        creditsRefunded: studioTask.creditsRefunded,
        errorMessage: studioTask.errorMessage,
        createdAt: studioTask.createdAt,
        updatedAt: studioTask.updatedAt,
      })
      .from(studioTask)
      .leftJoin(user, sql`${studioTask.userId} = ${user.id}`)
      .orderBy(sql`${studioTask.createdAt} desc`)
      .limit(120),
    db
      .select({
        totalTasks: sql<number>`count(*)`,
        queuedTasks: sql<number>`count(case when ${studioTask.status} = 'queued' then 1 end)`,
        runningTasks: sql<number>`count(case when ${studioTask.status} = 'running' then 1 end)`,
        failedTasks: sql<number>`count(case when ${studioTask.status} = 'failed' then 1 end)`,
        completedTasks: sql<number>`count(case when ${studioTask.status} in ('completed', 'partial_failed') then 1 end)`,
      })
      .from(studioTask),
  ]);

  const summary = stats[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Studio Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor queued, running, failed, and completed studio task execution.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard title="Total" value={summary.totalTasks} />
        <StatCard title="Queued" value={summary.queuedTasks} />
        <StatCard title="Running" value={summary.runningTasks} />
        <StatCard title="Completed" value={summary.completedTasks} />
        <StatCard title="Failed" value={summary.failedTasks} />
      </div>

      <div className="rounded-xl border border-border bg-background overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <Th>Task</Th>
              <Th>User</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th className="text-right">Reserved</Th>
              <Th className="text-right">Final</Th>
              <Th className="text-right">Refunded</Th>
              <Th>Error</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(task => (
              <tr key={task.id} className="border-b border-border/60">
                <Td className="font-mono text-xs">{task.id.slice(0, 12)}</Td>
                <Td>
                  <div className="flex flex-col">
                    <span>{task.userName || "Unknown User"}</span>
                    <span className="text-xs text-muted-foreground">{task.userEmail || task.userId}</span>
                  </div>
                </Td>
                <Td>{task.taskType}</Td>
                <Td>
                  <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {task.status}
                  </span>
                </Td>
                <Td className="text-right">{task.creditsReserved}</Td>
                <Td className="text-right">{task.creditsFinal}</Td>
                <Td className="text-right">{task.creditsRefunded}</Td>
                <Td className="max-w-xs truncate text-xs text-muted-foreground">{task.errorMessage || "-"}</Td>
                <Td className="text-xs text-muted-foreground">
                  {task.createdAt ? new Date(task.createdAt).toLocaleString("en-US") : "-"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground ${className || ""}`}>{children}</th>;
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-card-foreground ${className || ""}`}>{children}</td>;
}
