import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getCachedSense, runSenseWorker } from "@/lib/ludios-sense";
import { senseRequestSchema } from "@/lib/ludios-sense-types";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request:Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const scan=await getCachedSense(senseRequestSchema.parse(await request.json()));
    if (scan?.status === "running" && scan.result?.reusedFrom && !scan.paused) after(()=>runSenseWorker(scan.jobKey,240000,true));
    return NextResponse.json({scan});
  } catch(error) {
    if(error instanceof ZodError) return NextResponse.json({error:"Choose a valid date and countries"},{status:400});
    return jsonError(error);
  }
}
