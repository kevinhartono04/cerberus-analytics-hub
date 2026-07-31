import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertCanUseTechLaunch, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { gameMonitoringStatusRequestSchema, getGameMonitoringStatus } from "@/lib/game-monitoring";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const body = gameMonitoringStatusRequestSchema.parse(await request.json());
    await assertCanUseTechLaunch(user, body.filters.appName);
    return NextResponse.json(await getGameMonitoringStatus(body));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
