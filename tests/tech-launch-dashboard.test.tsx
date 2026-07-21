import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CerberusShell", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

import TechLaunchDashboard from "@/components/TechLaunchDashboard";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
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
});
