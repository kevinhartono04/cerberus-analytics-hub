import { beforeEach, describe, expect, it, vi } from "vitest";
const { cache, transport, reserve, claim, release } = vi.hoisted(() => ({ cache:new Map<string,any>(), transport:vi.fn(), reserve:vi.fn(), claim:vi.fn(), release:vi.fn() }));
vi.mock("@/lib/db",()=>({getTechLaunchReadinessCache:async(k:string)=>cache.get(k),saveTechLaunchReadinessCache:async(r:any)=>cache.set(r.cacheKey,r),claimSenseLease:claim,releaseSenseLease:release}));
vi.mock("@/lib/ludios-sense-usage",()=>({reserveSenseRequest:reserve,recordSenseOrganizationUsage:vi.fn()}));
vi.mock("@/lib/sensortower-api",()=>({sensorTowerRequest:transport}));
import { getSenseIcons, safeSenseIconUrl } from "@/lib/ludios-sense-icons";
import type { SenseGame } from "@/lib/ludios-sense-types";
const games = [{appId:"1"},{appId:"2"}] as SenseGame[];
beforeEach(()=>{vi.clearAllMocks();cache.clear();process.env.SENSOR_TOWER_TOKEN="icon-test-token";claim.mockResolvedValue(true);});
describe("Sense icon metadata",()=>{
  it("batches visible games once, caches missing icons, and reuses them across reports",async()=>{
    transport.mockResolvedValue({status:200,body:JSON.stringify({apps:[{app_id:"1",icon_url:"https://example.com/icon.png"}]})});
    expect(await getSenseIcons(games,"ios","US")).toEqual({icons:{"1":"https://example.com/icon.png","2":null},requests:1});
    const url=transport.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/v1/ios/apps");expect(url.searchParams.get("app_ids")).toBe("1,2");
    expect(await getSenseIcons(games,"ios","JP")).toEqual({icons:{"1":"https://example.com/icon.png","2":null},requests:0});
    expect(transport).toHaveBeenCalledTimes(1);expect(reserve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...cache.values()])).not.toContain("icon-test-token");
    expect(release).toHaveBeenCalledWith("sense:upstream:lease",expect.any(String),1000);
  });
  it("uses existing metadata without calls and rejects unsafe URLs",async()=>{
    expect(await getSenseIcons([{appId:"1",iconUrl:"https://example.com/icon.png"}] as SenseGame[],"android","US")).toEqual({icons:{"1":"https://example.com/icon.png"},requests:0});
    expect(transport).not.toHaveBeenCalled();
    for(const url of ["javascript:alert(1)","http://example.com/x","https://user:pass@example.com/x","https://example.com/x?auth_token=secret"]) expect(safeSenseIconUrl(url)).toBeNull();
  });
  it("waits for the shared lease and stops at the allowance without calling Sensor Tower",async()=>{
    claim.mockResolvedValueOnce(false);
    await expect(getSenseIcons(games,"ios","US")).rejects.toMatchObject({status:503});
    expect(reserve).not.toHaveBeenCalled();
    reserve.mockRejectedValueOnce(new Error("Allowance reached"));
    await expect(getSenseIcons(games,"ios","US")).rejects.toThrow("Allowance reached");
    expect(transport).not.toHaveBeenCalled();expect(release).toHaveBeenCalled();
  });
});
