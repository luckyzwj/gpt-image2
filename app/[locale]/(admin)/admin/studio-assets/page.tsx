import type { ReactNode } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { studioAsset, user } from "@/lib/db/schema";

export default async function AdminStudioAssetsPage() {
  const [assets, stats] = await Promise.all([
    db
      .select({
        id: studioAsset.id,
        taskId: studioAsset.taskId,
        userId: studioAsset.userId,
        userEmail: user.email,
        userName: user.name,
        assetType: studioAsset.assetType,
        publicUrl: studioAsset.publicUrl,
        mimeType: studioAsset.mimeType,
        sizeBytes: studioAsset.sizeBytes,
        createdAt: studioAsset.createdAt,
      })
      .from(studioAsset)
      .leftJoin(user, sql`${studioAsset.userId} = ${user.id}`)
      .orderBy(sql`${studioAsset.createdAt} desc`)
      .limit(200),
    db
      .select({
        totalAssets: sql<number>`count(*)`,
        totalImages: sql<number>`count(case when ${studioAsset.assetType} = 'image' then 1 end)`,
        totalVideos: sql<number>`count(case when ${studioAsset.assetType} = 'video' then 1 end)`,
      })
      .from(studioAsset),
  ]);

  const summary = stats[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Studio Assets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse generated assets and verify output URLs from studio tasks.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Assets" value={summary.totalAssets} />
        <StatCard title="Images" value={summary.totalImages} />
        <StatCard title="Videos" value={summary.totalVideos} />
      </div>

      <div className="rounded-xl border border-border bg-background overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <Th>Asset</Th>
              <Th>User</Th>
              <Th>Type</Th>
              <Th>Task</Th>
              <Th>Size</Th>
              <Th>URL</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {assets.map(asset => (
              <tr key={asset.id} className="border-b border-border/60">
                <Td className="font-mono text-xs">{asset.id.slice(0, 10)}</Td>
                <Td>
                  <div className="flex flex-col">
                    <span>{asset.userName || "Unknown User"}</span>
                    <span className="text-xs text-muted-foreground">{asset.userEmail || asset.userId}</span>
                  </div>
                </Td>
                <Td>{asset.assetType}</Td>
                <Td className="font-mono text-xs">{asset.taskId ? asset.taskId.slice(0, 10) : "-"}</Td>
                <Td>{asset.sizeBytes ? `${Math.round(asset.sizeBytes / 1024)} KB` : "-"}</Td>
                <Td className="max-w-sm truncate">
                  <a href={asset.publicUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                    Open
                  </a>
                </Td>
                <Td className="text-xs text-muted-foreground">
                  {asset.createdAt ? new Date(asset.createdAt).toLocaleString("en-US") : "-"}
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
