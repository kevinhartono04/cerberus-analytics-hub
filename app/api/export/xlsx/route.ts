import { NextResponse } from "next/server";

import { specToWorkbookBuffer } from "@/lib/export";
import { generatedSpecSchema } from "@/lib/types";

export async function POST(request: Request) {
  const spec = generatedSpecSchema.parse(await request.json());
  const buffer = specToWorkbookBuffer(spec);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="analytics-spec.xlsx"`,
    },
  });
}
