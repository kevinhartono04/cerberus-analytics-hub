import { measureSenseTransfer } from "@/lib/ludios-sense-transfer";
import { senseJsonResponse } from "@/lib/ludios-sense-response";
import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getCachedSense, getSenseProgress, runSenseWorker } from "@/lib/ludios-sense";
import { senseRequestSchema } from "@/lib/ludios-sense-types";
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 300;
export async function POST(request: Request) {
  return measureSenseTransfer("cache",()=>handle(request));
}

async function handle(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const scan=await getCachedSense(senseRequestSchema.parse(await request.json()));
    if (scan?.status === "running" && scan.result?.reusedFrom && !scan.paused) after(()=>runSenseWorker(scan.jobKey,240000,true));
    return senseJsonResponse({scan:scan ? {...await getSenseProgress(scan.jobKey),cached:scan.cached} : null});
  } catch(error) {
    if(error instanceof ZodError) return NextResponse.json({error:"Choose a valid date and countries"},{status:400});
    return jsonError(error);
  }
}
