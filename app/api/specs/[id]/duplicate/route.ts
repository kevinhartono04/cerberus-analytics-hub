import { NextResponse } from "next/server";

import { addPermissions, assertCanCreateSpec, assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSavedSpec, saveSpec } from "@/lib/db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    await assertCanCreateSpec(user);

    const { id } = await context.params;
    const source = await getSavedSpec(id);
    if (!source) return NextResponse.json({ error: "Spec not found" }, { status: 404 });

    const duplicatedAt = new Date().toISOString();
    const duplicate = {
      ...source,
      id: crypto.randomUUID(),
      generatedAt: duplicatedAt,
      intake: {
        ...source.intake,
        gameTitle: `${source.intake.gameTitle} (Copy)`,
      },
    };
    const saved = await saveSpec(duplicate, user);
    return NextResponse.json(addPermissions(saved, user), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
