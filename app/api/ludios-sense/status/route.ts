import { measureSenseTransfer } from "@/lib/ludios-sense-transfer";
import { senseJsonResponse } from "@/lib/ludios-sense-response";
import { after, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSenseProgress, setSensePaused, runSenseWorker } from "@/lib/ludios-sense";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  return measureSenseTransfer("status",()=>handle(request));
}

async function handle(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const { jobKey, action } = z.object({ jobKey: z.string().regex(/^sense:v1:[a-f0-9]{64}$/), action: z.enum(["pause", "resume", "status"]).default("status") }).parse(await request.json());
    const result = action === "status" ? await getSenseProgress(jobKey) : await setSensePaused(jobKey, action === "pause");
    if (action === "resume" && result.status === "running") after(() => runSenseWorker(jobKey));
    return senseJsonResponse(result);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
    return jsonError(error);
  }
}
