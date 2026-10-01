import https from "node:https";

/** Native transport avoids framework fetch instrumentation for credential-bearing URLs. */
export function sensorTowerRequest(url: URL): Promise<{ status: number; body: string; usageHeaders?: Record<string, string | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: "application/json" } }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 40 * 1024 * 1024) { req.destroy(); clearTimeout(timer); reject(new Error("Unexpected oversized Sensor Tower response")); }
        else chunks.push(chunk);
      });
      res.on("end", () => { clearTimeout(timer); const usageHeaders = Object.fromEntries(["x-api-usage-count", "x-api-usage-limit"].map(key => [key, typeof res.headers?.[key] === "string" ? res.headers[key] : undefined])); resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8"), ...(Object.values(usageHeaders).some(Boolean) ? { usageHeaders } : {}) }); });
      res.on("error", () => { clearTimeout(timer); reject(new Error("Sensor Tower response interrupted")); });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error("Sensor Tower connection timed out")); }, 30000);
    req.on("error", () => { clearTimeout(timer); reject(new Error("Sensor Tower connection failed")); });
    // Redirects are returned as HTTP failures, never followed with the token.
  });
}
