import { afterEach, describe, expect, it, vi } from "vitest";
import { areAlertsPaused, isRecoveryMode } from "@/lib/recovery-mode";

describe("independent alert pause", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ["true", undefined, true], ["false", undefined, false],
    ["true", "false", false], ["false", "true", true],
    ["false", "invalid", true], ["true", "", true],
  ])("recovery=%s pause=%s yields %s", (recovery, pause, expected) => {
    vi.stubEnv("CEREBRAL_RECOVERY_MODE", recovery);
    vi.stubEnv("CEREBRAL_ALERTS_PAUSED", pause);
    expect(areAlertsPaused()).toBe(expected);
    expect(isRecoveryMode()).toBe(recovery === "true");
  });
});
