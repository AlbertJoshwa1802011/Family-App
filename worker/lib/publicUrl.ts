/**
 * Public origin the browser used to hit this Worker.
 * Prefer the request URL over APP_URL so aliases keep Google OAuth
 * redirect_uri in lockstep with the tab the user opened.
 */
export function requestOrigin(url: string, fallbackAppUrl?: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return (fallbackAppUrl ?? "").replace(/\/$/, "");
  }
}

/** Only same-origin relative paths — used after OAuth cookie set. */
export function safeAppPath(path: string): string {
  if (path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")) {
    return path;
  }
  return "/";
}

/**
 * HTML document (200) that continues into the SPA after Set-Cookie.
 * Safari/iOS often drops cookies set on a 302 that follows a cross-site
 * Google OAuth redirect; a first-party HTML response keeps the sid.
 * No inline JS — CSP is script-src 'self'.
 */
export function loginBounceHtml(path: string): string {
  const dest = safeAppPath(path);
  const href = dest
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${href}">
  <title>Signing in</title>
</head>
<body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b1120;color:#e2e8f0;font-family:system-ui,sans-serif">
  <p>Signing you in… <a href="${href}" style="color:#818cf8">Continue</a></p>
</body>
</html>`;
}
