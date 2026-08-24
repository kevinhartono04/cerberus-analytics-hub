import crypto from "node:crypto";

export type SlackQueryTrace = {
  jobKey: string;
  sql: string;
};

export type SlackDeliveryTrace = {
  id: string;
  attemptedAt: string;
  outcome: "delivered" | "skipped" | "failed";
  destinations: Array<{
    destination: string;
    outcome: "accepted" | "failed";
    status?: number;
  }>;
  queries: SlackQueryTrace[];
};

export class SlackDeliveryError extends Error {
  constructor(readonly trace: SlackDeliveryTrace) {
    super(`Slack delivery failed for ${trace.destinations.filter((destination) => destination.outcome === "failed").map((destination) => destination.destination).join(", ")}`);
    this.name = "SlackDeliveryError";
  }
}

export function isSlackDeliveryError(error: unknown): error is SlackDeliveryError {
  return error instanceof SlackDeliveryError;
}

export function newSlackDeliveryTraceId(scope: string) {
  return `${scope}-${crypto.randomUUID()}`;
}

/** Sends a payload to each configured Slack webhook without exposing webhook URLs. */
export async function postSlackWebhookMessage(webhooks: string[], body: string, traceId: string, queries: SlackQueryTrace[] = []): Promise<SlackDeliveryTrace> {
  const attemptedAt = new Date().toISOString();
  if (!webhooks.length) return { id: traceId, attemptedAt, outcome: "skipped", destinations: [], queries };

  const destinations = await Promise.all(webhooks.map(async (webhook, index) => {
    const destination = `webhook-${index + 1}`;
    try {
      const response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body });
      return response.ok
        ? { destination, outcome: "accepted" as const, status: response.status }
        : { destination, outcome: "failed" as const, status: response.status };
    } catch {
      return { destination, outcome: "failed" as const };
    }
  }));
  const trace: SlackDeliveryTrace = {
    id: traceId,
    attemptedAt,
    outcome: destinations.some((destination) => destination.outcome === "failed") ? "failed" : "delivered",
    destinations,
    queries,
  };
  if (trace.outcome === "failed") throw new SlackDeliveryError(trace);
  return trace;
}
