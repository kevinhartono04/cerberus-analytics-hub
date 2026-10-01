import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { runSenseWorker, startSense } from "@/lib/ludios-sense";
import { senseRequestSchema } from "@/lib/ludios-sense-types";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const result = await startSense(senseRequestSchema.parse(await request.json()));
    if (result.status === "running") after(() => runSenseWorker(result.jobKey));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
