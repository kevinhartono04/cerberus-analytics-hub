import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSenseWatchlist } from "@/lib/ludios-sense";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const { jobKey } = z.object({ jobKey: z.string().regex(/^sense:v1:[a-f0-9]{64}$/) }).parse(await request.json());
    return NextResponse.json({ games: await getSenseWatchlist(jobKey) });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    return jsonError(error);
  }
}
