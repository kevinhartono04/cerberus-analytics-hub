import { describe,expect,it } from "vitest";
import { sensePreviewPosition } from "@/lib/ludios-sense-preview";
describe("preview placement",()=>{
 for(const [label,icon,viewport] of [
  ["leftmost desktop icon",{left:20,right:132,top:100,bottom:212},{width:1440,height:900}],
  ["rightmost desktop icon",{left:1290,right:1402,top:720,bottom:832},{width:1440,height:900}],
  ["mobile top icon",{left:20,right:132,top:100,bottom:212},{width:390,height:844}],
  ["mobile bottom icon",{left:230,right:342,top:650,bottom:762},{width:390,height:844}],
  ["short viewport",{left:120,right:232,top:145,bottom:257},{width:390,height:400}],
 ] as const)it(`keeps ${label} unobstructed and the preview inside the viewport`,()=>{
  const p=sensePreviewPosition(icon,viewport);
  expect(p.left).toBeGreaterThanOrEqual(12);expect(p.top).toBeGreaterThanOrEqual(12);
  expect(p.left+p.width).toBeLessThanOrEqual(viewport.width-12);
  expect(p.top+p.maxHeight).toBeLessThanOrEqual(viewport.height-12);
  expect(p.maxHeight).toBeGreaterThan(0);
  expect(p.left>=icon.right+12 || p.left+p.width<=icon.left-12 || p.top>=icon.bottom+12 || p.top+p.maxHeight<=icon.top-12).toBe(true);
 });
});
