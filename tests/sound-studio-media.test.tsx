import React from "react";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
// @ts-expect-error The embedded workspace is JavaScript behind its typed host boundary.
import MediaAttachments from "../components/sound-studio/workspace/components/MediaAttachments";
// @ts-expect-error The embedded workspace is JavaScript behind its typed host boundary.
import ColumnResize from "../components/sound-studio/workspace/components/ColumnResize";
// @ts-expect-error The embedded workspace is JavaScript behind its typed host boundary.
import DownloadFiles from "../components/sound-studio/workspace/components/DownloadFiles";
const {upload}=vi.hoisted(()=>({upload:vi.fn()}));
vi.mock("../components/sound-studio/workspace/adapters/repository",()=>({repository:{upload}}));
vi.mock("../components/sound-studio/workspace/components/Media",()=>({AudioPreview:()=>null,VideoPreview:()=>null}));
vi.mock("../components/sound-studio/workspace/components/Library",()=>({downloadUrl:(url:string)=>url,downloadName:()=>"audio.wav"}));
vi.mock("../components/sound-studio/workspace/components/ui",()=>({
  Button:({children,icon,...props}:any)=><button {...props}>{children}</button>,
  Icon:()=>null, AudioSourcePicker:()=>null,FileCredit:()=>null,
  Modal:({children,title}:any)=><div role="dialog" aria-label={title}>{children}</div>
}));
vi.mock("../components/sound-studio/workspace/components/DriveImport",()=>({default:()=>null}));
afterEach(cleanup);
beforeEach(()=>{upload.mockReset();upload.mockImplementation(async(file:File)=>({url:`blob:${file.name}`}));});
const audio=(name:string)=>new File(["sample"],name,{type:"audio/wav"});
const drop=(files:File[])=>fireEvent.drop(screen.getByLabelText("Cue audio"),{dataTransfer:{types:["Files"],files}});
describe("Sound Studio audio drop",()=>{
  it("attaches multiple files together while preserving existing audio",async()=>{
    const onChange=vi.fn();const existing={url:"blob:existing",name:"existing.wav"};
    render(<MediaAttachments type="audio" files={[existing]} label="Cue audio" onChange={onChange}/>);
    drop([audio("one.wav"),audio("two.wav")]);
    await waitFor(()=>expect(onChange).toHaveBeenCalledWith([existing,{url:"blob:one.wav",name:"one.wav"},{url:"blob:two.wav",name:"two.wav"}]));
    expect(upload).toHaveBeenCalledTimes(2);
  });
  it("rejects an invalid mixed batch before storing any files",async()=>{
    const onChange=vi.fn();render(<MediaAttachments type="audio" files={[]} label="Cue audio" onChange={onChange}/>);
    drop([audio("one.wav"),audio("video.mov")]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a WAV");
    expect(upload).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();
  });
  it("ignores repeat drops while an upload is active and reports storage errors",async()=>{
    let rejectUpload!:(error:Error)=>void;
    upload.mockImplementation(()=>new Promise((_,reject)=>{rejectUpload=reject;}));
    const onChange=vi.fn();render(<MediaAttachments type="audio" files={[]} label="Cue audio" onChange={onChange}/>);
    drop([audio("one.wav")]);drop([audio("two.wav")]);
    expect(upload).toHaveBeenCalledTimes(1);
    rejectUpload(new Error("Storage full"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(onChange).not.toHaveBeenCalled();
  });
});
it("column resizing supports keyboard adjustment and reset without submitting a form",()=>{
  const onResize=vi.fn(),onSubmit=vi.fn();
  const rect=vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){return {width:this.tagName==="TABLE"?1000:500} as DOMRect;});
  render(<form onSubmit={onSubmit}><table><thead><tr><th>Sound ID<ColumnResize label="Sound ID" index={0} onResize={onResize}/></th><th>Notes</th></tr></thead></table></form>);
  const handle=screen.getByRole("button",{name:"Resize Sound ID column"});
  fireEvent.keyDown(handle,{key:"ArrowRight"});expect(onResize).toHaveBeenLastCalledWith(0,1,[50,50]);
  fireEvent.keyDown(handle,{key:"Home"});expect(onResize).toHaveBeenLastCalledWith(null,1,[50,50]);
  fireEvent.click(handle);expect(onSubmit).not.toHaveBeenCalled();rect.mockRestore();
});

it("bulk download selection excludes Drive links and supports clearing the selection",()=>{
  render(<DownloadFiles files={[{name:"local.wav",url:"/local.wav",type:"audio"},{name:"restricted.wav",url:"https://drive.google.com/file/d/abc/view",type:"audio"}]}/>);
  fireEvent.click(screen.getByRole("button",{name:"Download files"}));
  expect(screen.getByRole("checkbox",{name:"Select local.wav"})).toBeChecked();
  expect(screen.getByRole("checkbox",{name:"Select restricted.wav"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Download selected (1)"})).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"Clear selection"}));
  expect(screen.getByRole("button",{name:"Download selected (0)"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Download available as ZIP"})).toBeEnabled();
});
