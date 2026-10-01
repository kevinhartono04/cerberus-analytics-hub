import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const { get }=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("node:https",()=>({default:{get}}));
import { sensorTowerRequest } from "@/lib/sensortower-api";
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
describe("Sensor Tower transport",()=>{
 it("enforces a hard deadline and exposes no credential URL in failures",async()=>{
  vi.useFakeTimers();const req=Object.assign(new EventEmitter(),{destroy:vi.fn()});get.mockReturnValue(req);
  const promise=sensorTowerRequest(new URL("https://api.sensortower.com/v1/apps?auth_token=private"));
  const rejection=expect(promise).rejects.toThrow("Sensor Tower connection timed out");
  await vi.advanceTimersByTimeAsync(30000);await rejection;expect(req.destroy).toHaveBeenCalledOnce();
 });
 it("returns redirects as failures without following them",async()=>{
  const req=Object.assign(new EventEmitter(),{destroy:vi.fn()});get.mockImplementation((_url:URL,_options:unknown,cb:(res:EventEmitter)=>void)=>{const res=Object.assign(new EventEmitter(),{statusCode:302});queueMicrotask(()=>{cb(res);res.emit("data",Buffer.from("redirect"));res.emit("end");});return req;});
  expect(await sensorTowerRequest(new URL("https://api.sensortower.com/v1/apps"))).toEqual({status:302,body:"redirect"});expect(get).toHaveBeenCalledOnce();
 });
 it("returns only the two usage headers, never unrelated server headers",async()=>{
  const req=Object.assign(new EventEmitter(),{destroy:vi.fn()});
  get.mockImplementation((_url:URL,_options:unknown,cb:(res:EventEmitter)=>void)=>{const res=Object.assign(new EventEmitter(),{statusCode:200,headers:{"x-api-usage-count":"21","x-api-usage-limit":"10000","set-cookie":"private"}});queueMicrotask(()=>{cb(res);res.emit("data",Buffer.from("[]"));res.emit("end");});return req;});
  expect((await sensorTowerRequest(new URL("https://api.sensortower.com/v1/apps"))).usageHeaders).toEqual({"x-api-usage-count":"21","x-api-usage-limit":"10000"});
 });

});
