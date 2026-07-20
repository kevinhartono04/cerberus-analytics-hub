import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { POST as APP_VERSIONS_POST } from "@/app/api/spec-check/app-versions/route";
import { POST } from "@/app/api/spec-check/route";
import { POST as STATUS_POST } from "@/app/api/spec-check/status/route";

const mocks = vi.hoisted(() => ({
  getSpecCheck: vi.fn(),
  getSpecCheckStatus: vi.fn(),
  getSpecCheckAppVersions: vi.fn(),
  requireCurrentAppUser: vi.fn(),
  assertInternalAppUser: vi.fn(),
}));

vi.mock("@/lib/spec-check", () => ({
  getSpecCheck: mocks.getSpecCheck,
  getSpecCheckStatus: mocks.getSpecCheckStatus,
  getSpecCheckAppVersions: mocks.getSpecCheckAppVersions,
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentAppUser: mocks.requireCurrentAppUser,
  assertInternalAppUser: mocks.assertInternalAppUser,
  jsonError: (error: unknown) => {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  },
}));

const body = {
  specId: "spec-1",
  appName: "bloomsort",
  platform: "all",
  appVersion: "0.04.13",
  startDate: "2026-07-01",
  endDate: "2026-07-07",
};

function request(url: string, payload: unknown, authed = true) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authed
        ? {
            "x-test-user-id": "spec-check-user",
            "x-test-user-email": "spec-check-user@example.com",
            "x-test-user-name": "Spec Check User",
            "x-test-user-role": "viewer",
          }
        : {}),
    },
    body: JSON.stringify(payload),
  });
}

describe("Spec Check API", () => {
  beforeEach(() => {
    mocks.assertInternalAppUser.mockReset();
    mocks.requireCurrentAppUser.mockReset().mockImplementation(async (req?: Request) => {
      const userId = req?.headers.get("x-test-user-id");
      const email = req?.headers.get("x-test-user-email");
      if (!userId || !email) {
        throw new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return { id: userId, email, name: email, role: "viewer", createdAt: "", updatedAt: "" };
    });
    mocks.getSpecCheck.mockReset().mockResolvedValue({
      status: "completed",
      filters: body,
      spec: { id: "spec-1", gameTitle: "Fixture Game", updatedAt: "2026-07-02T00:00:00.000Z" },
      report: { summary: { verdict: "pass" }, findings: [], events: [], truncated: false },
      metadata: { executedAt: "2026-07-07T00:00:00.000Z" },
      cache: { hit: false, key: "spec-check:key", expiresAt: "2026-07-07T00:15:00.000Z" },
    });
    mocks.getSpecCheckStatus.mockReset().mockResolvedValue({
      status: "running",
      filters: body,
      spec: { id: "spec-1", gameTitle: "Fixture Game", updatedAt: "2026-07-02T00:00:00.000Z" },
      metadata: { jobKey: "job_1", submittedAt: "2026-07-07T00:00:00.000Z" },
      cache: { hit: false, key: "spec-check:key" },
      pollAfterMs: 1500,
    });
    mocks.getSpecCheckAppVersions.mockReset().mockResolvedValue({
      filters: { appName: "bloomsort", platform: "all", startDate: "2026-07-01", endDate: "2026-07-07" },
      versions: [],
      metadata: { executedAt: "2026-07-07T00:00:00.000Z" },
      cache: { hit: false, key: "spec-check:app-versions:key", expiresAt: "2026-07-07T01:00:00.000Z" },
    });
  });

  it("rejects unauthenticated requests on all routes", async () => {
    const responses = await Promise.all([
      POST(request("http://localhost/api/spec-check", body, false)),
      STATUS_POST(request("http://localhost/api/spec-check/status", { jobKey: "j", filters: body }, false)),
      APP_VERSIONS_POST(request("http://localhost/api/spec-check/app-versions", body, false)),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    expect(mocks.getSpecCheck).not.toHaveBeenCalled();
    expect(mocks.getSpecCheckStatus).not.toHaveBeenCalled();
    expect(mocks.getSpecCheckAppVersions).not.toHaveBeenCalled();
  });

  it("returns the spec check result for an authenticated request", async () => {
    const response = await POST(request("http://localhost/api/spec-check", body));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("completed");
    expect(payload.report.summary.verdict).toBe("pass");
    expect(mocks.getSpecCheck).toHaveBeenCalledWith(body);
  });

  it("passes status requests through", async () => {
    const statusBody = { jobKey: "job_1", filters: body };
    const response = await STATUS_POST(request("http://localhost/api/spec-check/status", statusBody));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("running");
    expect(payload.pollAfterMs).toBe(1500);
    expect(mocks.getSpecCheckStatus).toHaveBeenCalledWith(statusBody);
  });

  it("translates validation errors into 400 responses", async () => {
    mocks.getSpecCheck.mockRejectedValue(
      new ZodError([
        { code: "custom", message: "End date must be on or after start date", path: ["endDate"] },
      ]),
    );
    const response = await POST(request("http://localhost/api/spec-check", { ...body, endDate: "2026-06-01" }));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("End date");
  });

  it("passes through thrown Response errors such as spec 404s", async () => {
    mocks.getSpecCheck.mockRejectedValue(
      new Response(JSON.stringify({ error: "Spec not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const response = await POST(request("http://localhost/api/spec-check", body));
    expect(response.status).toBe(404);
  });

  it("returns app versions", async () => {
    const versionsBody = { appName: "bloomsort", platform: "all", startDate: "2026-07-01", endDate: "2026-07-07" };
    const response = await APP_VERSIONS_POST(request("http://localhost/api/spec-check/app-versions", versionsBody));
    expect(response.status).toBe(200);
    expect(mocks.getSpecCheckAppVersions).toHaveBeenCalledWith(versionsBody);
  });
});
