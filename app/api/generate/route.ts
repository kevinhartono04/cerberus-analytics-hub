import { NextResponse } from "next/server";

import { assertCanCreateSpec, assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getEventGenerationRecord, getLibrarySnapshot } from "@/lib/db";
import { enhanceSpecWithAi, generateSpecFromRules } from "@/lib/generator";
import { generateWithConfig, generationConfigSchema } from "@/lib/event-generation-config";
import { intakeSchema } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    await assertCanCreateSpec(user);
    const body = await request.json();
    const intake = intakeSchema.parse(body);
    const settings = await getEventGenerationRecord();
    const published = settings && settings.version > 0 ? generationConfigSchema.parse(settings.published) : null;
    const baseSpec = published ? generateWithConfig(intake, getLibrarySnapshot(), published, settings!.version) : { ...generateSpecFromRules(intake, getLibrarySnapshot()), generationTemplateVersion: 0 };
    // Published admin definitions are authoritative; AI must not rewrite them.
    const enhanced = published ? { spec: baseSpec, aiUsed: false } : await enhanceSpecWithAi(baseSpec);
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
