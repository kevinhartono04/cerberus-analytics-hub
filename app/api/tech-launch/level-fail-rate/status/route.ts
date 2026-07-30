import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertCanUseTechLaunch, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getLevelFailRateStatus, levelFailRateStatusRequestSchema, recordGameplayAlertDashboardObservation } from "@/lib/gameplay-alerts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const requestBody = levelFailRateStatusRequestSchema.parse(await request.json());
    await assertCanUseTechLaunch(user, requestBody.filters.appName);
    const response = await getLevelFailRateStatus(requestBody);
    // Polling may finish a dashboard query. Record it, but never deliver Slack
    // from an analyst-initiated request.
    try {
      await recordGameplayAlertDashboardObservation(requestBody.filters, response);
    } catch (error) {
      console.warn("Could not save gameplay dashboard observation", error);
    }
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
