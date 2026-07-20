import { NextResponse } from "next/server";

import { addPermissions, assertCanCreateSpec, assertCanMutateSpec, assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { listSavedSpecs, saveSpec } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    const specs = await listSavedSpecs();
    return NextResponse.json(specs.map((spec) => addPermissions(spec, user)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    await assertCanCreateSpec(user);
    const body = await request.json();
    await assertCanMutateSpec(user, body.id);
    const saved = await saveSpec(body, user);
    return NextResponse.json(addPermissions(saved, user));
  } catch (error) {
    return jsonError(error);
  }
}
