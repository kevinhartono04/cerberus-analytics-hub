import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertCanUseTechLaunch, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getLevelFailRate, levelFunnelFilterSchema, recordGameplayAlertDashboardObservation } from "@/lib/gameplay-alerts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const filters = levelFunnelFilterSchema.parse(await request.json());
    await assertCanUseTechLaunch(user, filters.appName);
    const response = await getLevelFailRate(filters);
    // Observations are useful audit records, but a storage failure must not
    // make the analyst-facing dashboard unavailable. This path never sends Slack.
    try {
      await recordGameplayAlertDashboardObservation(filters, response);
    } catch (error) {
      console.warn("Could not save gameplay dashboard observation", error);
    }
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    return jsonError(error);
  }
}
