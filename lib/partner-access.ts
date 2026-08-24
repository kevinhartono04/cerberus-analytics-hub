import { z } from "zod";

import { getPartnerDomainAccess } from "@/lib/db";
import { launchSignalDashboardSuite } from "@/lib/launch-signal-access";
import { techLaunchAppOptions } from "@/lib/tech-launch";

const publicEmailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

const domainPattern = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isTripledotEmail(email: string | null | undefined) {
  return normalizeEmail(email).endsWith("@tripledotstudios.com");
}

export function domainFromEmail(email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  const separator = normalized.lastIndexOf("@");
  return separator > 0 ? normalized.slice(separator + 1) : "";
}

export function normalizePartnerDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  if (!domainPattern.test(domain)) throw new Error("Enter a valid corporate email domain");
  if (publicEmailDomains.has(domain)) throw new Error("Public email domains are not supported");
  if (domain === "tripledotstudios.com") throw new Error("Tripledot is managed through internal access");
  return domain;
}

export function defaultPartnerDomainExpiry() {
  const expiry = new Date();
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString();
}

export function expiryDateInputValue(expiresAt: string) {
  return expiresAt.slice(0, 10);
}

export function expiryFromDateInput(value: string) {
  if (!datePattern.test(value)) throw new Error("Use an expiry date in YYYY-MM-DD format");
  const expiry = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) throw new Error("Use a valid expiry date");
  if (expiry.getTime() <= Date.now()) throw new Error("Expiry must be in the future");
  return expiry.toISOString();
}

export const partnerDomainAccessInputSchema = z.object({
  domain: z.string().transform(normalizePartnerDomain),
  enabled: z.boolean().default(true),
  expiresOn: z.string().transform(expiryFromDateInput),
  allowedApps: z.array(z.enum(techLaunchAppOptions)).min(1, "Select at least one app"),
});

export type PartnerDomainAccessInput = z.infer<typeof partnerDomainAccessInputSchema>;

export async function getExternalLaunchSignalAccess(email: string) {
  const allowedApps = await getExternalTechLaunchApps(email);
  return {
    allowedApps,
    dashboardSuite: allowedApps.length ? [...launchSignalDashboardSuite] : [],
  };
}

export async function getExternalTechLaunchApps(email: string) {
  if (isTripledotEmail(email)) return [...techLaunchAppOptions];
  const domain = domainFromEmail(email);
  if (!domain) return [];
  const access = await getPartnerDomainAccess(domain);
  if (!access?.enabled || new Date(access.expiresAt).getTime() <= Date.now()) return [];
  return access.allowedApps;
}

export async function isAllowedExternalGoogleEmail(email: string | null | undefined, emailVerified: boolean) {
  const normalized = normalizeEmail(email);
  if (!normalized || !emailVerified) return false;
  if (isTripledotEmail(normalized)) return true;
  return (await getExternalTechLaunchApps(normalized)).length > 0;
}
