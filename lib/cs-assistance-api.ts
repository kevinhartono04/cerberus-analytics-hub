import { z, ZodError } from "zod";
import { assertInternalAppUser, requireCurrentAppUser } from "@/lib/auth";
import { AssistanceError, startAssistance, pollAssistance } from "@/lib/cs-assistance";
const headers = { "Cache-Control": "no-store" };
export async function handleAssistance(request: Request, polling = false) {
  try {
    const user = await requireCurrentAppUser(request);
    assertInternalAppUser(user);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== (request.headers.get("host") ?? new URL(request.url).host)) return Response.json({ error: "Request origin is not allowed." }, { status: 403, headers });
    const raw = await request.text();
    if (raw.length > 10000) return Response.json({ error: "Request is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Enter a valid request." }, { status: 400, headers }); }
    const result = polling
      ? await pollAssistance(z.object({ token: z.string().min(1).max(8192) }).parse(body).token, user.id)
      : await startAssistance(body, user.id);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ZodError) return Response.json({ error: error.issues.map(i => i.message).join(" ") }, { status: 400, headers });
    if (error instanceof AssistanceError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "The event query could not complete. Please try again. No refund recommendation was made." }, { status: 502, headers });
  }
}
