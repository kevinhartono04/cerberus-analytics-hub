import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { canManageUsers, jsonError, requireCurrentAppUser } from "@/lib/auth";
import {
  getEventGenerationRecord,
  getLibrarySnapshot,
  saveEventGenerationRecord,
} from "@/lib/db";
import {
  generateWithConfig,
  generationConfigSchema,
  seedGenerationConfig,
} from "@/lib/event-generation-config";
import { intakeSchema } from "@/lib/types";
export const runtime = "nodejs";
async function admin(request: Request) {
  const user = await requireCurrentAppUser(request);
  if (!canManageUsers(user))
    throw new Response(JSON.stringify({ error: "Admins only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  return user;
}
function failure(error: unknown) {
  return error instanceof ZodError
    ? NextResponse.json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      )
    : jsonError(error);
}
export async function GET(request: Request) {
  try {
    await admin(request);
    const record = await getEventGenerationRecord();
    const seed = record ? null : seedGenerationConfig(getLibrarySnapshot());
    return NextResponse.json(
      record ?? {
        revision: 0,
        version: 0,
        draft: seed,
        published: seed,
        updatedAt: "",
        updatedBy: "",
      },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await admin(request);
    const body = z
      .object({
        action: z.enum(["save", "preview", "publish"]),
        revision: z.number().int().nonnegative(),
        config: generationConfigSchema,
        intake: intakeSchema.optional(),
      })
      .parse(await request.json());
    if (body.action === "preview") {
      if (!body.intake)
        return NextResponse.json(
          { error: "An intake is required" },
          { status: 400 },
        );
      return NextResponse.json(
        generateWithConfig(body.intake, getLibrarySnapshot(), body.config, 0),
      );
    }
    const current = await getEventGenerationRecord();
    if ((current?.revision ?? 0) !== body.revision)
      return NextResponse.json(
        {
          error:
            "Another admin updated this template. Reload the page before saving.",
        },
        { status: 409 },
      );
    if (
      body.action === "publish" &&
      (!current ||
        JSON.stringify(current.draft) !== JSON.stringify(body.config))
    )
      return NextResponse.json(
        { error: "Save the draft before publishing." },
        { status: 409 },
      );
    const record = {
      revision: body.revision + 1,
      version: (current?.version ?? 0) + (body.action === "publish" ? 1 : 0),
      draft: body.config,
      published:
        body.action === "publish"
          ? body.config
          : (current?.published ?? seedGenerationConfig(getLibrarySnapshot())),
      updatedBy: user.email,
      updatedAt: new Date().toISOString(),
    };
    if (!(await saveEventGenerationRecord(record, body.revision)))
      return NextResponse.json(
        { error: "Another admin updated this template. Reload before saving." },
        { status: 409 },
      );
    return NextResponse.json(record);
  } catch (error) {
    return failure(error);
  }
}
