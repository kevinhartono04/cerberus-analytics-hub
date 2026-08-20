export function readDashboardSession<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export function writeDashboardSession<T>(key: string, value: T) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session storage may be unavailable or full; the dashboard remains usable without it.
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Returns true when two dashboard filter selections describe the same query. */
export function sameDashboardFilters(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}
