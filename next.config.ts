import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/tech-launch/readiness": ["./data/tech_launch_telemetry_metrics.sql"],
    "/api/tech-launch/readiness/status": ["./data/tech_launch_telemetry_metrics.sql"],
    "/api/tech-launch/level-fail-rate": ["./data/tech_launch_level_fail_rate.sql"],
    "/api/tech-launch/game-monitoring": ["./data/tech_launch_game_monitoring.sql"],
    "/api/tech-launch/game-monitoring/status": ["./data/tech_launch_game_monitoring.sql"],
    "/api/cron/gameplay-alerts": ["./data/tech_launch_level_fail_rate.sql", "./data/tech_launch_telemetry_metrics.sql"],
    "/api/spec-check": ["./data/events_audit.sql"],
    "/api/spec-check/status": ["./data/events_audit.sql"],
  },
};

export default nextConfig;
