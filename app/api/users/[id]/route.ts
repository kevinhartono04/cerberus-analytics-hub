import { NextResponse } from "next/server";

import { canManageUsers, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { listAppUsers, updateAppUserRole } from "@/lib/db";
import { isTripledotEmail } from "@/lib/partner-access";
import { userRoleSchema } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireCurrentAppUser(request);
    if (!canManageUsers(actor)) return NextResponse.json({ error: "Admins only" }, { status: 403 });

    const body = await request.json();
    const role = userRoleSchema.parse(body.role);
    const { id } = await context.params;
    const target = (await listAppUsers()).find((candidate) => candidate.id === id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!isTripledotEmail(target.email)) return NextResponse.json({ error: "External users are always viewers" }, { status: 403 });
    const user = await updateAppUserRole(id, role);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json(user);
  } catch (error) {
    return jsonError(error);
  }
}
