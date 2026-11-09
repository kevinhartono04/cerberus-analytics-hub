// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getSavedSpec: vi.fn(), listSavedSpecs: vi.fn(), saveSpec: vi.fn() }));
vi.mock("@/lib/game-registry", () => ({ registeredGames: vi.fn() }));
import { GET, POST, PUT, DELETE, PATCH } from "@/app/api/service/[...path]/route";
import { getSavedSpec, listSavedSpecs, saveSpec } from "@/lib/db";
import { registeredGames } from "@/lib/game-registry";
import { requireLiz } from "@/lib/service-auth";

const token = `liz_${"a".repeat(43)}`;
const hash = createHash("sha256").update(token).digest("hex");
const spec = {
  id: "existing", generatedAt: "2026-11-09T00:00:00.000Z",
  intake: { gameTitle: "Test", genre: "Puzzle", coreLoop: "", gameModes: "", mechanics: "", winConditions: "", loseConditions: "", economy: "", itemsOrPowerups: "", powerupNames: "", iap: "", ads: "", rewardedAdPlacements: "", interstitialAdPlacements: "", liveOps: "", notes: "" },
  selectedFeaturePacks: [], generatedEvents: [], platformAdPayloads: [], assumptions: [],
};
const summary = { id: "existing", ownerUserId: "human", gameTitle: "Test" };
function request(method = "GET", body?: unknown, credential: string | null = token) {
  return new Request("https://cerebral.example/api/service/specs", {
    method, headers: credential ? { authorization: `Bearer ${credential}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256", hash);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(getSavedSpec).mockResolvedValue(spec);
  vi.mocked(listSavedSpecs).mockResolvedValue([summary as never]);
  vi.mocked(saveSpec).mockImplementation(async (body, user) => ({ ...summary, id: (body as typeof spec).id, ownerUserId: user.id }) as never);
  vi.mocked(registeredGames).mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Liz credential boundary", () => {
  it.each([null, "wrong", `liz_${"b".repeat(43)}`, `${token}extra`])("rejects credential %s before reading storage", async credential => {
    const response = await GET(request("GET", undefined, credential), context("specs"));
    expect(response.status).toBe(401);
    expect(listSavedSpecs).not.toHaveBeenCalled();
  });
  it.each(["", "invalid", "00".repeat(32)])("fails closed with server configuration %s", async value => {
    vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256", value);
    expect((await GET(request(), context("specs"))).status).toBe(401);
  });
  it("does not accept human session or local admin headers", async () => {
    const req = request("GET", undefined, null);
    req.headers.set("cookie", "authjs.session-token=human-session");
    req.headers.set("x-test-user-id", "local-admin");
    req.headers.set("x-test-user-email", "admin@tripledotstudios.com");
    expect((await GET(req, context("specs"))).status).toBe(401);
  });
  it("returns a fixed non-admin identity and supports immediate hash rotation", () => {
    expect(requireLiz(request())).toMatchObject({ id: "service:liz", name: "Liz", role: "editor" });
    const replacement = `liz_${"c".repeat(43)}`;
    vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256", createHash("sha256").update(replacement).digest("hex"));
    expect(() => requireLiz(request())).toThrow();
    expect(requireLiz(request("GET", undefined, replacement)).id).toBe("service:liz");
  });
});

describe("Liz permitted operations", () => {
  it("reads games, spec summaries and spec contents without granting deletion", async () => {
    expect(await (await GET(request(), context("games"))).json()).toEqual({ games: [], canManage: false });
    const list = await GET(request(), context("specs"));
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(await list.json()).toEqual([{ ...summary, canEdit: true, canDelete: false }]);
    expect(await (await GET(request(), context("specs", "existing"))).json()).toEqual(spec);
  });
  it("creates with a fresh ID and Liz attribution, never overwriting the supplied ID", async () => {
    const response = await POST(request("POST", spec), context("specs"));
    expect(response.status).toBe(201);
    const [saved, actor] = vi.mocked(saveSpec).mock.calls[0];
    expect((saved as typeof spec).id).not.toBe(spec.id);
    expect(actor.id).toBe("service:liz");
    const log = JSON.parse(vi.mocked(console.info).mock.calls[0][0]);
    expect(log).toMatchObject({ actor: "service:liz", action: "specs.create", status: 201, requestId: response.headers.get("x-request-id") });
    expect(JSON.stringify(log)).not.toContain(token);
    expect(log).not.toHaveProperty("intake");
  });
  it("updates an existing spec with Liz as actor", async () => {
    expect((await PUT(request("PUT", spec), context("specs", "existing"))).status).toBe(200);
    expect(saveSpec).toHaveBeenCalledWith(spec, expect.objectContaining({ id: "service:liz" }));
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({ action: "specs.update", specId: "existing", status: 200 });
  });
  it("rejects missing specs, ID mismatch and invalid input without writing", async () => {
    expect((await PUT(request("PUT", { ...spec, id: "different" }), context("specs", "existing"))).status).toBe(400);
    expect((await POST(request("POST", { intake: {} }), context("specs"))).status).toBe(400);
    const malformed = new Request("https://cerebral.example", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{" });
    expect((await POST(malformed, context("specs"))).status).toBe(400);
    vi.mocked(getSavedSpec).mockResolvedValue(null);
    expect((await PUT(request("PUT", spec), context("specs", "missing"))).status).toBe(404);
    expect((await GET(request(), context("specs", "missing"))).status).toBe(404);
    expect(saveSpec).not.toHaveBeenCalled();
  });
  it.each([
    ["DELETE", ["specs", "existing"]], ["POST", ["games"]],
    ["GET", ["users"]], ["PUT", ["users", "admin"]],
    ["PATCH", ["specs", "existing"]], ["POST", ["specs", "import"]],
    ["GET", ["specs", "existing", "extra"]],
  ])("denies %s %j", async (method, path) => {
    const handler = method === "DELETE" ? DELETE : method === "PATCH" ? PATCH : method === "PUT" ? PUT : method === "POST" ? POST : GET;
    expect((await handler(request(method), context(...path))).status).toBe(403);
    expect(saveSpec).not.toHaveBeenCalled();
    expect(getSavedSpec).not.toHaveBeenCalled();
  });
  it("does not expose storage errors and logs failure", async () => {
    vi.mocked(saveSpec).mockRejectedValue(new Error("postgres://secret-password"));
    const response = await POST(request("POST", spec), context("specs"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-password");
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({ actor: "service:liz", status: 500 });
  });
});
