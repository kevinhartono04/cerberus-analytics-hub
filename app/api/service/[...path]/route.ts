import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getSavedSpec, listSavedSpecs, saveSpec } from "@/lib/db";
import { registeredGames } from "@/lib/game-registry";
import { requireLiz } from "@/lib/service-auth";
import { generatedSpecSchema, type SavedSpecSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

const permissions = (spec: SavedSpecSummary) => ({ ...spec, canEdit: true, canDelete: false });

async function handle(request: Request, context: Context) {
  const requestId = randomUUID();
  let actor: string | null = null;
  let action = "unsupported";
  let specId: string | undefined;
  let status = 500;
  const reply = (body: unknown, code = 200) => {
    status = code;
    return Response.json(body, {
      status: code,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  };
  try {
    const user = requireLiz(request);
    actor = user.id;
    const { path } = await context.params;
    const method = request.method;
    if (path.length === 1 && path[0] === "games" && method === "GET") {
      action = "games.read";
      return reply({ games: await registeredGames(), canManage: false });
    }
    if (path.length === 1 && path[0] === "specs" && method === "GET") {
      action = "specs.list";
      return reply((await listSavedSpecs()).map(permissions));
    }
    if (path.length === 1 && path[0] === "specs" && method === "POST") {
      action = "specs.create";
      // Server IDs keep a create request from overwriting an existing spec.
      const body = await request.json();
      const spec = generatedSpecSchema.parse({ ...body, id: randomUUID() });
      specId = spec.id;
      return reply(permissions(await saveSpec(spec, user)), 201);
    }
    if (path.length === 2 && path[0] === "specs" && ["GET", "PUT"].includes(method)) {
      specId = path[1];
      action = method === "GET" ? "specs.read" : "specs.update";
      const existing = await getSavedSpec(specId);
      if (!existing) return reply({ error: "Spec not found" }, 404);
      if (method === "GET") return reply(existing);
      const spec = generatedSpecSchema.parse(await request.json());
      if (spec.id !== specId) return reply({ error: "Spec id mismatch" }, 400);
      return reply(permissions(await saveSpec(spec, user)));
    }
    return reply({ error: "This operation is not permitted for Liz" }, 403);
  } catch (error) {
    if (error instanceof Response) return reply({ error: "Unauthorized" }, error.status);
    if (error instanceof ZodError) return reply({ error: "Invalid spec", issues: error.issues }, 400);
    if (error instanceof SyntaxError) return reply({ error: "Invalid JSON" }, 400);
    // Do not return database errors or credentials to a caller.
    return reply({ error: "Service operation failed", requestId }, 500);
  } finally {
    // Structured deployment logs attribute edits without logging tokens or spec data.
    // Existing owners are preserved by saveSpec; audit actor is separate from owner.
    console.info(JSON.stringify({
      event: "cerebral.service_access", timestamp: new Date().toISOString(),
      requestId, actor, action, specId, status,
    }));
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH, handle as HEAD, handle as OPTIONS };
