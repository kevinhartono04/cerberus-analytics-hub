import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/tech-launch/readiness": ["./data/tech_launch_telemetry_metrics.sql"],
    "/api/tech-launch/readiness/status": ["./data/tech_launch_telemetry_metrics.sql"],
  },
};

export default nextConfig;
