import { beforeEach, describe, expect, it, vi } from "vitest";
const { work }=vi.hoisted(()=>({work:vi.fn(async()=>2)}));
vi.mock("@/lib/ludios-sense",()=>({continuePendingSenseJobs:work}));
import { GET } from "@/app/api/cron/ludios-sense/route";
beforeEach(()=>{process.env.CRON_SECRET="worker-test-secret";work.mockClear();});
describe("user-started Sense continuation",()=>{
 it("rejects unauthorized calls without running jobs",async()=>{
  expect((await GET(new Request("http://localhost/api/cron/ludios-sense"))).status).toBe(401);expect(work).not.toHaveBeenCalled();
 });
 it("runs only the pending-job continuation behind the cron secret",async()=>{
  const res=await GET(new Request("http://localhost/api/cron/ludios-sense",{headers:{Authorization:"Bearer worker-test-secret"}}));
  expect(res.status).toBe(200);expect(await res.json()).toEqual({scans:2});expect(work).toHaveBeenCalledOnce();
 });
});
