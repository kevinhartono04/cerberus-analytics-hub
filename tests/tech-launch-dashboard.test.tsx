import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CerberusShell", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

import TechLaunchDashboard from "@/components/TechLaunchDashboard";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

const readinessSessionKey = "cerberus.tech-launch.snapshot.v1";
const readinessFilters = { appName: "wordblast", platform: "android", appVersion: "4.19.0", startDate: "2026-07-01", endDate: "2026-07-07" };

function completedReadiness() {
  return {
    status: "completed",
    filters: readinessFilters,
    rows: [],
    summary: { overallVerdict: "insufficient data", metricCount: 0, greenCount: 0, yellowCount: 0, redCount: 0, insufficientCount: 0, totalSamples: 0 },
    metadata: { executedAt: "2026-07-31T00:00:00.000Z" },
    cache: { hit: false, key: "readiness", expiresAt: "2026-07-31T01:00:00.000Z" },
  };
}

describe("TechLaunchDashboard comparison mode", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    window.history.replaceState(null, "", "/tech-launch");
    const storage = new Map<string, string>();
    const browserStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: browserStorage,
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: browserStorage,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/me") {
          return Promise.resolve(jsonResponse({ authenticated: true, access: { accountType: "internal", techLaunchApps: ["wordblast", "sizzle"] } }));
        }
        if (url === "/api/tech-launch/app-versions") {
          return Promise.resolve(
            jsonResponse({
              versions: [
                { appVersion: "4.19.0", sampleCount: 200, firstSeen: "2026-07-01", lastSeen: "2026-07-09" },
                { appVersion: "4.18.0", sampleCount: 100, firstSeen: "2026-07-01", lastSeen: "2026-07-08" },
              ],
              cache: { hit: false, key: "versions", expiresAt: "2026-07-10T00:00:00.000Z" },
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  it("enables comparison, preselects a reference version, and persists the pair in the URL", async () => {
    render(<TechLaunchDashboard />);

    const toggle = await screen.findByRole("switch", { name: /toggle comparison mode/i });
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByLabelText("Compare version")).toHaveValue("4.19.0"));
    await waitFor(() => expect(window.location.search).toContain("compare=1"));
    expect(window.location.search).toContain("compareAppName=wordblast");
    expect(window.location.search).toContain("compareAppVersion=4.19.0");
  });

  it("disables a duplicate baseline and comparison version pair", async () => {
    render(<TechLaunchDashboard />);

    const baseline = await screen.findByRole("combobox", { name: /version/i });
    fireEvent.change(baseline, { target: { value: "4.19.0" } });
    fireEvent.click(screen.getByRole("switch", { name: /toggle comparison mode/i }));

    await waitFor(() => expect(screen.getByLabelText("Compare version")).toHaveValue("4.18.0"));
    fireEvent.change(screen.getByLabelText("Compare version"), { target: { value: "4.19.0" } });
    expect(screen.getByText("Choose a different app or version")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();
  });

  it("shows a clear slow Count state with elapsed time and its job key", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, access: { accountType: "internal", techLaunchApps: ["wordblast"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "4.19.0", sampleCount: 200, firstSeen: "2026-07-01", lastSeen: "2026-07-09" }], cache: { hit: false, key: "versions", expiresAt: "2026-07-10T00:00:00.000Z" } }));
      if (url === "/api/tech-launch/readiness") return Promise.resolve(jsonResponse({ status: "running", filters: readinessFilters, metadata: { jobKey: "readiness-slow-42", submittedAt: new Date(Date.now() - 60_000).toISOString() }, cache: { hit: false, key: "readiness" }, pollAfterMs: 0 }));
      if (url === "/api/tech-launch/readiness/status") return new Promise<Response>(() => {});
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<TechLaunchDashboard />);
    fireEvent.change(await screen.findByRole("combobox", { name: /version/i }), { target: { value: "4.19.0" } });
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByText(/slow Count query/i)).toBeInTheDocument();
    expect(screen.getByText("readiness-slow-42")).toBeInTheDocument();
    expect(screen.getByText(/Elapsed: 1:0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop waiting/i }));
    expect(await screen.findByText(/stopped waiting for the Count job/i)).toBeInTheDocument();
  });

  it("resumes a saved readiness job instead of submitting another Count query", async () => {
    window.history.replaceState(null, "", "/tech-launch?appName=wordblast&platform=android&appVersion=4.19.0&startDate=2026-07-01&endDate=2026-07-07&run=1");
    window.sessionStorage.setItem(readinessSessionKey, JSON.stringify({ filters: readinessFilters, data: null, comparisonFilters: { appName: "wordblast", appVersion: "" }, statusText: "", pendingJobs: [{ jobKey: "readiness-resume-7", filters: readinessFilters, submittedAt: new Date().toISOString(), pollAfterMs: 0, forceRefresh: false, label: "baseline" }] }));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, access: { accountType: "internal", techLaunchApps: ["wordblast"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(jsonResponse({ versions: [{ appVersion: "4.19.0", sampleCount: 200, firstSeen: "2026-07-01", lastSeen: "2026-07-09" }], cache: { hit: false, key: "versions", expiresAt: "2026-07-10T00:00:00.000Z" } }));
      if (url === "/api/tech-launch/readiness/status") return Promise.resolve(jsonResponse(completedReadiness()));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<TechLaunchDashboard />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tech-launch/readiness/status",
      expect.objectContaining({ body: JSON.stringify({ jobKey: "readiness-resume-7", filters: readinessFilters, forceRefresh: false }) }),
    ));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/tech-launch/readiness")).toBe(false);
  });

  it("restores a matching completed snapshot instead of re-running a run URL", async () => {
    window.history.replaceState(null, "", "/tech-launch?appName=wordblast&platform=android&appVersion=4.19.0&startDate=2026-07-01&endDate=2026-07-07&run=1");
    window.sessionStorage.setItem(readinessSessionKey, JSON.stringify({
      filters: readinessFilters,
      data: completedReadiness(),
      compareEnabled: false,
      comparisonView: "individual",
      comparisonFilters: { appName: "wordblast", appVersion: "" },
      comparisonData: null,
      statusText: "Query complete",
    }));

    render(<TechLaunchDashboard />);

    expect(await screen.findByText("Insufficient")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/tech-launch/readiness")).toBe(false);
  });
});
