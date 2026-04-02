async function checkForUpdateOnline() {
  if (!navigator.onLine) return;

  try {
    const r = await fetch("./js/version.js", { cache: "no-store" });
    const t = await r.text();
    const m = t.match(/const\s+APP_VERSION\s*=\s*\"([^\"]+)\"/);
    if (m && m[1] !== APP_VERSION) {
      location.reload();
    }
  } catch (e) {}
}
