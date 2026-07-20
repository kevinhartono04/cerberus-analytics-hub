import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { canManageUsers, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { deletePartnerDomainAccess, listPartnerDomainAccess, savePartnerDomainAccess } from "@/lib/db";
import { partnerDomainAccessInputSchema } from "@/lib/partner-access";

export const runtime = "nodejs";

function assertAdmin(user: Awaited<ReturnType<typeof requireCurrentAppUser>>) {
  if (!canManageUsers(user)) {
    throw new Response(JSON.stringify({ error: "Admins only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(request: Request) {
  try {
    assertAdmin(await requireCurrentAppUser(request));
    return NextResponse.json(await listPartnerDomainAccess());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    assertAdmin(user);
    const body = partnerDomainAccessInputSchema.parse(await request.json());
    return NextResponse.json(
      await savePartnerDomainAccess({
        domain: body.domain,
        enabled: body.enabled,
        expiresAt: body.expiresOn,
        allowedApps: body.allowedApps,
        actorId: user.id,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertAdmin(await requireCurrentAppUser(request));
    const body = await request.json();
    const domain = partnerDomainAccessInputSchema.shape.domain.parse(body.domain);
    const deleted = await deletePartnerDomainAccess(domain);
    if (!deleted) return NextResponse.json({ error: "Partner domain not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
