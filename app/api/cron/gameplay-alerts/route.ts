import { NextResponse } from "next/server";

import { getCountQuery, submitCountSql } from "@/lib/count-api";
import { listGameplayAlertQueryJobs, markGameplayAlertQueryJobsSlackStatusDelivered, saveGameplayAlertQueryJobRecords, type GameplayAlertQueryJobRecord } from "@/lib/db";
import {
  buildCriticalLevelFailRateSql,
  buildLevelFailRateSql,
  criticalGameplayAlertEvaluationKey,
  deliverGameplayAlertTransitions,
  gameplayAlertCronFilters,
  gameplayAlertEvaluationKey,
  getGameplayAlertSettings,
  openGameplayAlertStates,
  reconcileCriticalGameplayAlertsFromQuery,
  reconcileGameplayAlertsFromQuery,
  type GameplayAlertCronFilters,
  type GameplayAlertTransition,
  undeliveredGameplayAlertTransitions,
} from "@/lib/gameplay-alerts";
import { isGameplayAlertCronWindow } from "@/lib/gameplay-alert-cron-window";
import {
  adMetricAlertEvaluationKey,
  buildAdMetricAlertSql,
  deliverAdMetricAlertTransitions,
  reconcileAdMetricAlertsFromQuery,
  undeliveredAdMetricAlertTransitions,
  isAdMetricAlertCronWindow,
  type AdMetricAlertTransition,
} from "@/lib/ad-metric-alerts";

export const runtime = "nodejs";

type AlertTarget = GameplayAlertCronFilters;
type EvaluationResult = {
  transitions: GameplayAlertTransition[];
  jobUpdates: GameplayAlertQueryJobRecord[];
  failures: string[];
  submittedCount: number;
  completedCount: number;
  dailyStatusTargets: Array<{ evaluationKey: string; filters: AlertTarget }>;
};
type AdMetricEvaluationResult = Omit<EvaluationResult, "transitions"> & { transitions: AdMetricAlertTransition[] };

function emptyEvaluationResult(): EvaluationResult {
  return { transitions: [], jobUpdates: [], failures: [], submittedCount: 0, completedCount: 0, dailyStatusTargets: [] };
}

function uniqueTransitions<T extends { type: string; state: { alertKey: string } }>(transitions: T[]) {
  return [...new Map(transitions.map((transition) => [`${transition.type}:${transition.state.alertKey}`, transition])).values()];
}

function labelFor(filters: AlertTarget) {
  return `${filters.appName} ${filters.platform === "__all_platforms__" ? "all platforms" : filters.platform} ${filters.appVersion}`;
}

function dailyQueryFilters(filters: AlertTarget) {
  return {
    appName: filters.appName,
    platforms: filters.platforms,
    appVersions: filters.appVersions,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
}

/** The daily evaluator keeps a single auditable query per target and date range. */
async function evaluateDailyTargets(targets: AlertTarget[], existingByKey: Map<string, GameplayAlertQueryJobRecord>) {
  const result = emptyEvaluationResult();
  await Promise.all(targets.map(async (filters) => {
    const evaluationKey = gameplayAlertEvaluationKey(filters);
    const label = labelFor(filters);
    const queryFilters = dailyQueryFilters(filters);
    let job = existingByKey.get(evaluationKey);
    try {
      if (job?.status === "running") {
        const current = (await getCountQuery(job.jobKey, 1000)).query;
        if (current.status === "error") {
          result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: current.error ?? "Count query failed" });
          result.failures.push(`${label}: ${current.error ?? "Count query failed"}`);
          return;
        }
        if (current.status === "running") return;
        const reconciled = await reconcileGameplayAlertsFromQuery(filters, current, queryFilters);
        result.transitions.push(...reconciled.transitions);
        result.jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString(), error: undefined });
        if (!job.slackStatusDeliveredAt) result.dailyStatusTargets.push({ evaluationKey, filters });
        result.completedCount += 1;
        return;
      }

      if (job) {
        // A webhook failure must not lose the daily status alert. Reuse the
        // completed, auditable evaluation instead of submitting another query.
        if (job.status === "completed" && !job.slackStatusDeliveredAt) result.dailyStatusTargets.push({ evaluationKey, filters });
        return;
      }

      const submitted = (await submitCountSql(buildLevelFailRateSql(queryFilters), { cacheStrategy: "force" })).query;
      result.submittedCount += 1;
      job = { evaluationKey, jobKey: submitted.job_key, filters: JSON.stringify(filters), status: "running", submittedAt: new Date().toISOString() };
      if (submitted.status === "error") {
        result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: submitted.error ?? "Count query failed" });
        result.failures.push(`${label}: ${submitted.error ?? "Count query failed"}`);
        return;
      }
      if (submitted.status === "running") {
        result.jobUpdates.push(job);
        return;
      }
      const completed = (await getCountQuery(job.jobKey, 1000)).query;
      if (completed.status === "running") {
        result.jobUpdates.push(job);
        return;
      }
      if (completed.status === "error") {
        result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: completed.error ?? "Count query failed" });
        result.failures.push(`${label}: ${completed.error ?? "Count query failed"}`);
        return;
      }
      const reconciled = await reconcileGameplayAlertsFromQuery(filters, completed, queryFilters);
      result.transitions.push(...reconciled.transitions);
      result.jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString() });
      result.dailyStatusTargets.push({ evaluationKey, filters });
      result.completedCount += 1;
    } catch (error) {
      result.failures.push(`${label}: ${error instanceof Error ? error.message : "evaluation failed"}`);
    }
  }));
  return result;
}

