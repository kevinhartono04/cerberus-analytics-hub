import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSpecCheckAppVersions } from "@/lib/spec-check";

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
    assertInternalAppUser(await requireCurrentAppUser(request));
    const body = await request.json();
    return NextResponse.json(await getSpecCheckAppVersions(body));
  } catch (error) {
    const issues = zodIssues(error);
    if (issues) {
      return NextResponse.json({ error: issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    }
    return jsonError(error);
  }
}
