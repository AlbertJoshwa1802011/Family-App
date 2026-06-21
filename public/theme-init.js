// Pre-paint theme + density init.
//
// Loaded as a render-blocking, SAME-ORIGIN script in <head> so it runs before the
// body paints (no flash) AND satisfies the CSP `script-src 'self'` in public/_headers
// — an inline <script> would be blocked there.
//
// Default theme is "dark" when unset, preserving the app's original dark-only look
// (zero visual change for existing users). Settings can persist "light"/"dark"/"system".
(function () {
  try {
    var el = document.documentElement;
    var t = localStorage.getItem("fv:theme") || "dark";
    if (t === "system") {
      t = window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    el.setAttribute("data-theme", t === "light" ? "light" : "dark");

    if (localStorage.getItem("fv:density") === "elder") {
      el.setAttribute("data-density", "elder");
    }

    // Keep the browser chrome color in sync with the resolved theme.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f8fafc" : "#070b14");
  } catch (_e) {
    /* localStorage blocked (private mode) — fall back to the CSS default (dark). */
  }
})();
