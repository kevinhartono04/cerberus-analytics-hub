import { NextResponse } from "next/server";

import { getCountQuery, submitCountSql } from "@/lib/count-api";
import { listGameplayAlertQueryJobs, markGameplayAlertQueryJobsSlackStatusDelivered, saveGameplayAlertQueryJobRecords, type GameplayAlertQueryJobRecord } from "@/lib/db";
import {
  buildLevelFailRateSql,
  deliverGameplayAlertTransitions,
  gameplayAlertCronFilters,
  gameplayAlertEvaluationKey,
  getGameplayAlertSettings,
  openGameplayAlertStates,
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
  const dailyStatusTargets: Array<{ evaluationKey: string; filters: typeof targets[number] }> = [];
  const jobUpdates: GameplayAlertQueryJobRecord[] = [];
  let submittedCount = 0;
  let completedCount = 0;

  await Promise.all(targets.map(async (filters) => {
    const evaluationKey = gameplayAlertEvaluationKey(filters);
    const label = `${filters.appName} ${filters.platform === "__all_platforms__" ? "all platforms" : filters.platform} ${filters.appVersion}`;
    const queryFilters = {
      appName: filters.appName,
      platforms: filters.platforms,
      appVersions: filters.appVersions,
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
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
        const result = await reconcileGameplayAlertsFromQuery(filters, current, queryFilters);
        transitions.push(...result.transitions);
        jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString(), error: undefined });
        if (!job.slackStatusDeliveredAt) dailyStatusTargets.push({ evaluationKey, filters });
        completedCount += 1;
        return;
      }

      // One evaluation per configured target and rolling seven-day range ending
      // today. A new range gets a new key tomorrow; failed jobs remain
      // auditable rather than being repeatedly re-submitted every five minutes.
      if (job) {
        // A webhook failure must not lose the daily status alert. Reuse the
        // completed, auditable evaluation instead of submitting another query.
        if (job.status === "completed" && !job.slackStatusDeliveredAt) dailyStatusTargets.push({ evaluationKey, filters });
        return;
      }

      // Scheduled alerts must reflect all telemetry available when the job is
      // submitted, rather than a reusable Count cache from an earlier check.
      const submitted = (await submitCountSql(buildLevelFailRateSql(queryFilters), { cacheStrategy: "force" })).query;
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
      const result = await reconcileGameplayAlertsFromQuery(filters, completed, queryFilters);
      transitions.push(...result.transitions);
      jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString() });
      dailyStatusTargets.push({ evaluationKey, filters });
      completedCount += 1;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : "evaluation failed"}`);
    }
  }));

  await saveGameplayAlertQueryJobRecords(jobUpdates);
  const openStatesByEvaluationKey = new Map(await Promise.all(targets.map(async (filters) => [
    gameplayAlertEvaluationKey(filters),
    await openGameplayAlertStates(filters),
  ] as const)));
  const dailyStatusTransitions = dailyStatusTargets.flatMap(({ evaluationKey }) =>
    (openStatesByEvaluationKey.get(evaluationKey) ?? []).map((state) => ({ type: "daily-open" as const, state })),
  );
  const dailyOpenKeys = new Set(dailyStatusTransitions.map((transition) => transition.state.alertKey));
  const retryTransitions = (await Promise.all(targets.map((filters) => undeliveredGameplayAlertTransitions(filters)))).flat();
  let delivery: { delivered: number; skipped: number; configured: boolean } | undefined;
  try {
    // A just-opened level is represented once as CURRENT OPEN in the daily
    // status, while still marking its opening delivery as confirmed.
    delivery = await deliverGameplayAlertTransitions(uniqueTransitions([
      ...transitions.filter((transition) => transition.type !== "opened" || !dailyOpenKeys.has(transition.state.alertKey)),
      ...retryTransitions.filter((transition) => transition.type !== "opened" || !dailyOpenKeys.has(transition.state.alertKey)),
      ...dailyStatusTransitions,
    ]));
    if (delivery.configured) {
      await markGameplayAlertQueryJobsSlackStatusDelivered(dailyStatusTargets.map((target) => target.evaluationKey), new Date().toISOString());
    }
  } catch (error) {
    failures.push(`Slack: ${error instanceof Error ? error.message : "delivery failed"}`);
  }

  const runningCount = targets.filter((filters) => {
    const key = gameplayAlertEvaluationKey(filters);
    return (jobUpdates.find((job) => job.evaluationKey === key) ?? existingByKey.get(key))?.status === "running";
  }).length;
  const evaluations = targets.map((filters) => {
    const evaluationKey = gameplayAlertEvaluationKey(filters);
    const existing = existingByKey.get(evaluationKey);
    const update = jobUpdates.find((job) => job.evaluationKey === evaluationKey);
    const job = update ?? existing;
    return {
      appName: filters.appName,
      platforms: filters.platforms,
      appVersions: filters.appVersions,
      startDate: filters.startDate,
      endDate: filters.endDate,
      jobStatus: job?.status ?? "not_submitted",
      ...(job?.submittedAt ? { submittedAt: job.submittedAt } : {}),
      ...(job?.completedAt ? { completedAt: job.completedAt } : {}),
      reusedCompletedJob: existing?.status === "completed" && !update,
      storedOpenCount: (openStatesByEvaluationKey.get(evaluationKey) ?? []).length,
    };
  });
  return NextResponse.json({
    requestedAt: new Date().toISOString(),
    targetCount: targets.length,
    submittedCount,
    completedCount,
    runningCount,
    transitionCount: transitions.length,
    dailyOpenDeliveryCount: dailyStatusTransitions.length,
    delivery,
    failures,
    evaluations,
  });
}
