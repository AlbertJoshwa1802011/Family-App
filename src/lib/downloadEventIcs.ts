/**
 * Fetch an event .ics with the session cookie and trigger a file download
 * without leaving the SPA.
 *
 * Do NOT use `window.location.assign('/api/events/:id/ics')` — that replaces
 * the React app with a calendar download (or a raw `unauthorized` JSON page
 * when cookies aren't sent on a top-level navigation), so the create form
 * stays mounted and a retry creates a duplicate event.
 */
export async function downloadEventIcs(eventId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/events/${eventId}/ics`, {
      credentials: "include",
      headers: { Accept: "text/calendar" },
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `event-${eventId}.ics`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Keep the blob URL alive long enough for Safari / iOS to hand off to Calendar.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}
