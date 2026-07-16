import crypto from "node:crypto";

import { z } from "zod";

const reportingScope = "https://www.googleapis.com/auth/playdeveloperreporting";
const reportingBaseUrl = "https://playdeveloperreporting.googleapis.com/v1beta1";

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});

const appMapSchema = z.record(
  z.string(),
  z.object({
    packageName: z.string().trim().min(1),
    versionCodeOverrides: z.record(z.string(), z.array(z.string().trim().min(1))).optional(),
  }),
);

type AppMap = z.infer<typeof appMapSchema>;
type ReportingRow = {
  startTime?: { year?: number; month?: number; day?: number };
  metrics?: Array<{ metric?: string; decimalValue?: string | { value?: string } }>;
};
type QueryResponse = { rows?: ReportingRow[]; nextPageToken?: string };
type DateTime = { year?: number; month?: number; day?: number };
type MetricSet = {
  freshnessInfo?: {
    freshnesses?: Array<{ aggregationPeriod?: string; latestEndTime?: DateTime }>;
  };
};

export type GooglePlayVital = {
  value: number | null;
  distinctUsers: number;
  latestDate?: string;
};

export type GooglePlayVitals = {
  crash: GooglePlayVital;
  anr: GooglePlayVital;
  packageName: string;
  versionCodes: string[];
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function envJson(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function getAppMap(): AppMap | null {
  const value = envJson("GOOGLE_PLAY_APP_MAP_JSON");
  return value ? appMapSchema.parse(value) : null;
}

function addOneDay(value: string) {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function toDateTime(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function comparableDate(value: DateTime | undefined) {
  if (!value?.year || !value.month || !value.day) return null;
  return value.year * 10_000 + value.month * 100 + value.day;
}

function dailyFreshnessEndTime(metricSet: MetricSet) {
  const latest = metricSet.freshnessInfo?.freshnesses?.find((freshness) => freshness.aggregationPeriod === "DAILY")?.latestEndTime;
  if (comparableDate(latest) === null) return undefined;
  return { year: latest?.year, month: latest?.month, day: latest?.day };
}

function asDate(value: ReportingRow["startTime"]) {
  if (!value?.year || !value.month || !value.day) return undefined;
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const credentials = serviceAccountSchema.parse(envJson("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"));
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iss: credentials.client_email, scope: reportingScope, aud: credentials.token_uri, iat: now, exp: now + 3600 }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;
  const response = await fetch(credentials.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google Play authentication failed (${response.status})`);
  const token = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google Play authentication returned no access token");
  cachedToken = { value: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function reportingRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${reportingBaseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
    });
    if (response.ok) return (await response.json()) as T;

    const body = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : undefined;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      continue;
    }
    throw new Error(`Google Play Reporting API failed (${response.status})${message ? `: ${message}` : ""}`);
  }
  throw new Error("Google Play Reporting API failed after retries");
}

async function resolveVersionCodes(appVersion: string, config: AppMap[string]) {
  const override = config.versionCodeOverrides?.[appVersion];
  if (override?.length) return override;
  const releaseOptions = await reportingRequest<{ tracks?: Array<{ servingReleases?: Array<{ displayName?: string; versionCodes?: string[] }> }> }>(
    `/apps/${encodeURIComponent(config.packageName)}:fetchReleaseFilterOptions`,
  );
  const normalized = appVersion.trim().toLocaleLowerCase().replace(/^version\s+/, "");
  const matches = (releaseOptions.tracks ?? [])
    .flatMap((track) => track.servingReleases ?? [])
    .filter((release) => release.displayName?.trim().toLocaleLowerCase().replace(/^version\s+/, "") === normalized)
    .flatMap((release) => release.versionCodes ?? []);
  return [...new Set(matches)];
}

export async function getGooglePlayVitals(appName: string, appVersion: string, startDate: string, endDate: string): Promise<GooglePlayVitals | null> {
  const map = getAppMap();
  const config = map?.[appName];
  if (!config) return null;
  const versionCodes = await resolveVersionCodes(appVersion, config);
  if (!versionCodes.length) throw new Error(`No Google Play release matches ${appVersion}`);
  const aggregate = (rows: ReportingRow[], rateMetric: string): GooglePlayVital => {
    let users = 0;
    let weightedRate = 0;
    let latestDate: string | undefined;
    for (const row of rows) {
      const metrics = new Map(
        (row.metrics ?? []).map((metric) => [
          metric.metric,
          Number(typeof metric.decimalValue === "string" ? metric.decimalValue : metric.decimalValue?.value),
        ]),
      );
      const rate = metrics.get(rateMetric);
      const distinctUsers = metrics.get("distinctUsers");
      if (rate === undefined || distinctUsers === undefined || !Number.isFinite(rate) || !Number.isFinite(distinctUsers) || !distinctUsers) continue;
      users += distinctUsers;
      weightedRate += rate * distinctUsers;
      const date = asDate(row.startTime);
      if (date && (!latestDate || date > latestDate)) latestDate = date;
    }
    return { value: users ? weightedRate / users : null, distinctUsers: users, ...(latestDate ? { latestDate } : {}) };
  };
  const [crashMetricSet, anrMetricSet] = await Promise.all([
    reportingRequest<MetricSet>(`/apps/${encodeURIComponent(config.packageName)}/crashRateMetricSet`),
    reportingRequest<MetricSet>(`/apps/${encodeURIComponent(config.packageName)}/anrRateMetricSet`),
  ]);
  const requestedEndTime = addOneDay(endDate);
  const endTimes = {
    crashRateMetricSet: dailyFreshnessEndTime(crashMetricSet) ?? requestedEndTime,
    anrRateMetricSet: dailyFreshnessEndTime(anrMetricSet) ?? requestedEndTime,
  } as const;

  const requestRows = async (metricSet: "crashRateMetricSet" | "anrRateMetricSet", rateMetric: string) => {
    const allRows: ReportingRow[] = [];
    const endTime = endTimes[metricSet];
    if ((comparableDate(toDateTime(startDate)) ?? 0) >= (comparableDate(endTime) ?? Number.MAX_SAFE_INTEGER)) return allRows;
    for (const versionCode of versionCodes) {
      const body = {
        timelineSpec: {
          aggregationPeriod: "DAILY",
          startTime: toDateTime(startDate),
          endTime,
        },
        metrics: [rateMetric, "distinctUsers"],
        filter: `versionCode = ${versionCode}`,
        pageSize: 100000,
      };
      const result = await reportingRequest<QueryResponse>(`/apps/${encodeURIComponent(config.packageName)}/${metricSet}:query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      allRows.push(...(result.rows ?? []));
    }
    return allRows;
  };
  const [crashRows, anrRows] = await Promise.all([
    requestRows("crashRateMetricSet", "userPerceivedCrashRate"),
    requestRows("anrRateMetricSet", "userPerceivedAnrRate"),
  ]);
  return {
    packageName: config.packageName,
    versionCodes,
    crash: aggregate(crashRows, "userPerceivedCrashRate"),
    anr: aggregate(anrRows, "userPerceivedAnrRate"),
  };
}
