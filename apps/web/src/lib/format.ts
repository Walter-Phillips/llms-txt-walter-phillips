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
function toDate(epoch: number): Date {
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch);
}

/**
 * Compact relative-time label (e.g. "just now", "5m ago", "yesterday").
 * @param epoch Timestamp in epoch seconds or epoch milliseconds.
 * @returns Short relative-time label.
 */
export function formatRelative(epoch: number): string {
  const diff = Date.now() - toDate(epoch).getTime();
  const day = 86_400_000;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${String(Math.round(diff / 60_000))}m ago`;
  if (diff < day) return `${String(Math.round(diff / 3_600_000))}h ago`;
  const days = Math.round(diff / day);
  return days === 1 ? "yesterday" : `${String(days)}d ago`;
}
