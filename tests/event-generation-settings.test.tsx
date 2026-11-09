import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import EventGenerationSettings from "@/components/EventGenerationSettings";
import { getLibrarySnapshot } from "@/lib/db";
import {
  generateWithConfig,
  seedGenerationConfig,
} from "@/lib/event-generation-config";
vi.mock("@/components/CerberusShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
const snapshot = getLibrarySnapshot();
let failSave = false;
let requests: string[] = [];
beforeEach(() => {
  failSave = false;
  requests = [];
  const config = seedGenerationConfig(snapshot);
  let record = {
    revision: 0,
    version: 0,
    draft: config,
    published: config,
    updatedBy: "",
    updatedAt: "",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      if (!init?.body) return Response.json(record);
      const body = JSON.parse(init.body);
      requests.push(body.action);
      if (body.action === "preview")
        return Response.json(
          generateWithConfig(body.intake, snapshot, body.config, 0),
        );
      if (failSave)
        return Response.json(
          { error: "Could not save draft" },
          { status: 500 },
        );
      record = { ...record, revision: record.revision + 1, draft: body.config };
      return Response.json(record);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("guides saved edits through a sample game preview and review, invalidating preview after further edits", async () => {
  render(<EventGenerationSettings />);
  fireEvent.change(await screen.findByLabelText("Event name"), {
    target: { value: "New_Currency_Event" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft & test →" }));
  await screen.findByText("See what a game would generate");
  expect(requests).toEqual(["save"]);
  expect(
    screen.getByRole("button", { name: "Review changes →" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Game with economy & ads" }),
  );
  expect(screen.getByLabelText("Rewarded Ad Placements")).toHaveValue(
    "powerup, revive",
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Review changes →" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review changes →" }));
  expect(
    screen.getByRole("button", { name: "Publish version 1" }),
  ).toBeEnabled();
  expect(
    screen.getByText("Event Name: Currency_Transaction → New_Currency_Event"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /1. Edit template/ }));
  fireEvent.change(screen.getByLabelText("Event name"), {
    target: { value: "Changed_Again" },
  });
  fireEvent.click(screen.getByRole("button", { name: /3. Publish/ }));
  expect(
    screen.getByRole("button", { name: "Publish version 1" }),
  ).toBeDisabled();
});
it("keeps failed saves on the edit step with edits intact", async () => {
  failSave = true;
  render(<EventGenerationSettings />);
  fireEvent.change(await screen.findByLabelText("Event name"), {
    target: { value: "Keep_My_Edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft & test →" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Event name")).toHaveValue("Keep_My_Edit");
  expect(
    screen.queryByText("See what a game would generate"),
  ).not.toBeInTheDocument();
});
it("opens the relevant shared definition and keeps advanced rules collapsed", async () => {
  render(<EventGenerationSettings />);
  await screen.findByLabelText("Event name");
  const summary = screen.getAllByText(/Advanced generation rules/)[0];
  expect(summary.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Edit shared definition" })[0],
  );
  const fieldSearch = screen.getByLabelText(
    "Search shared fields",
  ) as HTMLInputElement;
  expect(fieldSearch.value).not.toBe("");
  expect(screen.getAllByLabelText("Payload name")).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Back to selected event" }),
  );
  expect(screen.getByLabelText("Event name")).toHaveValue(
    "Currency_Transaction",
  );
});
