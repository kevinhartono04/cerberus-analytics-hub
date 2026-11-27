import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CerberusShell from "@/components/CerberusShell";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { Wand2 } from "lucide-react";

afterEach(cleanup);

describe("Sound Studio host integration", () => {
  it("places Sound Studio below Event Studio and keeps its workspace hidden until selected", () => {
    render(<CerberusShell currentProduct="spec-generator" user={{authenticated:false}}
      navItems={[{id:"intake",label:"Intake",icon:Wand2}]} activeNav="intake"><p>Event content</p></CerberusShell>);
    const event = screen.getByRole("link", {name:"Event Studio"});
    const sound = screen.getByRole("link", {name:"Sound Studio"});
    expect(sound).toHaveAttribute("href", "/sound-studio");
    expect(event.parentElement?.parentElement?.nextElementSibling).toContainElement(sound);
    expect(event).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", {name:"Intake"})).toBeInTheDocument();
    expect(screen.queryByRole("group", {name:"Sound Studio workspace"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name:"Uploaded Files"})).not.toBeInTheDocument();
  });
  it("uses guarded navigation and highlights only the selected sound screen", () => {
    const onChange=vi.fn();
    render(<CerberusShell currentProduct="sound-studio" user={{authenticated:false}}
      soundNavigation={{active:"library",canCreate:true,onChange}}><p>Files</p></CerberusShell>);
    const workspace = screen.getByRole("group", {name:"Sound Studio workspace"});
    expect(within(workspace).getByText("Workspace")).toBeInTheDocument();
    expect(within(workspace).getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", {name:"Sound Studio"})).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link",{name:"Uploaded Files"})).toHaveAttribute("aria-current","page");
    expect(screen.getByRole("link",{name:"Event Studio"})).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("link",{name:"Saved Specs"}));
    expect(onChange).toHaveBeenCalledWith("saved");
  });
  it("hides New Game in viewer preview and preserves the external-account boundary", () => {
    const props={active:"viewer" as const,canCreate:false,onChange:vi.fn()};
    const {rerender}=render(<CerberusShell currentProduct="sound-studio" soundNavigation={props} user={{authenticated:false}}><p>Viewer</p></CerberusShell>);
    expect(screen.queryByRole("link",{name:"New Game"})).not.toBeInTheDocument();
    rerender(<CerberusShell currentProduct="tech-launch" user={{authenticated:true,accountType:"external",role:"viewer"}}><p>Launch</p></CerberusShell>);
    expect(screen.queryByRole("link",{name:"Sound Studio"})).not.toBeInTheDocument();
    expect(screen.queryByRole("group",{name:"Sound Studio workspace"})).not.toBeInTheDocument();
  });
  it("scopes every workspace style so Event Studio cannot inherit it", () => {
    const css=fs.readFileSync(path.resolve("components/sound-studio/sound-studio.css"),"utf8");
    postcss.parse(css).walkRules(rule=>{
      if(rule.parent?.type==="atrule" && /keyframes$/.test(rule.parent.name))return;
      for(const selector of rule.selectors)expect(selector).toContain(".sound-studio");
    });
  });
});
