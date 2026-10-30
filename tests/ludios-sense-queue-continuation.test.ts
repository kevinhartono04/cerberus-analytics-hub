// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({after:vi.fn(),user:vi.fn(),internal:vi.fn(),get:vi.fn(),progress:vi.fn(),worker:vi.fn()}));
vi.mock("next/server",()=>({after:mocks.after}));
vi.mock("@/lib/auth",()=>({requireCurrentAppUser:mocks.user,assertInternalAppUser:mocks.internal,jsonError:(e:unknown)=>e instanceof Response?e:Response.json({error:"Failed"},{status:500})}));
vi.mock("@/lib/ludios-sense",()=>({getSenseProgress:mocks.progress,runSenseWorker:mocks.worker}));
vi.mock("@/lib/ludios-sense-queue-runtime",()=>({senseQueueRuntime:()=>({store:{get:mocks.get}})}));
import {POST} from "@/app/api/ludios-sense/continue/route";
const key="sense:v1:"+"a".repeat(64);
const request=(jobKey=key)=>new Request("https://example.com/api/ludios-sense/continue",{method:"POST",body:JSON.stringify({jobKey})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("SENSE_QUEUE_ENGINE","true");mocks.user.mockResolvedValue({role:"admin"});mocks.internal.mockImplementation(()=>{});mocks.get.mockResolvedValue({state:{}});mocks.progress.mockResolvedValue({jobKey:key,status:"running",paused:false,workerActive:false});});
it("continues an inactive queue only after an authenticated explicit request",async()=>{const res=await POST(request());expect(await res.json()).toMatchObject({accepted:true,scan:{workerActive:true}});expect(mocks.after).toHaveBeenCalledOnce();await mocks.after.mock.calls[0][0]();expect(mocks.worker).toHaveBeenCalledWith(key,240000,false);});
it("does not schedule a duplicate worker",async()=>{mocks.progress.mockResolvedValue({status:"running",workerActive:true});expect((await POST(request())).status).toBe(200);expect(mocks.after).not.toHaveBeenCalled();});
it.each([{status:"running",paused:true},{status:"completed",paused:false}])("never resumes paused or finished work: %j",async state=>{mocks.progress.mockResolvedValue(state);expect(await(await POST(request())).json()).toMatchObject({accepted:false});expect(mocks.after).not.toHaveBeenCalled();});
it("refuses legacy work and disabled queue writes",async()=>{mocks.get.mockResolvedValue(null);expect((await POST(request())).status).toBe(409);vi.stubEnv("SENSE_QUEUE_ENGINE","false");expect((await POST(request())).status).toBe(409);expect(mocks.after).not.toHaveBeenCalled();});
it("rejects an invalid key and unauthorized users before scheduling",async()=>{expect((await POST(request("bad"))).status).toBe(400);mocks.internal.mockImplementation(()=>{throw Response.json({error:"Forbidden"},{status:403});});expect((await POST(request())).status).toBe(403);expect(mocks.after).not.toHaveBeenCalled();});
