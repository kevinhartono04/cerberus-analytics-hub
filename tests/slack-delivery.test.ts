import { afterEach, describe, expect, it, vi } from "vitest";

import { isSlackDeliveryError, postSlackWebhookMessage } from "@/lib/slack-delivery";

describe("Slack delivery traces", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("does not send webhook requests during recovery", async () => {
    vi.stubEnv("CEREBRAL_RECOVERY_MODE", "true");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const trace = await postSlackWebhookMessage(["https://hooks.slack.com/services/secret"], '{}', "recovery");
    expect(trace.outcome).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records each destination's accepted status without retaining webhook URLs", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetch);

    const trace = await postSlackWebhookMessage(["https://hooks.slack.com/services/secret"], '{"text":"alert"}', "gameplay-alert-123", [{ jobKey: "count-job-123", sql: "select 1" }]);

    expect(trace).toMatchObject({ id: "gameplay-alert-123", outcome: "delivered", destinations: [{ destination: "webhook-1", outcome: "accepted", status: 200 }], queries: [{ jobKey: "count-job-123", sql: "select 1" }] });
    expect(JSON.stringify(trace)).not.toContain("hooks.slack.com");
  });

  it("allows explicitly resumed alerts while historical recovery remains active", async () => {
    vi.stubEnv("CEREBRAL_RECOVERY_MODE", "true");
    vi.stubEnv("CEREBRAL_ALERTS_PAUSED", "false");
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetch);
    expect((await postSlackWebhookMessage(["https://hooks.slack.com/services/test"], '{}', "resumed")).outcome).toBe("delivered");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retains the full trace when one destination rejects the alert", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetch);

    await expect(postSlackWebhookMessage(["https://hooks.slack.com/services/one", "https://hooks.slack.com/services/two"], '{"text":"alert"}', "gameplay-alert-456"))
      .rejects.toSatisfy((error: unknown) => isSlackDeliveryError(error) && error.trace.outcome === "failed" && error.trace.destinations[1].status === 429);
  });
});
