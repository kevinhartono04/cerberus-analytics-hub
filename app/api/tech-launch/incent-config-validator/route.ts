import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertCanUseTechLaunch, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { incentConfigValidatorRequestSchema, startIncentConfigValidator } from "@/lib/incent-config-validator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const body = incentConfigValidatorRequestSchema.parse(await request.json());
    await assertCanUseTechLaunch(user, body.appName);
    return NextResponse.json(await startIncentConfigValidator(body));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
