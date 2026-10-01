import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSenseGame } from "@/lib/ludios-sense";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertInternalAppUser(await requireCurrentAppUser(request));
    const { jobKey, appId, store, generatedAt } = z.object({ jobKey: z.string().regex(/^sense:v1:[a-f0-9]{64}$/), appId: z.string().min(1).max(200), store: z.enum(["android", "ios"]), generatedAt: z.string().datetime().optional() }).parse(await request.json());
    return NextResponse.json(await getSenseGame(jobKey, appId, store, generatedAt));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid game selection" }, { status: 400 });
    return jsonError(error);
  }
}
