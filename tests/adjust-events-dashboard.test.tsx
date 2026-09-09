import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CerberusShell", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

import AdjustEventsCheckDashboard from "@/components/AdjustEventsCheckDashboard";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const completedResult = {
  status: "completed" as const,
  appName: "stacksmash",
  platform: "android" as const,
  checkedAt: "2026-09-08T01:00:00.000Z",
  overallStatus: "fail" as const,
  checks: [
    { expected: "client_ad_revenue" as const, acceptedNames: ["client_ad_revenue"], status: "detected" as const, matches: [{ matchedField: "name" as const, matchedValue: "client_ad_revenue", name: "client_ad_revenue" }], nearMatches: [] },
    { expected: "iap_purchase" as const, acceptedNames: ["iap_purchase"], status: "missing" as const, matches: [], nearMatches: [{ matchedField: "name" as const, matchedValue: "Iap_Purchase", name: "Iap_Purchase" }] },
    { expected: "session_start" as const, acceptedNames: ["session_start", "Session_Start"], status: "detected" as const, matches: [{ matchedField: "name" as const, matchedValue: "session_start", name: "session_start" }], nearMatches: [] },
  ],
  journeyMilestones: {
    status: "detected" as const,
    milestones: [
      { level: 10, matchedField: "name" as const, matchedValue: "Journey_Level_Won10", name: "Journey_Level_Won10" },
      { level: 25, matchedField: "name" as const, matchedValue: "Journey_Level_Won25", name: "Journey_Level_Won25" },
    ],
    nearMatches: [],
  },
};

describe("AdjustEventsCheckDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/adjust-events-check") return Promise.resolve(jsonResponse(completedResult));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }));
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("submits the allowed app and displays exact, missing, and milestone results", async () => {
    render(<AdjustEventsCheckDashboard />);

    expect(await screen.findByText("stacksmash")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /run check/i }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/tech-launch/adjust-events-check",
      expect.objectContaining({ body: JSON.stringify({ appName: "stacksmash", platform: "android" }) }),
    ));
    expect(await screen.findByText("3 of 4 required checks detected")).toBeInTheDocument();
    expect(screen.getByText("Iap_Purchase")).toBeInTheDocument();
    expect(screen.getAllByText("Level 10")).toHaveLength(2);
    expect(screen.getAllByText("Level 25")).toHaveLength(2);
  });

  it("restores the completed result after returning to the page in the same browser session", async () => {
    render(<AdjustEventsCheckDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /run check/i }));
    expect(await screen.findByText("3 of 4 required checks detected")).toBeInTheDocument();

    cleanup();
    render(<AdjustEventsCheckDashboard />);

    expect(await screen.findByText("3 of 4 required checks detected")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/tech-launch/adjust-events-check")).toHaveLength(1);
  });

  it("shows a provider error and clears prior results", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(jsonResponse({ authenticated: true, access: { techLaunchApps: ["stacksmash"] } }));
      if (url === "/api/tech-launch/adjust-events-check") return Promise.resolve(jsonResponse({ error: "Adjust Events Check is not configured for this app" }, 503));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<AdjustEventsCheckDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /run check/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Adjust Events Check is not configured for this app");
    expect(screen.queryByText(/required checks detected/i)).not.toBeInTheDocument();
  });
});
