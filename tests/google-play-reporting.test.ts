import { describe, expect, it } from "vitest";

import { releaseMatchesAppVersion } from "@/lib/google-play-reporting";

describe("Google Play release version matching", () => {
  it.each([
    "0.7.0",
    "Version 0.7.0",
    "125 (0.7.0)",
    "125 (v0.7.0)",
    "Release v0.7.0 (production)",
  ])("matches the app version inside %s", (displayName) => {
    expect(releaseMatchesAppVersion(displayName, "0.7.0")).toBe(true);
  });

  it.each([
    "125 (0.7.0.1)",
    "125 (0.7.0-beta)",
    "125 (10.7.0)",
    "125 (0.7)",
  ])("does not partially match %s", (displayName) => {
    expect(releaseMatchesAppVersion(displayName, "0.7.0")).toBe(false);
  });
});
