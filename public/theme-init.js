// No-flash theme: apply the persisted theme before first paint.
// Served same-origin so it satisfies the strict CSP (script-src 'self').
(function () {
  try {
    var t = localStorage.getItem("fv-theme");
    var ok = ["midnight", "ocean", "sunset", "forest", "royal", "daylight"];
    document.documentElement.dataset.theme =
      ok.indexOf(t) !== -1 ? t : "midnight";
  } catch (e) {
    document.documentElement.dataset.theme = "midnight";
  }
})();
