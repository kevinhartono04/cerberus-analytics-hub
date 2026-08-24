import { NextResponse } from "next/server";

import { listGameplayAlertQueryJobs, markGameplayAlertQueryJobsSlackStatusDelivered, saveGameplayAlertQueryJobRecords, type GameplayAlertQueryJobRecord } from "@/lib/db";
import {
  alertsFromIncentConfigQuery,
  buildIncentConfigAlertSql,
  deliverIncentConfigAlerts,
  getIncentConfigAlertQuery,
  incentConfigAlertEvaluationHour,
  incentConfigAlertEvaluationKeyForHour,
  incentConfigAlertPreviousEvaluationHour,
  listIncentConfigAlertConfigurations,
  shouldSubmitIncentConfigAlert,
  submitIncentConfigAlertQuery,
} from "@/lib/incent-config-alerts";
import { isSlackDeliveryError, type SlackDeliveryTrace } from "@/lib/slack-delivery";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const configurations = await listIncentConfigAlertConfigurations();
  const currentEvaluationHour = incentConfigAlertEvaluationHour(now);
  const previousEvaluationHour = incentConfigAlertPreviousEvaluationHour(now);
  const keys = configurations.flatMap((configuration) => [
    incentConfigAlertEvaluationKeyForHour(configuration.appName, previousEvaluationHour),
    incentConfigAlertEvaluationKeyForHour(configuration.appName, currentEvaluationHour),
  ]);
  const existing = new Map((await listGameplayAlertQueryJobs(keys)).map((job) => [job.evaluationKey, job]));
  const updates: GameplayAlertQueryJobRecord[] = [];
  const failures: string[] = [];
  let submitted = 0;
  let completed = 0;
  let delivered = 0;
  const deliveryTrace: Array<SlackDeliveryTrace & { appName: string; evaluationHour: string }> = [];

  for (const configuration of configurations) {
    const evaluations = [
      { evaluationHour: previousEvaluationHour, submitIfMissing: false },
      { evaluationHour: currentEvaluationHour, submitIfMissing: shouldSubmitIncentConfigAlert(now) },
    ];
    for (const target of evaluations) {
      const evaluationKey = incentConfigAlertEvaluationKeyForHour(configuration.appName, target.evaluationHour);
      let job = existing.get(evaluationKey);
      try {
        if (!job && !target.submitIfMissing) continue;
        if (!job) {
          const query = await submitIncentConfigAlertQuery(configuration, now);
          submitted += 1;
          job = {
            evaluationKey,
            jobKey: query.job_key,
            filters: JSON.stringify({ appName: configuration.appName, evaluationHour: target.evaluationHour }),
            status: "running",
            submittedAt: now.toISOString(),
          };
          if (query.status === "error") {
            updates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: query.error ?? "Count query failed" });
            failures.push(`${configuration.appName}: ${query.error ?? "Count query failed"}`);
            continue;
          }
          if (query.status === "running") { updates.push(job); continue; }
        }
        const completedJob = job;
        if (!completedJob) continue;
        if (completedJob.status === "completed" && completedJob.slackStatusDeliveredAt) continue;
        const query = await getIncentConfigAlertQuery(completedJob.jobKey);
        if (query.status === "running") { updates.push(completedJob); continue; }
        if (query.status === "error") {
          updates.push({ ...completedJob, status: "error", completedAt: new Date().toISOString(), error: query.error ?? "Count query failed" });
          failures.push(`${configuration.appName}: ${query.error ?? "Count query failed"}`);
          continue;
        }
        const evaluation = alertsFromIncentConfigQuery(configuration, query, now, target.evaluationHour);
        const alerts = evaluation.alerts.map((alert) => ({
          ...alert,
          queryTrace: { jobKey: completedJob.jobKey, sql: query.compiled_sql ?? query.sql ?? buildIncentConfigAlertSql(configuration, new Date(completedJob.submittedAt)) },
        }));
        const delivery = await deliverIncentConfigAlerts(alerts);
        if (delivery.trace) deliveryTrace.push({ appName: configuration.appName, evaluationHour: target.evaluationHour, ...delivery.trace });
        if (delivery.configured) await markGameplayAlertQueryJobsSlackStatusDelivered([evaluationKey], new Date().toISOString());
        updates.push({ ...completedJob, status: "completed", completedAt: new Date().toISOString(), ...(delivery.configured ? { slackStatusDeliveredAt: new Date().toISOString() } : {}) });
        completed += 1;
        delivered += delivery.delivered;
      } catch (error) {
        if (isSlackDeliveryError(error)) deliveryTrace.push({ appName: configuration.appName, evaluationHour: target.evaluationHour, ...error.trace });
        failures.push(`${configuration.appName} (${target.evaluationHour}): ${error instanceof Error ? error.message : "evaluation failed"}`);
      }
    }
  }
  await saveGameplayAlertQueryJobRecords(updates);
  return NextResponse.json({ requestedAt: now.toISOString(), targetCount: configurations.length, submitted, completed, delivered, running: updates.filter((job) => job.status === "running").length, skippedSubmission: !shouldSubmitIncentConfigAlert(now), deliveryTrace, failures });
}
