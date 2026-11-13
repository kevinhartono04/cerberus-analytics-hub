import { measureSenseTransfer } from "@/lib/ludios-sense-transfer";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { jsonError } from "@/lib/auth";
import { requireSenseReportingUser } from "@/lib/ludios-sense-auth";
import { estimateSense } from "@/lib/ludios-sense";
import { senseRequestSchema } from "@/lib/ludios-sense-types";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return measureSenseTransfer("usage",()=>handle(request));
}

async function handle(request: Request) {
  try {
    await requireSenseReportingUser(request, "usage");
    return NextResponse.json(await estimateSense(senseRequestSchema.parse(await request.json())));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Select a valid date and at least one country" }, { status: 400 });
    return jsonError(error);
  }
}
