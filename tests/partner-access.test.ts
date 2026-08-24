import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPartnerDomainAccess: vi.fn() }));

vi.mock("@/lib/db", () => ({ getPartnerDomainAccess: mocks.getPartnerDomainAccess }));

import {
  getExternalLaunchSignalAccess,
  getExternalTechLaunchApps,
  isAllowedExternalGoogleEmail,
  normalizePartnerDomain,
  partnerDomainAccessInputSchema,
} from "@/lib/partner-access";

describe("partner domain access", () => {
  beforeEach(() => {
    mocks.getPartnerDomainAccess.mockReset();
  });

  it("normalizes corporate domains and rejects public domains", () => {
    expect(normalizePartnerDomain("@PartnerStudio.com")).toBe("partnerstudio.com");
    expect(() => normalizePartnerDomain("gmail.com")).toThrow("Public email domains");
    expect(() => normalizePartnerDomain("not a domain")).toThrow("valid corporate");
  });

  it("allows verified Google users at an active partner domain", async () => {
    mocks.getPartnerDomainAccess.mockResolvedValue({ enabled: true, expiresAt: "2099-01-01T00:00:00.000Z", allowedApps: ["woodoku"] });
    await expect(isAllowedExternalGoogleEmail("partner@partnerstudio.com", true)).resolves.toBe(true);
    await expect(getExternalTechLaunchApps("partner@partnerstudio.com")).resolves.toEqual(["woodoku"]);
    await expect(getExternalLaunchSignalAccess("partner@partnerstudio.com")).resolves.toEqual({
      allowedApps: ["woodoku"],
      dashboardSuite: [
        { id: "technical-readiness", label: "Technical Readiness" },
        { id: "level-funnel", label: "Level Funnel Check" },
        { id: "game-monitoring", label: "Game Monitoring" },
        { id: "incent-config-validator", label: "Incent Config Validator" },
      ],
    });
  });

  it("rejects unverified, expired, and unknown partner accounts", async () => {
    mocks.getPartnerDomainAccess.mockResolvedValue({ enabled: true, expiresAt: "2000-01-01T00:00:00.000Z", allowedApps: ["woodoku"] });
    await expect(isAllowedExternalGoogleEmail("partner@partnerstudio.com", true)).resolves.toBe(false);
    await expect(isAllowedExternalGoogleEmail("partner@partnerstudio.com", false)).resolves.toBe(false);
    mocks.getPartnerDomainAccess.mockResolvedValue(null);
    await expect(isAllowedExternalGoogleEmail("partner@partnerstudio.com", true)).resolves.toBe(false);
  });

  it("validates an app grant and a future expiry", () => {
    expect(partnerDomainAccessInputSchema.parse({
      domain: "partnerstudio.com",
      expiresOn: "2099-01-01",
      allowedApps: ["woodoku"],
    }).domain).toBe("partnerstudio.com");
    expect(() => partnerDomainAccessInputSchema.parse({
      domain: "partnerstudio.com",
      expiresOn: "2000-01-01",
      allowedApps: ["woodoku"],
    })).toThrow();
  });
});
