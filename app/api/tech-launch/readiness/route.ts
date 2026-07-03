import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getTechLaunchReadiness } from "@/lib/tech-launch";

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
    await requireCurrentAppUser(request);
    const body = await request.json();
    return NextResponse.json(await getTechLaunchReadiness(body));
  } catch (error) {
    const issues = zodIssues(error);
    if (issues) {
      return NextResponse.json({ error: issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    }
    return jsonError(error);
  }
}
