import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { startDailySense, runSenseWorker } from "@/lib/ludios-sense";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected=process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided=request.headers.get("authorization") ?? "";
  if(!expected || Buffer.byteLength(provided)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) return NextResponse.json({error:"Unauthorized"},{status:401});
  const run=await startDailySense();
  if(run.status==="running" && !run.paused) after(()=>runSenseWorker(run.jobKey));
  return NextResponse.json({jobKey:run.jobKey,status:run.status,cached:Boolean(run.cached)});
}
