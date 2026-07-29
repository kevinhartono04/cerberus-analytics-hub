import { NextResponse } from "next/server";

import { deliverGameplayAlertTransitions, reconcileGameplayAlerts } from "@/lib/gameplay-alerts";
import { getTechLaunchAppVersions, techLaunchAppOptions } from "@/lib/tech-launch";

export const runtime = "nodejs";

function dateRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = dateRange();
  const failures: string[] = [];
  const transitions = [];
  for (const appName of techLaunchAppOptions) {
    try {
      const versions = await getTechLaunchAppVersions({ appName, platform: "android", ...range });
      const appVersion = versions.versions[0]?.appVersion;
      if (!appVersion) continue;
      const result = await reconcileGameplayAlerts({ appName, platform: "android", appVersion, ...range });
      transitions.push(...result.transitions);
    } catch (error) {
      failures.push(`${appName}: ${error instanceof Error ? error.message : "evaluation failed"}`);
    }
  }

  let delivery: { delivered: number; skipped: number; configured: boolean } | undefined;
  try {
    delivery = await deliverGameplayAlertTransitions(transitions);
  } catch (error) {
    failures.push(`Slack: ${error instanceof Error ? error.message : "delivery failed"}`);
  }
  return NextResponse.json({ evaluatedAt: new Date().toISOString(), transitionCount: transitions.length, delivery, failures });
}
