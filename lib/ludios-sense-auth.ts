import { assertInternalAppUser, requireCurrentAppUser } from "@/lib/auth";
import { requireLiz } from "@/lib/service-auth";

type ReportingOperation = "start" | "status" | "continue" | "report" | "recent" | "usage" | "cache" | "game" | "icons";

/** Opt-in authentication for Sense reporting only; never grants a human session. */
export async function requireSenseReportingUser(request: Request, operation: ReportingOperation) {
  if (request.headers.has("authorization")) {
    // An invalid supplied credential must not fall back to cookies/local auth.
    const user = requireLiz(request);
    console.info(JSON.stringify({
      event: "cerebral.service_access", timestamp: new Date().toISOString(),
      actor: user.id, action: `sense.${operation}`, outcome: "authorized",
    }));
    return user;
  }
  const user = await requireCurrentAppUser(request);
  assertInternalAppUser(user);
  return user;
}
