import { refundQueueStatus } from "@/lib/db";
import { workOne } from "@/lib/refund-review/worker";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  let processed = 0;
  try {
    while (Date.now() - started < 25000 && processed < 20 && await workOne()) processed++;
    return Response.json({ processed, ...await refundQueueStatus() });
  } catch { return Response.json({ error: "Refund worker failed", processed }, { status: 500 }); }
}
