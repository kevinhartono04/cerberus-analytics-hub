/** Keep recovery safeguards together until Neon history has been reconciled. */
export function isRecoveryMode() {
  return process.env.CEREBRAL_RECOVERY_MODE === "true";
}
