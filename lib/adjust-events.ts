import { z } from "zod";

import { techLaunchAppOptions, techLaunchPlatformOptions } from "@/lib/tech-launch";

const adjustEventsEndpoint = "https://automate.adjust.com/reports-service/events";
const requestTimeoutMs = 10_000;
const retryDelayMs = 250;
const expectedEventChecks = [
  { expected: "client_ad_revenue", acceptedNames: ["client_ad_revenue"] },
  { expected: "iap_purchase", acceptedNames: ["iap_purchase"] },
  { expected: "session_start", acceptedNames: ["session_start", "Session_Start"] },
] as const;
const journeyMilestonePattern = /^Journey_Level_Won([1-9]\d*)$/;

const adjustEventSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  short_name: z.string().optional(),
  section: z.string().optional(),
  app_token: z.array(z.string()).optional(),
  tokens: z.array(z.string()).optional(),
  app_token_x_event_tokens_mapping: z.record(z.string(), z.array(z.string())).optional(),
}).passthrough();

export const adjustEventsCheckRequestSchema = z.object({
  appName: z.enum(techLaunchAppOptions),
  platform: z.enum(techLaunchPlatformOptions),
});

export type AdjustEventsCheckRequest = z.infer<typeof adjustEventsCheckRequestSchema>;
export type AdjustEventCheckStatus = "detected" | "missing";

export type AdjustEventMatch = {
  id?: string;
  name?: string;
  shortName?: string;
  section?: string;
  matchedField: "id" | "name";
  matchedValue: string;
};

export type AdjustFixedEventCheck = {
  expected: (typeof expectedEventChecks)[number]["expected"];
  acceptedNames: string[];
  status: AdjustEventCheckStatus;
  matches: AdjustEventMatch[];
  nearMatches: AdjustEventMatch[];
};

export type AdjustJourneyMilestone = AdjustEventMatch & {
  level: number;
};

export type AdjustEventsCheckResult = {
  status: "completed";
  appName: AdjustEventsCheckRequest["appName"];
  platform: AdjustEventsCheckRequest["platform"];
  checkedAt: string;
  overallStatus: "pass" | "fail";
  checks: AdjustFixedEventCheck[];
  journeyMilestones: {
    status: AdjustEventCheckStatus;
    milestones: AdjustJourneyMilestone[];
    nearMatches: AdjustEventMatch[];
  };
};

export class AdjustEventsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustEventsConfigurationError";
  }
}

export class AdjustEventsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustEventsProviderError";
  }
}

type AdjustIntegrationConfiguration = {
  apiToken: string;
  appToken: string;
};

function appTokenMapFromEnvironment() {
  const raw = process.env.ADJUST_APP_TOKENS_JSON?.trim();
  if (!raw) throw new AdjustEventsConfigurationError("Adjust app-token mapping is not configured");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AdjustEventsConfigurationError("Adjust app-token mapping is invalid JSON");
  }

  const result = z.record(
    z.string(),
    z.object({
      android: z.string().trim().min(1).optional(),
      ios: z.string().trim().min(1).optional(),
    }).refine((tokens) => Boolean(tokens.android || tokens.ios), "Each Adjust app must have at least one platform token"),
  ).safeParse(parsed);
  if (!result.success) throw new AdjustEventsConfigurationError("Adjust app-token mapping must contain non-empty platform tokens");
  return result.data;
}

function configurationFor({ appName, platform }: AdjustEventsCheckRequest): AdjustIntegrationConfiguration {
  const apiToken = process.env.ADJUST_API_TOKEN?.trim();
  if (!apiToken) throw new AdjustEventsConfigurationError("Adjust API integration is not configured");

  const appToken = appTokenMapFromEnvironment()[appName]?.[platform];
  if (!appToken) throw new AdjustEventsConfigurationError(`Adjust is not configured for ${appName} on ${platform}`);
  return { apiToken, appToken };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status: number) {
  return status === 429 || status === 503 || status === 504;
}

