import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getCachedSense } from "@/lib/ludios-sense";
import { senseRequestSchema } from "@/lib/ludios-sense-types";
export const runtime = "nodejs";
export async function POST(request:Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    return NextResponse.json({scan:await getCachedSense(senseRequestSchema.parse(await request.json()))});
  } catch(error) {
    if(error instanceof ZodError) return NextResponse.json({error:"Choose a valid date and countries"},{status:400});
    return jsonError(error);
  }
}
