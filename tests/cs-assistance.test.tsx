import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CsAssistance from "@/components/CsAssistance";
vi.mock("@/components/CerberusShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
let requests: { url: string; body: Record<string, unknown> }[];
let access: string;
let failed: boolean;
beforeEach(() => { access = "internal"; failed = false; requests = []; vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
 if (url === "/api/me") return Response.json({ authenticated: true, access: { accountType: access } });
 requests.push({ url, body: JSON.parse(options?.body as string) });
 if (failed) return Response.json({ error: "Query unavailable" }, { status: 502 });
 if (url === "/api/cs-assistance") return Response.json({ status: "pending", token: "private", expiresAt: Date.now() + 600000 });
 return Response.json({ status: "completed", checkedAt: "2026-09-08T23:59:59.999Z", botSections: ["*Refund review*", "*Recommend not eligible* (inferred)\nVIP Pass"], assessment: { findings: [{ product: "VIP Pass", purchasedAt: "2026-08-19T14:32:38Z", verdict: "Recommend not eligible", details: ["Exact expiry is not recorded."] }], trace: { coverage: { through: "2026-09-08T23:59:59.999Z", limitations: ["No explicit expiry"] }, observed: { meta: { eventCount: 9528 }, purchases: [], resources: [], daily: [{ day: "2026-09-02", events: 21, interstitials: 3, rewarded: 2 }] } } } });
 })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("CS Assistance page", () => {
 it("requires a valid IDFV and never queries automatically when loading an example", async () => { render(<CsAssistance />); expect(screen.getByRole("button", { name: "Check player" })).toBeDisabled(); await waitFor(() => expect(screen.getByRole("button", { name: "Use the VIP Pass example" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Use the VIP Pass example" })); expect(screen.getByLabelText("Player IDFV")).toHaveValue("38645146fe0ea5644f7853ee3d88f77e"); expect(requests).toHaveLength(0); });
 it("submits inputs, renders the recommendation, and switches to evidence and rules", async () => { render(<CsAssistance />); await waitFor(() => expect(screen.getByRole("button", { name: "Use the VIP Pass example" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Use the VIP Pass example" })); fireEvent.click(screen.getByRole("button", { name: "Check player" })); await screen.findByText("1 purchase found"); expect(requests[0].body).toMatchObject({ asOf: "2026-09-08" }); expect(screen.getByRole("tabpanel")).toHaveTextContent("inferred"); fireEvent.click(screen.getByRole("tab", { name: "Evidence" })); expect(screen.getByRole("table")).toHaveTextContent("2026-09-02"); fireEvent.click(screen.getByRole("tab", { name: "Checking logic" })); expect(screen.getByRole("tabpanel")).toHaveTextContent("48 elapsed hours"); });
 it("clears previous results on a new failed check", async () => { render(<CsAssistance />); await waitFor(() => expect(screen.getByRole("button", { name: "Use the VIP Pass example" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Use the VIP Pass example" })); fireEvent.click(screen.getByRole("button", { name: "Check player" })); await screen.findByText("1 purchase found"); failed = true; fireEvent.click(screen.getByRole("button", { name: "Check player" })); expect(await screen.findByRole("alert")).toHaveTextContent("Query unavailable"); expect(screen.queryByText("1 purchase found")).not.toBeInTheDocument(); });
 it("does not offer checks to external accounts", async () => { access = "external"; render(<CsAssistance />); expect(await screen.findByRole("alert")).toHaveTextContent("internal team members"); expect(screen.getByRole("button", { name: "Check player" })).toBeDisabled(); });
});
