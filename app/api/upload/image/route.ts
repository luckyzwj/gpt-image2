import { NextResponse } from "next/server";

// Deprecated 2026-05-23. Callers must migrate to /api/uploads/reference.
// This stub stays for one release cycle so existing integrations get a clear
// signal before the route disappears.
export async function POST() {
  return NextResponse.json(
    {
      error: "This endpoint has been removed. Use POST /api/uploads/reference instead (multi-file 'files' field).",
      migrateTo: "/api/uploads/reference",
    },
    { status: 410 },
  );
}
