import { beforeEach, describe, expect, it, vi } from "vitest";
const { user, start, advance } = vi.hoisted(()=>({user:{value:{id:"local-admin",email:"admin@tripledotstudios.com"} as {id:string;email:string}|null},start:vi.fn(),advance:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireCurrentAppUser:vi.fn(async()=>{if(!user.value)throw Response.json({error:"Sign in required"},{status:401});return user.value;}),assertInternalAppUser:vi.fn((u:{email:string})=>{if(!u.email.endsWith("@tripledotstudios.com"))throw Response.json({error:"Internal accounts only"},{status:403});}),jsonError:(e:unknown)=>e instanceof Response?e:Response.json({error:"Unexpected error"},{status:500})}));
vi.mock("@/lib/ludios-sense",()=>({startSense:start,advanceSense:advance}));
import {POST as begin} from "@/app/api/ludios-sense/route";
import {POST as status} from "@/app/api/ludios-sense/status/route";
const request=(body:unknown)=>new Request("http://localhost/api/ludios-sense",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();user.value={id:"local-admin",email:"admin@tripledotstudios.com"};start.mockResolvedValue({status:"running"});});
describe("Sense authorization and validation",()=>{
 it("requires sign-in and internal access on both endpoints",async()=>{
  user.value=null;expect((await begin(request({}))).status).toBe(401);expect((await status(request({}))).status).toBe(401);
  user.value={id:"external",email:"user@partner.com"};expect((await begin(request({}))).status).toBe(403);expect((await status(request({}))).status).toBe(403);
  expect(start).not.toHaveBeenCalled();expect(advance).not.toHaveBeenCalled();
 });
 it("rejects empty markets and invalid scan IDs before invoking the worker",async()=>{
  expect((await begin(request({date:"2026-09-28",countries:[]}))).status).toBe(400);
  expect((await status(request({jobKey:"../../other"}))).status).toBe(400);
  expect(start).not.toHaveBeenCalled();expect(advance).not.toHaveBeenCalled();
 });
 it("normalizes selected countries",async()=>{
  expect((await begin(request({date:"2026-09-28",countries:["US","JP","US"]}))).status).toBe(200);
  expect(start).toHaveBeenCalledWith({date:"2026-09-28",countries:["JP","US"]});
 });
});
