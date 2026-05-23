import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioTask, user } from "@/lib/db/schema";

type UsageRow = {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  totalTasks: number;
  totalCreditsReserved: number;
  totalCreditsFinal: number;
  totalCreditsRefunded: number;
};

export default async function AdminStudioUsagePage() {
  const rows = (await db
    .select({
      userId: studioTask.userId,
      userName: user.name,
      userEmail: user.email,
      totalTasks: sql<number>`count(*)`,
      totalCreditsReserved: sql<number>`COALESCE(sum(${studioTask.creditsReserved}), 0)`,
      totalCreditsFinal: sql<number>`COALESCE(sum(${studioTask.creditsFinal}), 0)`,
      totalCreditsRefunded: sql<number>`COALESCE(sum(${studioTask.creditsRefunded}), 0)`,
    })
    .from(studioTask)
    .leftJoin(user, sql`${studioTask.userId} = ${user.id}`)
    .groupBy(studioTask.userId, user.name, user.email)
    .orderBy(sql`COALESCE(sum(${studioTask.creditsFinal}), 0) desc`)
    .limit(100)) as UsageRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Studio Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Credit consumption and task volume per user across studio workloads.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Tasks</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Reserved</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Final</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Refunded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.userId} className="border-b border-border/60">
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-card-foreground">{row.userName || "Unknown User"}</span>
                    <span className="text-xs text-muted-foreground">{row.userEmail || row.userId}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-card-foreground">{row.totalTasks}</td>
                <td className="px-3 py-2 text-right text-card-foreground">{row.totalCreditsReserved}</td>
                <td className="px-3 py-2 text-right text-card-foreground">{row.totalCreditsFinal}</td>
                <td className="px-3 py-2 text-right text-card-foreground">{row.totalCreditsRefunded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
