export const launchSignalDashboardSuite = [
  { id: "technical-readiness", label: "Technical Readiness" },
  { id: "level-funnel", label: "Level Funnel Check" },
  { id: "game-monitoring", label: "Game Monitoring" },
  { id: "incent-config-validator", label: "Incent Config Validator" },
] as const;

export type LaunchSignalDashboardId = (typeof launchSignalDashboardSuite)[number]["id"];
