import { createHash, timingSafeEqual } from "node:crypto";
import type { AppUser } from "@/lib/types";

// This identity is only returned by the dedicated service API. It cannot sign in
// through Google, acquire a human session, or inherit a database user's role.
export function requireLiz(request: Request): AppUser {
  const configuredHash = process.env.CEREBRAL_LIZ_TOKEN_SHA256 ?? "";
  const match = /^Bearer (liz_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
  if (!/^[a-f0-9]{64}$/i.test(configuredHash) || !match) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const suppliedHash = createHash("sha256").update(match[1]).digest();
  if (!timingSafeEqual(suppliedHash, Buffer.from(configuredHash, "hex"))) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  return {
    id: "service:liz", name: "Liz", email: "liz@service.invalid", role: "editor",
    createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
  };
}
