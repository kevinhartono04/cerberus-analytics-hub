import fs from "node:fs";
import path from "node:path";
import { getCountQuery, submitCountSql } from "@/lib/count-api";
import type { QueryInput, TraceProvider } from "./model";
import { observedToTrace, parseFactCsv } from "./event-trace";
export function buildTraceSql(input: QueryInput) {
  if (!/^[a-f0-9]{32}$/.test(input.idfv)) throw new Error("Invalid IDFV");
  const validTime = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
  if (!validTime(input.from) || !validTime(input.through) || input.from >= input.through || Date.parse(input.through) - Date.parse(input.from) > 90 * 86400000) throw new Error("Invalid trace window");
  return fs.readFileSync(path.join(process.cwd(), "data/refund-review/event-trace.sql"), "utf8")
    .replaceAll("{{IDFV}}", input.idfv).replaceAll("{{FROM}}", input.from).replaceAll("{{THROUGH}}", input.through);
}
export function liveProvider(): TraceProvider {
  return {
    async submit(input) {
      const { query } = await submitCountSql(buildTraceSql(input), { cacheStrategy: "default", signal: AbortSignal.timeout(8000) });
      return JSON.stringify({ key: query.job_key, from: input.from, through: input.through });
    },
    async poll(token) {
      const context = JSON.parse(token) as { key: string; from: string; through: string };
      const { query } = await getCountQuery(context.key, 1000, AbortSignal.timeout(8000));
      if (query.status === "running") return { status: "pending" };
      if (query.status === "error") throw new Error("Trace query failed");
      if (!query.result_preview) throw new Error("Trace query returned no result metadata");
      const observed = parseFactCsv(query.result_preview, query.result_metadata?.num_rows);
      if (observed.meta.from !== context.from || observed.meta.through !== context.through) throw new Error("Trace query window mismatch");
      return { status: "complete", trace: observedToTrace(observed) };
    },
  };
}
