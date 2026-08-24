import { NextResponse } from "next/server";

import { getCurrentAppUser, isExternalAppUser, jsonError, techLaunchAppsForUser } from "@/lib/auth";
import { launchSignalDashboardSuite } from "@/lib/launch-signal-access";
import { getExternalLaunchSignalAccess } from "@/lib/partner-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentAppUser(request);
    const externalAccess = user && isExternalAppUser(user) ? await getExternalLaunchSignalAccess(user.email) : null;
    const techLaunchApps = user ? externalAccess?.allowedApps ?? await techLaunchAppsForUser(user) : [];
    return NextResponse.json({
      authenticated: Boolean(user),
      user,
      access: user
        ? {
            accountType: isExternalAppUser(user) ? "external" : "internal",
            techLaunchApps,
            launchSignalDashboards: externalAccess?.dashboardSuite ?? (techLaunchApps.length ? launchSignalDashboardSuite : []),
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
