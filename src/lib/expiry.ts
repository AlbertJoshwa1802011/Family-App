type Tone = "neutral" | "success" | "warning" | "danger";

export interface ExpiryStatus {
  tone: Tone;
  label: string;
}

/** Maps an ISO date (yyyy-mm-dd) to a human label + tone for expiry badges.
 * Compares date-only values at UTC midnight to avoid timezone/DST off-by-one. */
export function expiryStatus(date?: string | null): ExpiryStatus | null {
  if (!date) return null;
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  const targetUtc = Date.UTC(y, m - 1, d);

  const n = new Date();
  const todayUtc = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.round((targetUtc - todayUtc) / 86_400_000);

  if (days < 0) return { tone: "danger", label: "Expired" };
  if (days === 0) return { tone: "danger", label: "Expires today" };
  if (days <= 7) return { tone: "danger", label: `${days}d left` };
  if (days <= 30) return { tone: "warning", label: `${days}d left` };
  return { tone: "success", label: `Valid` };
}
