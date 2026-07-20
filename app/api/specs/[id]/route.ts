import { NextResponse } from "next/server";

import { addPermissions, assertCanCreateSpec, assertCanMutateSpec, assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { deleteSavedSpec, getSavedSpec, saveSpec } from "@/lib/db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const spec = await getSavedSpec(id);
  if (!spec) return NextResponse.json({ error: "Spec not found" }, { status: 404 });
  return NextResponse.json(spec);
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    await assertCanCreateSpec(user);
    const { id } = await context.params;
    const body = await request.json();
    if (body.id !== id) return NextResponse.json({ error: "Spec id mismatch" }, { status: 400 });
    await assertCanMutateSpec(user, id);
    const saved = await saveSpec(body, user);
    return NextResponse.json(addPermissions(saved, user));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    const { id } = await context.params;
    const existing = await assertCanMutateSpec(user, id);
    if (!existing) return NextResponse.json({ error: "Spec not found" }, { status: 404 });
    const deleted = await deleteSavedSpec(id);
    if (!deleted) return NextResponse.json({ error: "Spec not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
