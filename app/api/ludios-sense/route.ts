import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { startSense } from "@/lib/ludios-sense";
import { senseRequestSchema } from "@/lib/ludios-sense-types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    return NextResponse.json(await startSense(senseRequestSchema.parse(await request.json())));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
