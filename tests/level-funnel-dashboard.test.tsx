import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CerberusShell", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

import LevelFunnelDashboard from "@/components/LevelFunnelDashboard";

const filters = { appName: "stacksmash", platforms: ["android"], appVersions: ["0.2.0"], startDate: "2026-07-22", endDate: "2026-07-28" };
const pendingJobStorageKey = "tech-launch:level-funnel:pending-count-job";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function unavailableResult() {
  return {
    status: "unavailable",
    filters,
    settings: { normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50, alertTargets: [] },
    points: [],
    summary: { breachCount: 0, eligibleLevelCount: 0, unavailableReason: "No telemetry" },
    metadata: { executedAt: "2026-07-31T00:00:00.000Z" },
  };
}

function multiLayoutResult() {
  return {
    status: "completed",
    filters,
    settings: { normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50, alertTargets: [] },
    points: [
      { level: 10, layoutBankId: "bank-a", layoutHash: "hash-a", layoutShare: 1, layoutCoverage: 1, layoutAgeHours: 48, hasRecentActivity: true, layoutStable: true, layoutUpdatePending: false, difficultyTier: "normal", usedDifficultyFallback: false, reachedPlayers: 100, failedPlayers: 20, failRate: 0.2, threshold: 0.5, eligible: true, breached: false },
      { level: 10, layoutBankId: "bank-b", layoutHash: "hash-b", layoutShare: 1, layoutCoverage: 1, layoutAgeHours: 8, hasRecentActivity: true, layoutStable: false, layoutUpdatePending: true, difficultyTier: "normal", usedDifficultyFallback: false, reachedPlayers: 40, failedPlayers: 30, failRate: 0.75, threshold: 0.5, eligible: false, breached: false },
      { level: 11, layoutBankId: "retired-bank", layoutHash: "hash-old", layoutShare: 0, layoutCoverage: 1, layoutAgeHours: 240, hasRecentActivity: false, layoutStable: false, layoutUpdatePending: false, difficultyTier: "normal", usedDifficultyFallback: false, reachedPlayers: 200, failedPlayers: 120, failRate: 0.6, threshold: 0.5, eligible: false, breached: false },
    ],
    summary: { breachCount: 0, eligibleLevelCount: 1 },
    metadata: { executedAt: "2026-08-18T00:00:00.000Z" },
  };
}

describe("LevelFunnelDashboard Count polling", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    window.history.replaceState(null, "", "/tech-launch/level-funnel");
    window.sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, user: { role: "viewer" }, access: { techLaunchApps: ["stacksmash"] } }));
        if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "0.2.0", sampleCount: 100 }] }));
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  it("shows the Count job key, elapsed time, and a slow-query state while Count continues", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, user: { role: "viewer" }, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "0.2.0", sampleCount: 100 }] }));
      if (url === "/api/tech-launch/level-fail-rate") return Promise.resolve(jsonResponse({ status: "running", filters, metadata: { jobKey: "count-slow-42", submittedAt: new Date(Date.now() - 60_000).toISOString() }, pollAfterMs: 0 }));
      if (url === "/api/tech-launch/level-fail-rate/status") return new Promise<Response>(() => {});
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<LevelFunnelDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }));

    expect(await screen.findByText(/slow Count query/i)).toBeInTheDocument();
    expect(screen.getByText("count-slow-42")).toBeInTheDocument();
    expect(screen.getByText(/Elapsed: 1:0/)).toBeInTheDocument();
    expect(screen.getByText(/leave this page and return later/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(pendingJobStorageKey)).toContain("count-slow-42");
    fireEvent.click(screen.getByRole("button", { name: /stop waiting/i }));
    expect(await screen.findByText(/stopped waiting for the Count job/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(pendingJobStorageKey)).toBeNull();
  });

  it("resumes a saved Count job instead of submitting another query", async () => {
    window.history.replaceState(null, "", "/tech-launch/level-funnel?appName=stacksmash&platform=android&appVersion=0.2.0&startDate=2026-07-22&endDate=2026-07-28&run=1");
    window.sessionStorage.setItem(pendingJobStorageKey, JSON.stringify({ jobKey: "count-resume-7", filters, submittedAt: new Date().toISOString(), pollAfterMs: 0 }));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, user: { role: "viewer" }, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "0.2.0", sampleCount: 100 }] }));
      if (url === "/api/tech-launch/level-fail-rate/status") return Promise.resolve(jsonResponse(unavailableResult()));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<LevelFunnelDashboard />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tech-launch/level-fail-rate/status",
      expect.objectContaining({ body: JSON.stringify({ jobKey: "count-resume-7", filters }) }),
    ));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/tech-launch/level-fail-rate")).toBe(false);
    expect(window.sessionStorage.getItem(pendingJobStorageKey)).toBeNull();
  });

  it("uses the cache when Run is used for a window that includes today", async () => {
    const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = new Date();
    const start = new Date(today); start.setDate(start.getDate() - 7);
    const end = new Date(today); end.setDate(end.getDate() + 1);
    const startDate = formatDate(start);
    const endDate = formatDate(end);
    window.history.replaceState(null, "", `/tech-launch/level-funnel?appName=stacksmash&platform=android&appVersion=0.2.0&startDate=${startDate}&endDate=${endDate}`);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, user: { role: "viewer" }, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "0.2.0", sampleCount: 100 }] }));
      if (url === "/api/tech-launch/level-fail-rate") return Promise.resolve(jsonResponse(unavailableResult()));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<LevelFunnelDashboard />);
    await screen.findByText(endDate, { exact: false });
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) => String(input) === "/api/tech-launch/level-fail-rate");
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({ forceRefresh: false });
    });
  });

  it("shows the real-time critical alert policy alongside the daily configuration for admins", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, user: { role: "admin" }, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "0.2.0", sampleCount: 100 }] }));
      if (url === "/api/tech-launch/level-fail-rate") return Promise.resolve(jsonResponse(unavailableResult()));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<LevelFunnelDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }));
    fireEvent.click(await screen.findByText("Alert delivery and thresholds (admin)"));

    expect(await screen.findByRole("region", { name: "Real-time critical alert configuration" })).toBeInTheDocument();
    expect(screen.getByText("Runs every hour across the same Slack targets. A recovered level can alert again if it re-breaches.")).toBeInTheDocument();
    expect(screen.getByText(">70%")).toBeInTheDocument();
    expect(screen.getByText("Last 48h")).toBeInTheDocument();
    expect(screen.getByText(/Each target is used by both daily and real-time alerts/i)).toBeInTheDocument();
  });

  it("uses a scatter plot for concurrent layouts and hides inactive layout candidates by default", async () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, user: { role: "viewer" }, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "0.2.0", sampleCount: 100 }] }));
      if (url === "/api/tech-launch/level-fail-rate") return Promise.resolve(jsonResponse(multiLayoutResult()));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<LevelFunnelDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }));

    const chart = await screen.findByRole("img", { name: "Level fail rate layout scatter plot" });
    expect(screen.getByText("Each dot is a layout revision. Layouts on the same level are shown side-by-side.")).toBeInTheDocument();
    expect(chart.querySelector("path")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 1 inactive" })).toBeInTheDocument();
    expect([...chart.querySelectorAll("title")].some((title) => title.textContent?.includes("retired-bank"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Show 1 inactive" }));
    expect(screen.getByRole("button", { name: "Hide 1 inactive" })).toBeInTheDocument();
    expect([...chart.querySelectorAll("title")].some((title) => title.textContent?.includes("retired-bank"))).toBe(true);
  });
});
