import { z, ZodError } from "zod";
import { assertInternalAppUser, jsonError, requireCurrentAppUser } from "@/lib/auth";
import { getSenseReportPage } from "@/lib/ludios-sense";
import { senseJsonResponse } from "@/lib/ludios-sense-response";
import { measureSenseTransfer } from "@/lib/ludios-sense-transfer";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return measureSenseTransfer("report",async()=>{
    try {
      assertInternalAppUser(await requireCurrentAppUser(request));
      const input = z.object({jobKey:z.string().regex(/^sense:v1:[a-f0-9]{64}$/),generatedAt:z.string().datetime(),revision:z.string().datetime().optional(),page:z.number().int().min(0).max(511).default(0)}).parse(await request.json());
      return senseJsonResponse(await getSenseReportPage(input.jobKey,input.generatedAt,input.page,input.revision));
    } catch(error) {
      if (error instanceof ZodError) return Response.json({error:"Invalid report page"},{status:400});
      return jsonError(error);
    }
  });
}
