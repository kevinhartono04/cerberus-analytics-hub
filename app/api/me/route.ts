import { NextResponse } from "next/server";

import { getCurrentAppUser, isExternalAppUser, jsonError, techLaunchAppsForUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentAppUser(request);
    const techLaunchApps = user ? await techLaunchAppsForUser(user) : [];
    return NextResponse.json({
      authenticated: Boolean(user),
      user,
      access: user
        ? {
            accountType: isExternalAppUser(user) ? "external" : "internal",
            techLaunchApps,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