/**
 * Critical evaluations intentionally replace a completed job on the next cron
 * invocation. This gives every target a fresh 48-hour query every 15 minutes
 * while retaining a single job record for asynchronous polling.
 */
async function evaluateCriticalTargets(targets: AlertTarget[], existingByKey: Map<string, GameplayAlertQueryJobRecord>) {
  const result = emptyEvaluationResult();
  await Promise.all(targets.map(async (filters) => {
    const evaluationKey = criticalGameplayAlertEvaluationKey(filters);
    const label = labelFor(filters);
    let job = existingByKey.get(evaluationKey);
    try {
      if (job?.status === "running") {
        const current = (await getCountQuery(job.jobKey, 1000)).query;
        if (current.status === "error") {
          result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: current.error ?? "Count query failed" });
          result.failures.push(`${label}: ${current.error ?? "Count query failed"}`);
          return;
        }
        if (current.status === "running") return;
        const reconciled = await reconcileCriticalGameplayAlertsFromQuery(filters, current);
        result.transitions.push(...reconciled.transitions);
        result.jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString(), error: undefined });
        result.completedCount += 1;
        return;
      }

      const submitted = (await submitCountSql(buildCriticalLevelFailRateSql(dailyQueryFilters(filters)), { cacheStrategy: "force" })).query;
      result.submittedCount += 1;
      job = { evaluationKey, jobKey: submitted.job_key, filters: JSON.stringify(filters), status: "running", submittedAt: new Date().toISOString() };
      if (submitted.status === "error") {
        result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: submitted.error ?? "Count query failed" });
        result.failures.push(`${label}: ${submitted.error ?? "Count query failed"}`);
        return;
      }
      if (submitted.status === "running") {
        result.jobUpdates.push(job);
        return;
      }
      const completed = (await getCountQuery(job.jobKey, 1000)).query;
      if (completed.status === "running") {
        result.jobUpdates.push(job);
        return;
      }
      if (completed.status === "error") {
        result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: completed.error ?? "Count query failed" });
        result.failures.push(`${label}: ${completed.error ?? "Count query failed"}`);
        return;
      }
      const reconciled = await reconcileCriticalGameplayAlertsFromQuery(filters, completed);
      result.transitions.push(...reconciled.transitions);
      result.jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString() });
      result.completedCount += 1;
    } catch (error) {
      result.failures.push(`${label}: ${error instanceof Error ? error.message : "evaluation failed"}`);
    }
  }));
  return result;
}

