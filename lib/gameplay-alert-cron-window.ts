import { gameplayAlertTimeZone } from "@/lib/gameplay-alerts";

/**
 * Vercel evaluates cron expressions in UTC. We schedule a broad UTC range to
 * cover both AEST and AEDT, then use Melbourne local time as the source of
 * truth. Repeated calls are deliberate: the first submits the asynchronous
 * Count job and later calls collect its result without holding a function open.
 */
export function isGameplayAlertCronWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: gameplayAlertTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value);
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value);

  return (localHour === 8 && localMinute >= 30) || localHour === 9;
}