async function requestAdjustEvents(configuration: AdjustIntegrationConfiguration) {
  const url = new URL(adjustEventsEndpoint);
  url.searchParams.set("app_token__in", configuration.appToken);
  url.searchParams.set("tokens_mapping", "true");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${configuration.apiToken}` },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt === 0 && isTransientStatus(response.status)) {
          await sleep(retryDelayMs);
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          throw new AdjustEventsProviderError("Adjust authentication or app access failed");
        }
        throw new AdjustEventsProviderError(`Adjust Events endpoint returned ${response.status}`);
      }

      // Adjust uses 204, rather than an empty JSON array, when no events are
      // associated with the requested app. That is a completed check with all
      // expected events missing, not an upstream failure.
      if (response.status === 204) return [];

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AdjustEventsProviderError("Adjust Events endpoint returned invalid JSON");
      }
      const parsed = z.array(adjustEventSchema).safeParse(payload);
      if (!parsed.success) throw new AdjustEventsProviderError("Adjust Events endpoint returned an unexpected response");
      return parsed.data;
    } catch (error) {
      if (error instanceof AdjustEventsProviderError) throw error;
      if (attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AdjustEventsProviderError("Adjust Events request timed out");
      }
      throw new AdjustEventsProviderError("Could not reach the Adjust Events endpoint");
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AdjustEventsProviderError("Could not reach the Adjust Events endpoint");
}

function isAssociatedWithApp(event: z.infer<typeof adjustEventSchema>, appToken: string) {
  const associatedTokens = new Set([
    ...(event.app_token ?? []),
    ...Object.keys(event.app_token_x_event_tokens_mapping ?? {}),
  ]);
  return associatedTokens.size === 0 || associatedTokens.has(appToken);
}

function fieldsFor(event: z.infer<typeof adjustEventSchema>) {
  return ([
    ["name", event.name],
    ["id", event.id],
  ] as const).filter((entry): entry is ["id" | "name", string] => Boolean(entry[1]));
}

function matchFrom(event: z.infer<typeof adjustEventSchema>, matchedField: "id" | "name", matchedValue: string): AdjustEventMatch {
  return {
    ...(event.id ? { id: event.id } : {}),
    ...(event.name ? { name: event.name } : {}),
    ...(event.short_name ? { shortName: event.short_name } : {}),
    ...(event.section ? { section: event.section } : {}),
    matchedField,
    matchedValue,
  };
}

function canonicalEventName(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function uniqueMatches(matches: AdjustEventMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    // Adjust can return the same value in both `id` and `name`. A check is
    // about whether an event object exists, so show each object only once.
    const key = `${match.id ?? ""}:${match.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exactMatches(events: z.infer<typeof adjustEventSchema>[], acceptedNames: readonly string[]) {
  return uniqueMatches(events.flatMap((event) => fieldsFor(event)
    .filter(([, value]) => acceptedNames.includes(value))
    .map(([field, value]) => matchFrom(event, field, value))));
}

function nearMatches(events: z.infer<typeof adjustEventSchema>[], acceptedNames: readonly string[]) {
  const canonicalExpected = new Set(acceptedNames.map(canonicalEventName));
  return uniqueMatches(events.flatMap((event) => fieldsFor(event)
    .filter(([, value]) => !acceptedNames.includes(value) && !fieldsFor(event).some(([, candidate]) => acceptedNames.includes(candidate)) && canonicalExpected.has(canonicalEventName(value)))
    .map(([field, value]) => matchFrom(event, field, value))));
}

function journeyMilestones(events: z.infer<typeof adjustEventSchema>[]) {
  const milestones = events.flatMap((event) => fieldsFor(event).flatMap(([field, value]) => {
    const match = journeyMilestonePattern.exec(value);
    return match ? [{ ...matchFrom(event, field, value), level: Number(match[1]) }] : [];
  }));
  const unique = uniqueMatches(milestones).map((match) => ({ ...match, level: (match as AdjustJourneyMilestone).level }));
  return unique.toSorted((first, second) => first.level - second.level || first.matchedValue.localeCompare(second.matchedValue));
}

function journeyNearMatches(events: z.infer<typeof adjustEventSchema>[]) {
  return uniqueMatches(events.flatMap((event) => fieldsFor(event).flatMap(([field, value]) => {
    if (fieldsFor(event).some(([, candidate]) => journeyMilestonePattern.test(candidate))) return [];
    const canonical = canonicalEventName(value);
    return /^journeylevelwon[1-9]\d*$/.test(canonical) ? [matchFrom(event, field, value)] : [];
  })));
}

export async function getAdjustEventsCheck(input: unknown): Promise<AdjustEventsCheckResult> {
  const request = adjustEventsCheckRequestSchema.parse(input);
  const configuration = configurationFor(request);
  const events = (await requestAdjustEvents(configuration)).filter((event) => isAssociatedWithApp(event, configuration.appToken));
  const checks = expectedEventChecks.map(({ expected, acceptedNames }) => {
    const matches = exactMatches(events, acceptedNames);
    return {
      expected,
      status: matches.length ? "detected" as const : "missing" as const,
      acceptedNames: [...acceptedNames],
      matches,
      nearMatches: nearMatches(events, acceptedNames),
    };
  });
  const milestones = journeyMilestones(events);
  const journey = {
    status: milestones.length ? "detected" as const : "missing" as const,
    milestones,
    nearMatches: journeyNearMatches(events),
  };

  return {
    status: "completed",
    appName: request.appName,
    platform: request.platform,
    checkedAt: new Date().toISOString(),
    overallStatus: checks.every((check) => check.status === "detected") && journey.status === "detected" ? "pass" : "fail",
    checks,
    journeyMilestones: journey,
  };
}
