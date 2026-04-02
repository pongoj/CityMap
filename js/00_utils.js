// Shared tiny helpers (no modules/bundler; globals only)

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeLsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return (v === null || typeof v === 'undefined') ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function safeLsSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}
