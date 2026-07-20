import { NextResponse } from "next/server";

import { addPermissions, assertCanCreateSpec, assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { saveSpec } from "@/lib/db";
import { isImportSpecError, parseAnalyticsSpecFile } from "@/lib/import-spec";

export const runtime = "nodejs";

type UploadedFile = {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    await assertCanCreateSpec(user);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!isUploadedFile(file)) {
      return NextResponse.json({ error: "Attach an XLSX or CSV file in the file field." }, { status: 400 });
    }

    const spec = parseAnalyticsSpecFile({
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      gameTitle: typeof formData.get("gameTitle") === "string" ? String(formData.get("gameTitle")) : undefined,
      genre: typeof formData.get("genre") === "string" ? String(formData.get("genre")) : undefined,
    });
    const saved = await saveSpec(spec, user);

    return NextResponse.json({
      spec,
      summary: addPermissions(saved, user),
    });
  } catch (error) {
    if (isImportSpecError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return jsonError(error);
  }
}
