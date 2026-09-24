import { handleAssistance } from "@/lib/cs-assistance-api";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) { return handleAssistance(request); }
