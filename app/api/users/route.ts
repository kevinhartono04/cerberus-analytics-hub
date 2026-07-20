import { NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { canManageUsers, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { createInternalAppUser, listAppUsers } from "@/lib/db";
import { isTripledotEmail } from "@/lib/partner-access";
import { userRoleSchema } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    if (!canManageUsers(user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
    return NextResponse.json(await listAppUsers());
  } catch (error) {
    return jsonError(error);
  }
}

const createUserSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().max(120).optional().default(""),
  role: userRoleSchema,
});

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    if (!canManageUsers(user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
    const body = createUserSchema.parse(await request.json());
    if (!isTripledotEmail(body.email)) {
      return NextResponse.json({ error: "Only @tripledotstudios.com users can be added here. Manage partners by domain below." }, { status: 400 });
    }
    return NextResponse.json(await createInternalAppUser(body), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    if (error instanceof Error && error.message.includes("already exists")) return NextResponse.json({ error: error.message }, { status: 409 });
    return jsonError(error);
  }
}
