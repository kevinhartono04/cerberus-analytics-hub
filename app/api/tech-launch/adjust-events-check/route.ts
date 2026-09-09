import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AdjustEventsConfigurationError,
  AdjustEventsProviderError,
  adjustEventsCheckRequestSchema,
  getAdjustEventsCheck,
} from "@/lib/adjust-events";
import { assertCanUseTechLaunch, jsonError, requireCurrentAppUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const body = adjustEventsCheckRequestSchema.parse(await request.json());
    await assertCanUseTechLaunch(user, body.appName);
    return NextResponse.json(await getAdjustEventsCheck(body));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    if (error instanceof AdjustEventsConfigurationError) return NextResponse.json({ error: "Adjust Events Check is not configured for this app" }, { status: 503 });
    if (error instanceof AdjustEventsProviderError) return NextResponse.json({ error: error.message }, { status: 502 });
    return jsonError(error);
  }
}
