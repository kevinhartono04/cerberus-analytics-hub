import type { UserRole } from "@/lib/types";
import { isTripledotEmail } from "@/lib/partner-access";

export function emailSetFromEnv(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedAuthEmail(email: string | null | undefined) {
  return isTripledotEmail(email);
}

export function configuredRoleForEmail(
  email: string,
  options: { adminEmails?: string; editorEmails?: string } = {},
): UserRole {
  const normalizedEmail = email.toLowerCase();
  if (emailSetFromEnv(options.adminEmails ?? process.env.ADMIN_EMAILS).has(normalizedEmail)) return "admin";
  if (emailSetFromEnv(options.editorEmails ?? process.env.EDITOR_EMAILS).has(normalizedEmail)) return "editor";
  return "viewer";
}
