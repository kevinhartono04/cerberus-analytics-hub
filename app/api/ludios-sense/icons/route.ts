import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSenseStatus } from "@/lib/ludios-sense";
import { getSenseIcons } from "@/lib/ludios-sense-icons";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const input = z.object({ jobKey: z.string().regex(/^sense:v1:[a-f0-9]{64}$/), store: z.enum(["ios","android"]), appIds: z.array(z.string().min(1).max(200)).min(1).max(100) }).parse(await request.json());
    const { result } = await getSenseStatus(input.jobKey);
    if (!result) throw new Response("Report unavailable", { status: 404 });
    const ids = [...new Set(input.appIds)];
    const games = ids.map(id => result.games.find(g => g.store === input.store && g.appId === id));
    if (games.some(g => !g)) throw new Response("Invalid game selection", { status: 400 });
    return NextResponse.json(await getSenseIcons(games as NonNullable<typeof games[number]>[], input.store, result.filters.countries.includes("US") ? "US" : result.filters.countries[0]));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid game selection" }, { status: 400 });
    return jsonError(error);
  }
}
