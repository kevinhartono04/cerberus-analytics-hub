import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { POST } from "@/app/api/tech-launch/readiness/route";
import { POST as STATUS_POST } from "@/app/api/tech-launch/readiness/status/route";

const mocks = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  getReadinessStatus: vi.fn(),
  requireCurrentAppUser: vi.fn(),
}));

vi.mock("@/lib/tech-launch", () => ({
  getTechLaunchReadiness: mocks.getReadiness,
  getTechLaunchReadinessStatus: mocks.getReadinessStatus,
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentAppUser: mocks.requireCurrentAppUser,
  jsonError: (error: unknown) => {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  },
}));

const body = {
  appName: "wordblast",
  platform: "android",
  appVersion: "1.0.0",
  startDate: "2026-06-25",
  endDate: "2026-07-02",
};

function authedRequest(payload = body) {
  return new Request("http://localhost/api/tech-launch/readiness", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": "tech-launch-user",
      "x-test-user-email": "tech-launch-user@example.com",
      "x-test-user-name": "Tech Launch User",
      "x-test-user-role": "viewer",
    },
    body: JSON.stringify(payload),
  });
}

describe("Tech Launch readiness API", () => {
  beforeEach(() => {
    mocks.requireCurrentAppUser.mockReset().mockImplementation(async (request?: Request) => {
      const userId = request?.headers.get("x-test-user-id");
      const email = request?.headers.get("x-test-user-email");
      if (!userId || !email) {
        throw new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return { id: userId, email, name: email, role: "viewer", createdAt: "", updatedAt: "" };
    });
    mocks.getReadiness.mockReset().mockResolvedValue({
      filters: body,
      rows: [],
      summary: {
        overallVerdict: "insufficient data",
        metricCount: 0,
        greenCount: 0,
        yellowCount: 0,
        redCount: 0,
        insufficientCount: 0,
        totalSamples: 0,
      },
      metadata: { executedAt: "2026-07-02T00:00:00.000Z" },
      cache: { hit: false, key: "cache-key", expiresAt: "2026-07-02T00:15:00.000Z" },
    });
    mocks.getReadinessStatus.mockReset().mockResolvedValue({
      status: "running",
      filters: body,
      metadata: { jobKey: "job-key", submittedAt: "2026-07-02T00:00:00.000Z" },
      cache: { hit: false, key: "cache-key" },
      pollAfterMs: 1500,
    });
  });

  it("requires authentication", async () => {
    const response = await POST(
      new Request("http://localhost/api/tech-launch/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it("returns readiness data for authenticated viewers", async () => {
    const response = await POST(authedRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.cache.key).toBe("cache-key");
    expect(mocks.getReadiness).toHaveBeenCalledWith(body);
  });

  it("returns readiness status for authenticated viewers", async () => {
    const response = await STATUS_POST(
      authedRequest({
        jobKey: "job-key",
        filters: body,
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.metadata.jobKey).toBe("job-key");
    expect(mocks.getReadinessStatus).toHaveBeenCalledWith({ jobKey: "job-key", filters: body });
  });

  it("returns 400 for validation errors", async () => {
    mocks.getReadiness.mockRejectedValueOnce(new ZodError([]));

    const response = await POST(authedRequest());

    expect(response.status).toBe(400);
  });
});
