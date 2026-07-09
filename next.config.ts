import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/tech-launch/readiness": ["./data/tech_launch_telemetry_metrics.sql"],
    "/api/tech-launch/readiness/status": ["./data/tech_launch_telemetry_metrics.sql"],
    "/api/spec-check": ["./data/events_audit.sql"],
    "/api/spec-check/status": ["./data/events_audit.sql"],
  },
};

export default nextConfig;
