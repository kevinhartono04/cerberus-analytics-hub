import { NextResponse } from "next/server";

import { deliverGameplayAlertTransitions, getGameplayAlertSettings, reconcileGameplayAlerts } from "@/lib/gameplay-alerts";

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
  const settings = await getGameplayAlertSettings();
  const targets = settings.alertTargets.flatMap((target) => target.platforms.map((platform) => ({
    appName: target.appName,
    platform,
    appVersion: target.appVersion,
    ...range,
  })));
  const results = await Promise.allSettled(targets.map((target) => reconcileGameplayAlerts(target)));
  const transitions = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const target = targets[index];
    if (result.status === "fulfilled") {
      transitions.push(...result.value.transitions);
    } else {
      failures.push(`${target.appName} ${target.platform} ${target.appVersion}: ${result.reason instanceof Error ? result.reason.message : "evaluation failed"}`);
    }
  }

  let delivery: { delivered: number; skipped: number; configured: boolean } | undefined;
  try {
    delivery = await deliverGameplayAlertTransitions(transitions);
  } catch (error) {
    failures.push(`Slack: ${error instanceof Error ? error.message : "delivery failed"}`);
  }
  return NextResponse.json({ evaluatedAt: new Date().toISOString(), targetCount: targets.length, transitionCount: transitions.length, delivery, failures });
}
