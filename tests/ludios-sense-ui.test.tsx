import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LudiosSense from "@/components/LudiosSense";
vi.mock("@/components/CerberusShell",()=>({default:({children}:{children:React.ReactNode})=><main>{children}</main>}));
beforeEach(()=>{sessionStorage.clear();vi.unstubAllGlobals();});
describe("Sense page",()=>{
 it("defaults to today and seven selected markets, sends unchecked selection, and renders the completed report",async()=>{
  const fetch=vi.fn(async(_url:string,init:RequestInit)=>{const filters=JSON.parse(init.body as string);return Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:12,progress:"Check complete",result:{filters:{...filters,countries:[...filters.countries].sort()},games:[],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28",android:"2026-09-28"},coverageComplete:true,errors:[],ruleVersion:"1.4-aggregate",requests:12}});});
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  expect(screen.getByLabelText("Date (t)")).toHaveValue(new Date().toISOString().slice(0,10));
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);screen.getAllByRole("checkbox").forEach(c=>expect(c).toBeChecked());
  fireEvent.click(screen.getByRole("checkbox",{name:"Japan"}));fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(screen.getByText("Research shortlist")).toBeInTheDocument());
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).countries).not.toContain("JP");
  expect(screen.getByText(/Requested t:/)).toHaveTextContent("2026-09-28");
 });
 it("disables checks when every country is unchecked",()=>{
  render(<LudiosSense/>);screen.getAllByRole("checkbox").forEach(c=>fireEvent.click(c));
  expect(screen.getByRole("button",{name:"Run check"})).toBeDisabled();
 });
});
