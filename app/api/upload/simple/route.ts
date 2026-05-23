import { NextResponse } from "next/server";

// Deprecated 2026-05-23. Demo-only stub previously returned a test URL.
// Callers should migrate to /api/uploads/reference for real persistence.
export async function POST() {
  return NextResponse.json(
    {
      error: "This endpoint has been removed. Use POST /api/uploads/reference instead.",
      migrateTo: "/api/uploads/reference",
    },
    { status: 410 },
  );
}
