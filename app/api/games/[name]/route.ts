import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { canCreateSpec, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { editGame } from "@/lib/game-registry";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const user = await requireCurrentAppUser(request);
    if (!canCreateSpec(user)) return NextResponse.json({ error: "Only internal editors and admins can edit games" }, { status: 403 });
    const { name } = await context.params;
    return NextResponse.json({ game: await editGame(name, await request.json()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
