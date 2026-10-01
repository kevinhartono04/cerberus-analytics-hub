import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { records } = vi.hoisted(() => ({ records: new Map<string,string>() }));
vi.mock("@/lib/db",()=>({getTechLaunchReadinessCache:vi.fn(async(key:string)=>records.has(key)?{payload:records.get(key)}:null),saveTechLaunchReadinessCache:vi.fn(async(r:{cacheKey:string;payload:string})=>{records.set(r.cacheKey,r.payload);})}));
import { getSenseUsage, reserveSenseRequest, recordSenseOrganizationUsage } from "@/lib/ludios-sense-usage";
beforeEach(()=>{records.clear();process.env.SENSE_MONTHLY_REQUEST_LIMIT="2";vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-01T03:00:00Z"));});
afterEach(()=>{vi.useRealTimers();delete process.env.SENSE_MONTHLY_REQUEST_LIMIT;});
describe("shared Sense allowance",()=>{
 it("counts reservations, refuses an extra request, and resets in a new UTC month",async()=>{
  await reserveSenseRequest();await reserveSenseRequest();
  expect((await getSenseUsage()).used).toBe(2);
  await expect(reserveSenseRequest()).rejects.toThrow("allowance");
  expect((await getSenseUsage()).used).toBe(2);
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  expect((await getSenseUsage()).used).toBe(0);
  await reserveSenseRequest();expect((await getSenseUsage()).used).toBe(1);
 });
 it("keeps organization usage separate and stops when the reported organization allowance is exhausted",async()=>{
  await reserveSenseRequest();
  await recordSenseOrganizationUsage({"x-api-usage-count":"10000","x-api-usage-limit":"10000"});
  const usage=await getSenseUsage();expect(usage.used).toBe(1);expect(usage.organizationUsed).toBe(10000);
  await expect(reserveSenseRequest()).rejects.toThrow("organization allowance");
  await recordSenseOrganizationUsage({"x-api-usage-count":"invalid","x-api-usage-limit":"10000"});
  expect((await getSenseUsage()).organizationUsed).toBe(10000);
 });
});
