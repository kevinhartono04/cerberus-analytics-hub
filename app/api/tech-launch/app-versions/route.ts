import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertCanUseTechLaunch, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getTechLaunchAppVersions, techLaunchAppVersionsRequestSchema } from "@/lib/tech-launch";

export const runtime = "nodejs";

function zodIssues(error: unknown) {
  if (error instanceof ZodError) return error.issues;
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    return error.issues as ZodError["issues"];
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    const body = await request.json();
    const parsed = techLaunchAppVersionsRequestSchema.parse(body);
    await assertCanUseTechLaunch(user, parsed.appName);
    return NextResponse.json(await getTechLaunchAppVersions(parsed));
  } catch (error) {
    const issues = zodIssues(error);
    if (issues) {
      return NextResponse.json({ error: issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    }
    return jsonError(error);
  }
}
