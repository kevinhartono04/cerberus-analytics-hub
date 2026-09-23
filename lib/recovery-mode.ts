/** Historical-data recovery is independent of the reviewed alert configuration. */
export function isRecoveryMode() {
  return process.env.CEREBRAL_RECOVERY_MODE === "true";
}

/** Only an explicit false resumes alerts during recovery; malformed values fail closed. */
export function areAlertsPaused() {
  const value = process.env.CEREBRAL_ALERTS_PAUSED;
  if (value === undefined) return isRecoveryMode();
  return value !== "false";
}