/** FIPG/RIPG are evaluated once per completed hour, using its prior twelve completed hours as the baseline. */
async function evaluateAdMetricTargets(targets: AlertTarget[], existingByKey: Map<string, GameplayAlertQueryJobRecord>, zScoreThreshold: number, now: Date, allowSubmission: boolean) {
  const result: AdMetricEvaluationResult = { ...emptyEvaluationResult(), transitions: [] };
  await Promise.all(targets.map(async (filters) => {
    const evaluationKey = adMetricAlertEvaluationKey(filters, now);
    const label = `${labelFor(filters)} ad metrics`;
    let job = existingByKey.get(evaluationKey);
    try {
      if (job?.status === "running") {
        const current = (await getCountQuery(job.jobKey, 1000)).query;
        if (current.status === "error") {
          result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: current.error ?? "Count query failed" });
          result.failures.push(`${label}: ${current.error ?? "Count query failed"}`);
          return;
        }
        if (current.status === "running") return;
        const reconciled = await reconcileAdMetricAlertsFromQuery(filters, current, zScoreThreshold, now);
        result.transitions.push(...reconciled.transitions);
        result.jobUpdates.push({ ...job, status: "completed", completedAt: new Date().toISOString(), error: undefined });
        result.completedCount += 1;
        return;
      }
      if (job || !allowSubmission) return;
      const submitted = (await submitCountSql(buildAdMetricAlertSql(filters, now), { cacheStrategy: "force" })).query;
      result.submittedCount += 1;
      job = { evaluationKey, jobKey: submitted.job_key, filters: JSON.stringify(filters), status: "running", submittedAt: new Date().toISOString() };
      if (submitted.status === "error") {
        result.jobUpdates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: submitted.error ?? "Count query failed" });
        result.failures.push(`${label}: ${submitted.error ?? "Count query failed"}`);
        return;
      }
      result.jobUpdates.push(job);
    } catch (error) {
      result.failures.push(`${label}: ${error instanceof Error ? error.message : "evaluation failed"}`);
    }
  }));
  return result;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const force = new URL(request.url).searchParams.get("force") === "1";
  const settings = await getGameplayAlertSettings();
  const targets = gameplayAlertCronFilters(settings);
  const shouldRunDaily = force || isGameplayAlertCronWindow(now);
  // This endpoint continues to run every 15 minutes for critical level alerts.
  // FIPG/RIPG submits new work only at :00; later invocations only poll it.
  const shouldSubmitHourlyAdMetrics = force || isAdMetricAlertCronWindow(now);
  const dailyKeys = shouldRunDaily ? targets.map(gameplayAlertEvaluationKey) : [];
  const criticalKeys = targets.map(criticalGameplayAlertEvaluationKey);
  const adMetricKeys = targets.map((filters) => adMetricAlertEvaluationKey(filters, now));
  const existingByKey = new Map((await listGameplayAlertQueryJobs([...dailyKeys, ...criticalKeys, ...adMetricKeys])).map((job) => [job.evaluationKey, job]));

  const [daily, critical, adMetrics] = await Promise.all([
    shouldRunDaily ? evaluateDailyTargets(targets, existingByKey) : Promise.resolve(emptyEvaluationResult()),
    evaluateCriticalTargets(targets, existingByKey),
    evaluateAdMetricTargets(targets, existingByKey, settings.adMetricZScoreThreshold, now, shouldSubmitHourlyAdMetrics),
  ]);
  await saveGameplayAlertQueryJobRecords([...daily.jobUpdates, ...critical.jobUpdates, ...adMetrics.jobUpdates]);

  const openStatesByEvaluationKey = new Map(await Promise.all((shouldRunDaily ? targets : []).map(async (filters) => [
    gameplayAlertEvaluationKey(filters),
    await openGameplayAlertStates(filters),
  ] as const)));
  const dailyStatusTransitions = daily.dailyStatusTargets.flatMap(({ evaluationKey }) =>
    (openStatesByEvaluationKey.get(evaluationKey) ?? []).map((state) => ({ type: "daily-open" as const, state })),
  );
  const dailyOpenKeys = new Set(dailyStatusTransitions.map((transition) => transition.state.alertKey));
  const dailyRetryTransitions = (await Promise.all((shouldRunDaily ? targets : []).map((filters) => undeliveredGameplayAlertTransitions(filters)))).flat();
  const criticalRetryTransitions = (await Promise.all(targets.map((filters) => undeliveredGameplayAlertTransitions(filters, "critical")))).flat();
  const adMetricRetryTransitions = (await Promise.all(targets.map(undeliveredAdMetricAlertTransitions))).flat();

  const failures = [...daily.failures, ...critical.failures];
  const deliveryParts: Array<{ delivered: number; skipped: number; configured: boolean }> = [];
  try {
    const delivery = await deliverGameplayAlertTransitions(uniqueTransitions([
      ...daily.transitions.filter((transition) => transition.type !== "opened" || !dailyOpenKeys.has(transition.state.alertKey)),
      ...dailyRetryTransitions.filter((transition) => transition.type !== "opened" || !dailyOpenKeys.has(transition.state.alertKey)),
      ...dailyStatusTransitions,
    ]));
    deliveryParts.push(delivery);
    if (delivery.configured) {
      await markGameplayAlertQueryJobsSlackStatusDelivered(daily.dailyStatusTargets.map((target) => target.evaluationKey), new Date().toISOString());
    }
  } catch (error) {
    failures.push(`Slack daily: ${error instanceof Error ? error.message : "delivery failed"}`);
  }
  try {
    deliveryParts.push(await deliverGameplayAlertTransitions(uniqueTransitions([
      ...critical.transitions,
      ...criticalRetryTransitions,
    ])));
  } catch (error) {
    failures.push(`Slack critical: ${error instanceof Error ? error.message : "delivery failed"}`);
  }
  try {
    deliveryParts.push(await deliverAdMetricAlertTransitions([
      ...adMetrics.transitions,
      ...adMetricRetryTransitions,
    ]));
  } catch (error) {
    failures.push(`Slack ad metrics: ${error instanceof Error ? error.message : "delivery failed"}`);
  }

  const jobFor = (key: string) => [...daily.jobUpdates, ...critical.jobUpdates, ...adMetrics.jobUpdates].find((job) => job.evaluationKey === key) ?? existingByKey.get(key);
  const dailyRunningCount = shouldRunDaily ? targets.filter((filters) => jobFor(gameplayAlertEvaluationKey(filters))?.status === "running").length : 0;
  const criticalRunningCount = targets.filter((filters) => jobFor(criticalGameplayAlertEvaluationKey(filters))?.status === "running").length;
  const adMetricRunningCount = targets.filter((filters) => jobFor(adMetricAlertEvaluationKey(filters, now))?.status === "running").length;
  const delivery = deliveryParts.length ? {
    delivered: deliveryParts.reduce((total, part) => total + part.delivered, 0),
    skipped: deliveryParts.reduce((total, part) => total + part.skipped, 0),
    configured: deliveryParts.some((part) => part.configured),
  } : undefined;
  const evaluations = targets.map((filters) => {
    const evaluationKey = gameplayAlertEvaluationKey(filters);
    const existing = existingByKey.get(evaluationKey);
    const job = jobFor(evaluationKey);
    return {
      appName: filters.appName,
      platforms: filters.platforms,
      appVersions: filters.appVersions,
      startDate: filters.startDate,
      endDate: filters.endDate,
      jobStatus: job?.status ?? "not_submitted",
      ...(job?.submittedAt ? { submittedAt: job.submittedAt } : {}),
      ...(job?.completedAt ? { completedAt: job.completedAt } : {}),
      reusedCompletedJob: existing?.status === "completed" && !daily.jobUpdates.some((update) => update.evaluationKey === evaluationKey),
      storedOpenCount: (openStatesByEvaluationKey.get(evaluationKey) ?? []).length,
    };
  });

  return NextResponse.json({
    requestedAt: new Date().toISOString(),
    targetCount: targets.length,
    dailySkipped: !shouldRunDaily,
    submittedCount: daily.submittedCount,
    completedCount: daily.completedCount,
    runningCount: dailyRunningCount,
    criticalSubmittedCount: critical.submittedCount,
    criticalCompletedCount: critical.completedCount,
    criticalRunningCount,
    adMetricSubmittedCount: adMetrics.submittedCount,
    adMetricCompletedCount: adMetrics.completedCount,
    adMetricRunningCount,
    adMetricHourlySubmissionSkipped: !shouldSubmitHourlyAdMetrics,
    transitionCount: daily.transitions.length,
    criticalTransitionCount: critical.transitions.length,
    adMetricTransitionCount: adMetrics.transitions.length,
    dailyOpenDeliveryCount: dailyStatusTransitions.length,
    delivery,
    failures,
    evaluations,
  });
}
