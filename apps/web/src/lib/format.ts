/** Human-friendly monitoring cadence from the site's check interval. */
export function formatCadence(checkIntervalS: number): string {
  const hours = checkIntervalS / 3600;
  if (hours < 1) return `every ${Math.round(checkIntervalS / 60)} minutes`;
  if (hours === 1) return "hourly";
  if (hours < 24) return `every ${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days === 1) return "daily";
  if (days === 7) return "weekly";
  return `every ${Math.round(days)} days`;
}

/** Tolerates both epoch seconds and epoch milliseconds. */
export function toDate(epoch: number): Date {
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch);
}

export function formatDate(epoch: number): string {
  return toDate(epoch).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(epoch: number): string {
  return toDate(epoch).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
