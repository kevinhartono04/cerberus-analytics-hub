import { NextResponse } from "next/server";

import { listGameplayAlertQueryJobs, markGameplayAlertQueryJobsSlackStatusDelivered, saveGameplayAlertQueryJobRecords, type GameplayAlertQueryJobRecord } from "@/lib/db";
import {
  alertsFromIncentConfigQuery,
  deliverIncentConfigAlerts,
  getIncentConfigAlertQuery,
  incentConfigAlertEvaluationHour,
  incentConfigAlertEvaluationKeyForHour,
  incentConfigAlertPreviousEvaluationHour,
  listIncentConfigAlertConfigurations,
  shouldSubmitIncentConfigAlert,
  submitIncentConfigAlertQuery,
} from "@/lib/incent-config-alerts";

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
        if (job.status === "completed" && job.slackStatusDeliveredAt) continue;
        const query = await getIncentConfigAlertQuery(job.jobKey);
        if (query.status === "running") { updates.push(job); continue; }
        if (query.status === "error") {
          updates.push({ ...job, status: "error", completedAt: new Date().toISOString(), error: query.error ?? "Count query failed" });
          failures.push(`${configuration.appName}: ${query.error ?? "Count query failed"}`);
          continue;
        }
        const evaluation = alertsFromIncentConfigQuery(configuration, query, now, target.evaluationHour);
        const delivery = await deliverIncentConfigAlerts(evaluation.alerts);
        if (delivery.configured) await markGameplayAlertQueryJobsSlackStatusDelivered([evaluationKey], new Date().toISOString());
        updates.push({ ...job, status: "completed", completedAt: new Date().toISOString(), ...(delivery.configured ? { slackStatusDeliveredAt: new Date().toISOString() } : {}) });
        completed += 1;
        delivered += delivery.delivered;
      } catch (error) {
        failures.push(`${configuration.appName} (${target.evaluationHour}): ${error instanceof Error ? error.message : "evaluation failed"}`);
      }
    }
  }
  await saveGameplayAlertQueryJobRecords(updates);
  return NextResponse.json({ requestedAt: now.toISOString(), targetCount: configurations.length, submitted, completed, delivered, running: updates.filter((job) => job.status === "running").length, skippedSubmission: !shouldSubmitIncentConfigAlert(now), failures });
}
