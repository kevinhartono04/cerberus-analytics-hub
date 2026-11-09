// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type { GeneratedSpec, AppUser } from "@/lib/types";
let directory = "";
afterAll(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
it("persists service writes while retaining human ownership and refusing deletion", async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "liz-service-storage-"));
  fs.mkdirSync(path.join(directory, "data"));
  execFileSync("sqlite3", [path.join(directory, "data/analytics.sqlite"), "CREATE TABLE fixture_marker(id TEXT);"]);
  for (const key of ["CEREBRAL_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, "");
  const token = `liz_${"a".repeat(43)}`;
  vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256", createHash("sha256").update(token).digest("hex"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.resetModules();
  const { saveSpec, getSavedSpecSummary, getSavedSpec } = await import("@/lib/db");
  const { GET, POST, PUT, DELETE } = await import("@/app/api/service/[...path]/route");
  const context = (...parts: string[]) => ({ params: Promise.resolve({ path: parts }) });
  const request = (method: string, body?: unknown) => new Request("http://localhost/api/service/specs", {
    method, headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const spec: GeneratedSpec = {
    id: "human-spec", generatedAt: "2026-11-09T00:00:00.000Z",
    intake: { gameTitle: "Human game", genre: "Puzzle", coreLoop: "", gameModes: "", mechanics: "", winConditions: "", loseConditions: "", economy: "", itemsOrPowerups: "", powerupNames: "", iap: "", ads: "", rewardedAdPlacements: "", interstitialAdPlacements: "", liveOps: "", notes: "" },
    generatedEvents: [], selectedFeaturePacks: [], platformAdPayloads: [], assumptions: [],
  };
  const human: AppUser = { id: "human-owner", name: "Human", email: "human@tripledotstudios.com", role: "editor", createdAt: spec.generatedAt, updatedAt: spec.generatedAt };
  await saveSpec(spec, human);
  const edited = { ...spec, intake: { ...spec.intake, gameTitle: "Edited by service" } };
  expect((await PUT(request("PUT", edited), context("specs", spec.id))).status).toBe(200);
  expect(await getSavedSpecSummary(spec.id)).toMatchObject({ ownerUserId: human.id, ownerEmail: human.email, gameTitle: "Edited by service" });
  expect(await getSavedSpec(spec.id)).toMatchObject(edited);
  const created = await POST(request("POST", spec), context("specs"));
  expect(created.status).toBe(201);
  const newSpec = await created.json();
  expect(newSpec.id).not.toBe(spec.id);
  expect(newSpec.ownerUserId).toBe("service:liz");
  const list = await (await GET(request("GET"), context("specs"))).json();
  expect(list).toHaveLength(2);
  expect(list.every((item: { canDelete: boolean }) => !item.canDelete)).toBe(true);
  expect((await DELETE(request("DELETE"), context("specs", spec.id))).status).toBe(403);
  expect(await getSavedSpec(spec.id)).not.toBeNull();
});
