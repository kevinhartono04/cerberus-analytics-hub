import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CerberusShell", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
import GameMonitoringDashboard from "@/components/GameMonitoringDashboard";

const filters = { appName: "wordblast", platforms: ["android", "ios"], appVersions: [], startDate: "2026-07-01", endDate: "2026-07-07" };
const point = (platform: "android" | "ios", cohortSegment: "d0" | "d1_plus") => ({ eventDate: "2026-07-01", platform, eventHour: 4, cohortSegment, hourlyActiveUsers: 100, installUsers: cohortSegment === "d0" ? 10 : 0, cumulativeInstalls: cohortSegment === "d0" ? 40 : 0, purchaseSuccessEvents: 5, purchasers: 4, payerRate: 0.04, sessionStartEvents: 90, gameStartEvents: 80, sessionStartUsers: 70, gameStartUsers: 60, gameStartRate: 0.857, gameStartActiveRate: 0.6, interstitialImpressions: 40, rewardedImpressions: 20, bannerImpressions: 10, fipu: 0.4, ripu: 0.2, bipu: 0.1 });
const points = [point("android", "d0"), point("android", "d1_plus"), point("ios", "d0"), point("ios", "d1_plus")];
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

describe("GameMonitoringDashboard", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(response({ authenticated: true, access: { techLaunchApps: ["wordblast"] } }));
      if (url === "/api/tech-launch/app-versions") return Promise.resolve(response({ versions: [{ appVersion: "1.0.0", sampleCount: 100 }] }));
      if (url === "/api/tech-launch/game-monitoring") return Promise.resolve(response({ status: "completed", filters, points, summary: { latestEventDate: "2026-07-01" }, metadata: { executedAt: "2026-07-01T00:00:00.000Z" } }));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders date-grouped hourly panels separately for Android and iOS", async () => {
    render(<GameMonitoringDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }));
    expect(await screen.findByText("Android cumulative installs")).toBeInTheDocument();
    expect(screen.getByText("iOS cumulative installs")).toBeInTheDocument();
    expect(screen.getAllByText(/Payment success events · D0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FIPU · D1\+/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Created hour of day").length).toBeGreaterThan(1);
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/tech-launch/game-monitoring");
      expect(call).toBeDefined();
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({ appName: "wordblast", platforms: ["android", "ios"], appVersions: [], forceRefresh: false });
    });
  });
});
