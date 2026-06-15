/**
 * Human-friendly monitoring cadence from the site's check interval.
 * @param checkIntervalS Site monitoring interval in seconds.
 * @returns Short display label for the cadence.
 */
export function formatCadence(checkIntervalS: number): string {
  const hours = checkIntervalS / 3600;
  if (hours < 1) return `every ${String(Math.round(checkIntervalS / 60))} minutes`;
  if (hours === 1) return "hourly";
  if (hours < 24) return `every ${String(Math.round(hours))} hours`;
  const days = hours / 24;
  if (days === 1) return "daily";
  if (days === 7) return "weekly";
  return `every ${String(Math.round(days))} days`;
}

/**
 * Tolerates both epoch seconds and epoch milliseconds.
 * @param epoch Timestamp in epoch seconds or epoch milliseconds.
 * @returns JavaScript Date for the timestamp.
 */
export function toDate(epoch: number): Date {
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch);
}

/**
 * Formats a timestamp for compact date-only display.
 * @param epoch Timestamp in epoch seconds or epoch milliseconds.
 * @returns Localized date label.
 */
export function formatDate(epoch: number): string {
  return toDate(epoch).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats a timestamp for compact date and time display.
 * @param epoch Timestamp in epoch seconds or epoch milliseconds.
 * @returns Localized date-time label.
 */
export function formatDateTime(epoch: number): string {
  return toDate(epoch).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
