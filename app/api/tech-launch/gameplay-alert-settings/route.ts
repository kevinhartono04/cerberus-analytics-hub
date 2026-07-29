import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { canManageUsers, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getGameplayAlertSettings, updateGameplayAlertSettings } from "@/lib/gameplay-alerts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireCurrentAppUser(request);
    return NextResponse.json(await getGameplayAlertSettings());
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    if (!canManageUsers(user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
    return NextResponse.json(await updateGameplayAlertSettings(await request.json(), user.id));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
