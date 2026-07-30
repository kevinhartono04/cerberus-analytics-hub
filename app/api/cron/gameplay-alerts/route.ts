import { NextResponse } from "next/server";

import { getCountQuery, submitCountSql } from "@/lib/count-api";
import { listGameplayAlertQueryJobs, saveGameplayAlertQueryJobRecords, type GameplayAlertQueryJobRecord } from "@/lib/db";
import {
  buildLevelFailRateSql,
  deliverGameplayAlertTransitions,
  gameplayAlertCronFilters,
  gameplayAlertEvaluationKey,
  getGameplayAlertSettings,
  reconcileGameplayAlertsFromQuery,
  type GameplayAlertTransition,
  undeliveredGameplayAlertTransitions,
} from "@/lib/gameplay-alerts";

export const runtime = "nodejs";

function uniqueTransitions<T extends { type: string; state: { alertKey: string } }>(transitions: T[]) {
  return [...new Map(transitions.map((transition) => [`${transition.type}:${transition.state.alertKey}`, transition])).values()];
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getGameplayAlertSettings();
  const targets = gameplayAlertCronFilters(settings);
  const existingByKey = new Map((await listGameplayAlertQueryJobs(targets.map(gameplayAlertEvaluationKey))).map((job) => [job.evaluationKey, job]));
  const failures: string[] = [];
  const transitions: GameplayAlertTransition[] = [];
  const jobUpdates: GameplayAlertQueryJobRecord[] = [];
  let submittedCount = 0;
  let completedCount = 0;

  await Promise.all(targets.map(async (filters) => {
    const evaluationKey = gameplayAlertEvaluationKey(filters);
    const label = `${filters.appName} ${filters.platform} ${filters.appVersion}`;
    let job = existingByKey.get(evaluationKey);
    try {
      if (job?.status === "running") {
        const current = (await getCountQuery(job.jobKey, 1000)).query;
        if (current.status === "error") {
          jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: current.error ?? "Count query failed" });
          failures.push(`${label}: ${current.error ?? "Count query failed"}`);
          return;
        }
        if (current.status === "running") return;
        const result = await reconcileGameplayAlertsFromQuery(filters, current);
        transitions.push(...result.transitions);
        jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString(), error: undefined });
        completedCount += 1;
        return;
      }

      // One evaluation per configured target and complete seven-day range. A
      // new range gets a new key tomorrow; failed jobs remain auditable rather
      // than being repeatedly re-submitted every five minutes.
      if (job) return;

      const submitted = (await submitCountSql(buildLevelFailRateSql(filters), { cacheStrategy: "default" })).query;
      submittedCount += 1;
      job = { evaluationKey, jobKey: submitted.job_key, filters: JSON.stringify(filters), status: "running", submittedAt: new Date().toISOString() };
      if (submitted.status === "error") {
        jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: submitted.error ?? "Count query failed" });
        failures.push(`${label}: ${submitted.error ?? "Count query failed"}`);
        return;
      }
      if (submitted.status === "running") {
        jobUpdates.push(job);
        return;
      }
      const completed = (await getCountQuery(job.jobKey, 1000)).query;
      if (completed.status === "running") {
        jobUpdates.push(job);
        return;
      }
      if (completed.status === "error") {
        jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: completed.error ?? "Count query failed" });
        failures.push(`${label}: ${completed.error ?? "Count query failed"}`);
        return;
      }
      const result = await reconcileGameplayAlertsFromQuery(filters, completed);
      transitions.push(...result.transitions);
      jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString() });
      completedCount += 1;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : "evaluation failed"}`);
    }
  }));

  await saveGameplayAlertQueryJobRecords(jobUpdates);
  const retryTransitions = (await Promise.all(targets.map((filters) => undeliveredGameplayAlertTransitions(filters)))).flat();
  let delivery: { delivered: number; skipped: number; configured: boolean } | undefined;
  try {
    delivery = await deliverGameplayAlertTransitions(uniqueTransitions([...transitions, ...retryTransitions]));
  } catch (error) {
    failures.push(`Slack: ${error instanceof Error ? error.message : "delivery failed"}`);
  }

  const runningCount = targets.filter((filters) => {
    const key = gameplayAlertEvaluationKey(filters);
    return (jobUpdates.find((job) => job.evaluationKey === key) ?? existingByKey.get(key))?.status === "running";
  }).length;
  return NextResponse.json({ evaluatedAt: new Date().toISOString(), targetCount: targets.length, submittedCount, completedCount, runningCount, transitionCount: transitions.length, delivery, failures });
}
