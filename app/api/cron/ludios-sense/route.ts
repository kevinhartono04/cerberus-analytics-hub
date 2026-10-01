import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { continuePendingSenseJobs } from "@/lib/ludios-sense";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") ?? "";
  if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ scans: await continuePendingSenseJobs() });
}
