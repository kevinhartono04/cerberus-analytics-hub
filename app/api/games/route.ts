import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { canCreateSpec, jsonError, requireCurrentAppUser, techLaunchAppsForUser } from "@/lib/auth";
import { addGame, registeredGames } from "@/lib/game-registry";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const allowed = await techLaunchAppsForUser(user);
    return NextResponse.json({ games: (await registeredGames()).filter(game => allowed.includes(game.name)), canManage: canCreateSpec(user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    if (!canCreateSpec(user)) return NextResponse.json({ error: "Only internal editors and admins can add games" }, { status: 403 });
    return NextResponse.json({ game: await addGame(await request.json(), user.id) }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
