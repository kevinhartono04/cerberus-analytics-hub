// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], insert: vi.fn() }));
vi.mock("@/lib/db", () => ({
 listStoredGames: vi.fn(async () => db.rows), insertStoredGame: db.insert,
 getSavedSpec: vi.fn(), listSavedSpecs: vi.fn(), saveSpec: vi.fn(), updateStoredGame: vi.fn(),
}));
import { GET, POST, PATCH, DELETE } from "@/app/api/service/[...path]/route";
import { listStoredGames } from "@/lib/db";
const token = `liz_${"a".repeat(43)}`;
const input = { name: "servicegame", appId: 990123, bundleId: "com.example.servicegame", adjustAndroid: "androidsecret123", adjustIos: "iossecret123" };
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });
function request(method: string, body?: unknown, credential: string | null = token) {
 return new Request("https://cerebral.example/api/service/games", {method,headers:credential ? {authorization:`Bearer ${credential}`} : {},body:body===undefined?undefined:JSON.stringify(body)});
}
beforeEach(() => {
 vi.resetAllMocks();db.rows=[];
 vi.mocked(listStoredGames).mockImplementation(async () => db.rows as Awaited<ReturnType<typeof listStoredGames>>);
 db.insert.mockImplementation(async row => {db.rows.push(row);});
 vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256",createHash("sha256").update(token).digest("hex"));
 vi.stubEnv("GOOGLE_PLAY_APP_MAP_JSON", "{}");vi.stubEnv("ADJUST_APP_TOKENS_JSON", "{}");
 vi.spyOn(console,"info").mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("Liz game registration through the real registry",()=>{
 it("advertises create-only game management",async()=>{
  expect(await (await GET(request("GET"),context("games"))).json()).toMatchObject({canManage:true,canCreate:true,canEdit:false,canDelete:false});
 });
 it("registers and lists a game, preserving validation and Liz attribution without exposing Adjust tokens",async()=>{
  const response=await POST(request("POST",{...input,createdBy:"admin"}),context("games"));
  expect(response.status).toBe(201);
  expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({...input,createdBy:"service:liz"}));
  const created=await response.json();
  expect(created).toEqual({game:expect.objectContaining({name:input.name,appId:input.appId,bundleId:input.bundleId,adjustAndroidConfigured:true,adjustIosConfigured:true})});
  const listed=await (await GET(request("GET"),context("games"))).json();
  expect(listed.games).toContainEqual(created.game);
  const log=JSON.parse(vi.mocked(console.info).mock.calls[0][0]);
  expect(log).toMatchObject({actor:"service:liz",action:"games.create",gameName:input.name,status:201});
  for(const value of [created,listed,vi.mocked(console.info).mock.calls]) {
   expect(JSON.stringify(value)).not.toContain(input.adjustAndroid);
   expect(JSON.stringify(value)).not.toContain(input.adjustIos);
   expect(JSON.stringify(value)).not.toContain(token);
  }
 });
 it("accepts omitted optional Adjust tokens",async()=>{
  expect((await POST(request("POST",{name:input.name,appId:input.appId,bundleId:input.bundleId}),context("games"))).status).toBe(201);
  expect(db.rows[0]).toMatchObject({adjustAndroid:"",adjustIos:""});
 });
 it.each([null,"incorrect",`liz_${"b".repeat(43)}`])("rejects credential %s before registry access",async credential=>{
  expect((await POST(request("POST",input,credential),context("games"))).status).toBe(401);
  expect(listStoredGames).not.toHaveBeenCalled();expect(db.insert).not.toHaveBeenCalled();
 });
 it.each([{name:"Rotate Clips"},{appId:1.5},{appId:0},{bundleId:"invalid"},{adjustAndroid:"invalid token"}])("rejects invalid input %j",async invalid=>{
  const response=await POST(request("POST",{...input,...invalid}),context("games"));
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:"Invalid game"});
  expect(db.insert).not.toHaveBeenCalled();
 });
 it.each([{name:input.name,appId:990124,bundleId:"com.example.other"},{name:"another",appId:input.appId,bundleId:"com.example.other"},{name:"another",appId:990124,bundleId:input.bundleId}])("returns a useful conflict for duplicate identifiers %j",async duplicate=>{
  await POST(request("POST",input),context("games"));
  const response=await POST(request("POST",duplicate),context("games"));
  expect(response.status).toBe(409);expect(await response.json()).toEqual({error:"A game with this name, app ID, or bundle ID already exists"});
  expect(db.insert).toHaveBeenCalledOnce();
 });
 it("handles a concurrent database uniqueness conflict without returning Unauthorized",async()=>{
  db.insert.mockRejectedValue({code:"23505"});
  const response=await POST(request("POST",input),context("games"));
  expect(response.status).toBe(409);expect(await response.text()).not.toContain("Unauthorized");
 });
 it("keeps game edit, game deletion and user administration denied",async()=>{
  expect((await PATCH(request("PATCH",input),context("games",input.name))).status).toBe(403);
  expect((await DELETE(request("DELETE"),context("games",input.name))).status).toBe(403);
  expect((await POST(request("POST",{}),context("users"))).status).toBe(403);
  expect(db.insert).not.toHaveBeenCalled();
 });
 it("does not disclose database errors",async()=>{
  db.insert.mockRejectedValue(new Error("postgres://secret-password"));
  const response=await POST(request("POST",input),context("games"));
  expect(response.status).toBe(500);expect(await response.text()).not.toContain("secret-password");
 });
});
