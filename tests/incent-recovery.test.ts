import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/incent-config-alerts/route";

afterEach(() => vi.unstubAllEnvs());

it("pauses incent cron before any database access", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("CEREBRAL_RECOVERY_MODE", "true");
  const response = await GET(new Request("https://example.com/api/cron/incent-config-alerts", { headers: { authorization: "Bearer test-secret" } }));
  expect(await response.json()).toMatchObject({ paused: true });
});

it("rejects unauthenticated incent cron calls during recovery", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("CEREBRAL_RECOVERY_MODE", "true");
  const response = await GET(new Request("https://example.com/api/cron/incent-config-alerts"));
  expect(response.status).toBe(401);
});
