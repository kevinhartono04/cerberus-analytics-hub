import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { canManageUsers, jsonError, requireCurrentAppUser, techLaunchAppsForUser } from "@/lib/auth";
import { listIncentConfigValidatorConfigurations, updateIncentConfigValidatorConfiguration } from "@/lib/incent-config-validator";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const allowedApps = new Set(await techLaunchAppsForUser(user));
    const configurations = (await listIncentConfigValidatorConfigurations()).filter((configuration) => allowedApps.has(configuration.appName as never));
    return NextResponse.json({ configurations });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    if (!canManageUsers(user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
    return NextResponse.json(await updateIncentConfigValidatorConfiguration(await request.json(), user.id));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
