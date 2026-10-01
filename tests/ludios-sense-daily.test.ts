import { beforeEach, describe, expect, it, vi } from "vitest";
const { start,worker,after }=vi.hoisted(()=>({start:vi.fn(),worker:vi.fn(),after:vi.fn()}));
vi.mock("@/lib/ludios-sense",()=>({startDailySense:start,runSenseWorker:worker}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),after}));
import { GET } from "@/app/api/cron/ludios-sense-daily/route";
beforeEach(()=>{vi.clearAllMocks();process.env.CRON_SECRET="daily-test";});
describe("daily shared analysis cron",()=>{
  it("rejects unauthenticated invocation",async()=>{
    expect((await GET(new Request("http://localhost/api/cron/ludios-sense-daily"))).status).toBe(401);expect(start).not.toHaveBeenCalled();
  });
  it("starts background work only for an unfinished unpaused job",async()=>{
    const request=()=>new Request("http://localhost/api/cron/ludios-sense-daily",{headers:{Authorization:"Bearer daily-test"}});
    start.mockResolvedValueOnce({jobKey:"daily",status:"running"});
    expect((await GET(request())).status).toBe(200);expect(after).toHaveBeenCalledOnce();
    await after.mock.calls[0][0]();expect(worker).toHaveBeenCalledWith("daily");
    after.mockClear();start.mockResolvedValueOnce({jobKey:"daily",status:"completed",cached:true});
    expect(await (await GET(request())).json()).toMatchObject({cached:true});expect(after).not.toHaveBeenCalled();
    start.mockResolvedValueOnce({jobKey:"daily",status:"running",paused:true});
    await GET(request());expect(after).not.toHaveBeenCalled();
  });
});
