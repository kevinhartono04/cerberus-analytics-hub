type CountEnvelope<T> = {
  success: boolean;
  request_id?: string;
  result?: T;
  code?: string;
  message?: string;
  status?: number;
};

export type CountQuery = {
  job_key: string;
  status: "running" | "completed" | "error";
  error?: string;
  compiled_sql?: string;
  sql?: string;
  result_preview?: string;
  result_metadata?: {
    columns?: Array<{ name: string; type: string }>;
    duration?: number;
    num_rows?: number;
    row_limit?: number;
    byte_limit?: number;
  };
};

type CountCacheStrategy = "default" | "force" | "cached-only";

export type CountRunSqlOptions = {
  cacheStrategy?: CountCacheStrategy;
  previewRows?: number;
};

export type CountSubmitSqlOptions = {
  cacheStrategy?: CountCacheStrategy;
};

export type CountRunSqlResult = {
  ok: true;
  query: CountQuery;
};

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function countApiBaseUrl() {
  return envValue("COUNT_API_BASE_URL") ?? "https://api.eu.count.co";
}

function countUrl(path: string) {
  const baseUrl = countApiBaseUrl().replace(/\/+$/, "");
  const normalizedPath = baseUrl.endsWith("/v1") && path.startsWith("/v1/") ? path.slice(3) : path;
  return `${baseUrl}${normalizedPath}`;
}

function countApiKey() {
  const apiKey = envValue("COUNT_API_KEY");
  if (!apiKey) throw new Error("Missing Count environment setting: COUNT_API_KEY");
  return apiKey;
}

function countContext() {
  const type = envValue("COUNT_CONTEXT_TYPE") ?? (envValue("COUNT_CANVAS_KEY") ? "canvas" : "project");
  const contextKey = envValue("COUNT_CONTEXT_KEY") ?? envValue("COUNT_PROJECT_KEY") ?? envValue("COUNT_CANVAS_KEY");
  if (type !== "project" && type !== "canvas") {
    throw new Error("COUNT_CONTEXT_TYPE must be either project or canvas");
  }
  if (!contextKey) {
    throw new Error("Missing Count environment setting: COUNT_CONTEXT_KEY, COUNT_PROJECT_KEY, or COUNT_CANVAS_KEY");
  }
  return { type, context_key: contextKey };
}

function countConnectionKey() {
  const connectionKey = envValue("COUNT_CONNECTION_KEY");
  if (!connectionKey) throw new Error("Missing Count environment setting: COUNT_CONNECTION_KEY");
  return connectionKey;
}

async function countRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(countUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${countApiKey()}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const envelope = (await response.json().catch(() => null)) as CountEnvelope<T> | null;
  if (!response.ok || !envelope?.success) {
    throw new Error(envelope?.message ?? `Count API request failed with status ${response.status}`);
  }
  if (!("result" in envelope)) throw new Error("Count API response did not include a result");
  return envelope.result as T;
}

async function runCountQuery(sql: string, cacheStrategy: CountCacheStrategy = "force") {
  return countRequest<CountQuery>("/v1/queries", {
    method: "POST",
    body: JSON.stringify({
      context: countContext(),
      source: {
        type: "connection",
        source_key: countConnectionKey(),
      },
      sql,
      cache_strategy: cacheStrategy,
    }),
  });
}

export async function submitCountSql(sql: string, options: CountSubmitSqlOptions = {}): Promise<CountRunSqlResult> {
  return {
    ok: true,
    query: await runCountQuery(sql, options.cacheStrategy ?? "default"),
  };
}

export async function getCountQuery(jobKey: string, previewRows = 1000): Promise<CountRunSqlResult> {
  const numRows = Math.max(1, Math.min(1000, Math.floor(previewRows)));
  return {
    ok: true,
    query: await countRequest<CountQuery>(`/v1/queries/${encodeURIComponent(jobKey)}?num_rows=${numRows}`),
  };
}

async function pollCountQuery(jobKey: string, previewRows = 50) {
  const startedAt = Date.now();
  const timeoutMs = Number(envValue("COUNT_QUERY_TIMEOUT_MS") ?? 30_000);
  while (true) {
    const { query } = await getCountQuery(jobKey, previewRows);
    if (query.status === "completed") return query;
    if (query.status === "error") throw new Error(query.error ?? "Count query failed");
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Count query did not complete within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function runCountSql(sql: string, options: CountRunSqlOptions = {}): Promise<CountRunSqlResult> {
  const submitted = await submitCountSql(sql, { cacheStrategy: options.cacheStrategy ?? "default" });
  const query =
    submitted.query.status === "completed"
      ? (await getCountQuery(submitted.query.job_key, options.previewRows ?? 1000)).query
      : await pollCountQuery(submitted.query.job_key, options.previewRows ?? 1000);
  return {
    ok: true,
    query,
  };
}
