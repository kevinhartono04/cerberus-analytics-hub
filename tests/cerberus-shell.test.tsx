import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import CerberusShell from "@/components/CerberusShell";

function renderShell(collapsed = false) {
  return render(
    <CerberusShell currentProduct="spec-generator" collapsed={collapsed} user={{ authenticated: false }}>
      <div>Dashboard content</div>
    </CerberusShell>,
  );
}

describe("CerberusShell theme switch", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    document.documentElement.dataset.theme = "light";
  });

  it("defaults to light mode and persists a dark-mode selection", () => {
    renderShell();

    const toggle = screen.getByRole("switch", { name: "Light mode" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("cerberus-theme")).toBe("dark");
  });

  it("reflects the preloaded persisted preference", () => {
    document.documentElement.dataset.theme = "light";
    localStorage.setItem("cerberus-theme", "dark");

    renderShell();

    expect(screen.getByRole("switch", { name: "Light mode" })).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps the light-mode control accessible when the sidebar is collapsed", () => {
    renderShell(true);

    expect(screen.getByRole("switch", { name: "Light mode" })).toHaveAttribute("title", "Light mode");
  });
});
