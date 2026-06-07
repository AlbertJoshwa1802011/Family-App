type Tone = "neutral" | "success" | "warning" | "danger";

export interface ExpiryStatus {
  tone: Tone;
  label: string;
}

/** Maps an ISO date (yyyy-mm-dd) to a human label + tone for expiry badges. */
export function expiryStatus(date?: string | null): ExpiryStatus | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { tone: "danger", label: "Expired" };
  if (days === 0) return { tone: "danger", label: "Expires today" };
  if (days <= 7) return { tone: "danger", label: `${days}d left` };
  if (days <= 30) return { tone: "warning", label: `${days}d left` };
  return { tone: "success", label: `Valid` };
}
