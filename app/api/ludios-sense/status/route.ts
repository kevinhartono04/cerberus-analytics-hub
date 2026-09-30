import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { advanceSense } from "@/lib/ludios-sense";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const { jobKey } = z.object({ jobKey: z.string().regex(/^sense:v1:[a-f0-9]{64}$/) }).parse(await request.json());
    return NextResponse.json(await advanceSense(jobKey));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
    return jsonError(error);
  }
}
