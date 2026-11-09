import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventGenerationRecord } from "@/lib/db";
const state = vi.hoisted(() => ({
  record: null as EventGenerationRecord | null,
  role: "admin",
}));
vi.mock("@/lib/auth", () => ({
  requireCurrentAppUser: async () => ({
    role: state.role,
    email: "admin@example.com",
  }),
  canManageUsers: (u: { role: string }) => u.role === "admin",
  assertInternalAppUser: () => {},
  assertCanCreateSpec: async () => {},
  jsonError: (e: unknown) =>
    e instanceof Response
      ? e
      : Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getEventGenerationRecord: async () => state.record,
  saveEventGenerationRecord: async (
    record: EventGenerationRecord,
    revision: number,
  ) => {
    if ((state.record?.revision ?? 0) !== revision) return false;
    state.record = record;
    return true;
  },
}));
import { GET, POST } from "@/app/api/admin/event-generation/route";
import { POST as generate } from "@/app/api/generate/route";
import { intakeFields } from "@/lib/event-generation-config";
const request = (body?: unknown) =>
  new Request("http://localhost/api/admin/event-generation", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  state.record = null;
  state.role = "admin";
  vi.stubEnv("OPENAI_API_KEY", "");
});
describe("admin template API", () => {
  it("denies non-admin read, save, publish and preview", async () => {
    for (const role of ["editor", "viewer"]) {
      state.role = role;
      expect((await GET(request())).status).toBe(403);
      for (const action of ["save", "publish", "preview"])
        expect((await POST(request({ action }))).status).toBe(403);
    }
  });
  it("isolates drafts, previews without persistence, publishes future generation, rejects stale writes", async () => {
    const seed = await (await GET(request())).json();
    const config = seed.draft;
    config.events[0].eventName = "Admin_Custom_Event";
    config.events[0].rule = { mode: "always", conditions: [] };
    const intake = {
      gameTitle: "Test",
      ...Object.fromEntries(intakeFields.map((k) => [k, ""])),
    };
    expect(
      (await POST(request({ action: "preview", config, revision: 0, intake })))
        .status,
    ).toBe(200);
    expect(state.record).toBeNull();
    const saved = await (
      await POST(request({ action: "save", config, revision: 0 }))
    ).json();
    expect(saved.version).toBe(0);
    const draftResult = await (await generate(request(intake))).json();
    expect(
      draftResult.generatedEvents.some(
        (e: { eventName: string }) => e.eventName === "Admin_Custom_Event",
      ),
    ).toBe(false);
    expect(
      (await POST(request({ action: "save", config, revision: 0 }))).status,
    ).toBe(409);
    expect(
      (
        await POST(
          request({ action: "publish", config, revision: saved.revision }),
        )
      ).status,
    ).toBe(200);
    const result = await (await generate(request(intake))).json();
    expect(result.generationTemplateVersion).toBe(1);
    expect(
      result.generatedEvents.some(
        (e: { eventName: string }) => e.eventName === "Admin_Custom_Event",
      ),
    ).toBe(true);
    config.events[0].trigger = "Unsaved trigger";
    expect(
      (
        await POST(
          request({
            action: "publish",
            config,
            revision: state.record!.revision,
          }),
        )
      ).status,
    ).toBe(409);
  });
  it("returns validation errors without writing", async () => {
    expect(
      (await POST(request({ action: "save", revision: 0, config: {} }))).status,
    ).toBe(400);
    expect(state.record).toBeNull();
  });
});
