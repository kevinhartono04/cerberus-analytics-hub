import { NextResponse } from "next/server";

import { assertCanCreateSpec, assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getLibrarySnapshot } from "@/lib/db";
import { enhanceSpecWithAi, generateSpecFromRules } from "@/lib/generator";
import { intakeSchema } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    await assertCanCreateSpec(user);
    const body = await request.json();
    const intake = intakeSchema.parse(body);
    const baseSpec = generateSpecFromRules(intake, getLibrarySnapshot());
    const enhanced = await enhanceSpecWithAi(baseSpec);
    return NextResponse.json({
      ...enhanced.spec,
      meta: {
        aiUsed: enhanced.aiUsed,
        aiError: "aiError" in enhanced ? enhanced.aiError : undefined,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
