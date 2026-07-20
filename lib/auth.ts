import { getSavedSpecSummary, syncAppUser } from "@/lib/db";
import { configuredRoleForEmail } from "@/lib/auth-policy";
import { getExternalTechLaunchApps, isTripledotEmail } from "@/lib/partner-access";
import { techLaunchAppOptions } from "@/lib/tech-launch";
import type { AppUser, SavedSpecSummary, UserRole } from "@/lib/types";
import { userRoleSchema } from "@/lib/types";

type Identity = {
  id: string;
  email: string;
  name: string;
};

function hasAuthServerConfig() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

function allowLocalAuthFallback() {
  return process.env.NODE_ENV !== "production" && !hasAuthServerConfig();
}

function identityFromRequestHeaders(request?: Request): Identity | null {
  if (!allowLocalAuthFallback()) return null;
  const id = request?.headers.get("x-test-user-id");
  const email = request?.headers.get("x-test-user-email");
  if (!id || !email) return null;

  return {
    id,
    email,
    name: request?.headers.get("x-test-user-name") ?? email,
  };
}

function localFallbackIdentity(): Identity | null {
  if (!allowLocalAuthFallback()) return null;
  if (process.env.NODE_ENV === "test" && process.env.AUTH_LOCAL_ADMIN !== "true") return null;
  return {
    id: "local-admin",
    email: "local-admin@example.com",
    name: "Local Admin",
  };
}

function initialRoleFor(identity: Identity): UserRole {
  if (identity.id === "local-admin") return "admin";
  if (!isTripledotEmail(identity.email)) return "viewer";
  return configuredRoleForEmail(identity.email);
}

export async function getCurrentAppUser(request?: Request): Promise<AppUser | null> {
  const headerIdentity = identityFromRequestHeaders(request);
  if (headerIdentity) {
    const headerRole = userRoleSchema.safeParse(request?.headers.get("x-test-user-role"));
    return syncAppUser(headerIdentity, headerRole.success ? headerRole.data : initialRoleFor(headerIdentity));
  }

  if (!hasAuthServerConfig()) {
    const fallbackIdentity = localFallbackIdentity();
    return fallbackIdentity ? syncAppUser(fallbackIdentity, initialRoleFor(fallbackIdentity)) : null;
  }

  const { auth } = await import("@/auth");
  const session = await auth();
  const sessionUser = session?.user as { id?: string; email?: string | null; name?: string | null } | undefined;
  const email = sessionUser?.email;
  if (!sessionUser || !email) return null;

  return syncAppUser(
    {
      id: sessionUser.id ?? `google:${email}`,
      email,
      name: sessionUser.name ?? email,
    },
    initialRoleFor({ id: sessionUser.id ?? `google:${email}`, email, name: sessionUser.name ?? email }),
  );
}

export async function requireCurrentAppUser(request?: Request): Promise<AppUser> {
  const user = await getCurrentAppUser(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

export function canCreateSpec(user: AppUser) {
  return isInternalAppUser(user) && (user.role === "admin" || user.role === "editor");
}

export function canManageUsers(user: AppUser) {
  return isInternalAppUser(user) && user.role === "admin";
}

export function canMutateSpec(user: AppUser, spec: Pick<SavedSpecSummary, "ownerUserId"> | null) {
  if (!isInternalAppUser(user)) return false;
  if (user.role === "admin") return true;
  if (user.role !== "editor" || !spec?.ownerUserId) return false;
  return spec.ownerUserId === user.id;
}

export function isExternalAppUser(user: AppUser) {
  return !isInternalAppUser(user);
}

export function isInternalAppUser(user: AppUser) {
  return user.id === "local-admin" || isTripledotEmail(user.email);
}

export async function techLaunchAppsForUser(user: AppUser) {
  if (isInternalAppUser(user)) return [...techLaunchAppOptions];
  return getExternalTechLaunchApps(user.email);
}

export async function assertCanUseTechLaunch(user: AppUser, appName: string) {
  const allowedApps = await techLaunchAppsForUser(user);
  if (!allowedApps.includes(appName)) {
    throw new Response(JSON.stringify({ error: "You do not have access to this app's Launch Readiness data" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export function assertInternalAppUser(user: AppUser) {
  if (isExternalAppUser(user)) {
    throw new Response(JSON.stringify({ error: "External accounts can access Launch Readiness only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export function addPermissions(summary: SavedSpecSummary, user: AppUser): SavedSpecSummary {
  const canMutate = canMutateSpec(user, summary);
  return {
    ...summary,
    canEdit: canMutate,
    canDelete: canMutate,
  };
}

export async function assertCanCreateSpec(user: AppUser) {
  if (!canCreateSpec(user)) {
    throw new Response(JSON.stringify({ error: "Viewers cannot create or save specs" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function assertCanMutateSpec(user: AppUser, id: string) {
  const summary = await getSavedSpecSummary(id);
  if (!summary) return null;
  if (!canMutateSpec(user, summary)) {
    throw new Response(JSON.stringify({ error: "You do not have permission to modify this spec" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return summary;
}

export function jsonError(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
}
