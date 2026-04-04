
// Helymeghatározás mód kijelzése (v5.51.5):
// G = GPS (high accuracy / jó pontosság), N = hálózati (internet alapú / gyenge pontosság)
let locProviderMode = "?"; // "G" | "N" | "?"
function updateAppVersionUI(){
  const el = document.getElementById("appVersion");
  if (!el) return;
  el.textContent = `v${APP_VERSION} ${locProviderMode}`;
}


// Szűrés táblázat kijelölés (több sor is kijelölhető)
let selectedFilterMarkerIds = new Set();

// Szűrés listában töröltek megjelenítése (soft delete)
let filterShowDeleted = false;

function updateShowDeletedBtn(btn) {
  if (!btn) return;
  const label = filterShowDeleted ? "Töröltek elrejtése" : "Töröltek megjelenítése";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.classList.toggle("active", !!filterShowDeleted);
}
// Szűrés listában töröltek megjelenítése



// v5.15: térképi megjelenítés szűrése (csak kijelöltek / táblázat tartalma)
let activeMapFilterIds = null;

// Marker mozgatás mód (popup gomb → következő kattintás helye)
let moveModeMarkerId = null;
 // null = nincs térképi szűrés, minden aktív marker látszik

let map;
let pendingLatLng = null;

// Objektum módosítás (markerModal újrafelhasználása)
let markerModalMode = "add"; // "add" | "edit"
let editingMarkerId = null;
let editingMarkerUuid = null;

// Térképi szűrés UI ("Összes megjelenítése" gomb)
function getVisibleMarkerBounds() {
  if (!map) return null;
  const latlngs = [];
  for (const [, mk] of markerLayers.entries()) {
    if (mk && map.hasLayer(mk)) {
      const ll = mk.getLatLng?.();
      if (ll) latlngs.push(ll);
    }
  }
  if (latlngs.length === 0) return null;
  return L.latLngBounds(latlngs);
}

function fitMapToVisibleMarkers() {
  const b = getVisibleMarkerBounds();
  if (!b) return;
  try {
    map.fitBounds(b, { padding: [30, 30] });
  } catch (_) {
    // no-op
  }
}

function isMapFiltered() {
  if (!(activeMapFilterIds instanceof Set)) return false;
  for (const id of markerLayers.keys()) {
    if (!activeMapFilterIds.has(Number(id))) return true;
  }
  return markerLayers.size > 0 && activeMapFilterIds.size === 0;
}

function updateShowAllButtonVisibility() {
  const btn = document.getElementById("btnShowAll");
  if (!btn) return;

  btn.style.display = isMapFiltered() ? "inline-block" : "none";
}

function clearMapMarkerVisibilityFilter() {
  activeMapFilterIds = null;

  for (const [, mk] of markerLayers.entries()) {
    if (map && mk && !map.hasLayer(mk)) mk.addTo(map);
  }
  updateShowAllButtonVisibility();
}

function showAllMarkersAndFit() {
  clearMapMarkerVisibilityFilter();
  fitMapToVisibleMarkers();
}


function genUuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "-" + String(Math.random()).replace(".", "");
}


// v5.49: Marker színek a Beállítások / Objektum típusa (HEX) alapján
// typeId -> {color, internalId, type, description}
let _typeMetaById = new Map();
let _markerSvgUrlCache = new Map();

// v5.50: Típus/Állapot választó (szép, táblázatos lenyíló)
let _formTypes = [];
let _formStatuses = [];


function setTypeMetaCache(types) {
  _typeMetaById = new Map();
  (types || []).forEach((t) => {
    const id = Number(t.id);
    if (!Number.isFinite(id)) return;
    _typeMetaById.set(id, {
      color: String(t.color || "").trim(),
      internalId: String(t.internalId || "").trim(),
      type: String(t.type || "").trim(),
      description: String(t.description || "").trim(),
    });
  });
}

function markerSvgDataUrl(fillHex) {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(fillHex || "").trim())
    ? String(fillHex).trim()
    : "#6b7280";
  const key = hex.toLowerCase();
  if (_markerSvgUrlCache.has(key)) return _markerSvgUrlCache.get(key);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
  <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z"
    fill="${hex}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
  <circle cx="12.5" cy="12.5" r="5" fill="rgba(255,255,255,0.85)"/>
</svg>`;
  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  _markerSvgUrlCache.set(key, url);
  return url;
}

function iconForMarker(m, zoom) {
  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : (map && map.getZoom ? map.getZoom() : 18);
  const scale = markerScaleForZoom(z);
  const size = [25 * scale, 41 * scale];
  const anchor = [12 * scale, 41 * scale];
  const popup = [1 * scale, -34 * scale];

  const meta = m && Number.isFinite(Number(m.typeId)) ? _typeMetaById.get(Number(m.typeId)) : null;
  const color = meta && meta.color ? meta.color : "#6b7280";

  // v5.51.15: heading-up térképforgatásnál az objektum markerek NE forogjanak a térképpel.
  // Ehhez L.divIcon-t használunk: a Leaflet a DIV-et pozícionálja (transform),
  // a belső IMG-t pedig CSS-ben ellenforgatjuk (--cm-map-rot-inv-deg).
  const url = markerSvgDataUrl(color);
  return L.divIcon({
    className: 'cm-obj-marker',
    html: `<img class="cm-obj-marker-img" src="${url}" alt="marker" style="width:${size[0]}px;height:${size[1]}px;">`,
    iconSize: size,
    iconAnchor: anchor,
    popupAnchor: popup,
  });
}
 // dbId -> leaflet marker

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Nominatim has strict usage limits. Throttle requests to avoid bursts
// (and the 4xx blocks you can see in DevTools).
let __cm_nominatim_lastCallAt = 0;
let __cm_nominatim_inflight = null;

function nominatimReverseJSONP(lat, lng, { timeoutMs = 8000, minGapMs = 1100, retries = 1 } = {}) {
  // Nominatim does not reliably send CORS headers, so browser fetch() can be blocked.
  // JSONP is supported via json_callback and works in Chrome/Edge without CORS.
  const runOnce = () => new Promise((resolve, reject) => {
    const cbName = "__cm_nominatim_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const cleanup = () => {
      try { delete window[cbName]; } catch (_) {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    };
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("Nominatim timeout"));
    }, timeoutMs);

    window[cbName] = (data) => {
      clearTimeout(t);
      cleanup();
      resolve(data);
    };

    const url =
      "https://nominatim.openstreetmap.org/reverse" +
      "?format=jsonv2" +
      "&addressdetails=1" +
      "&zoom=18" +
      "&lat=" + encodeURIComponent(lat) +
      "&lon=" + encodeURIComponent(lng) +
      "&json_callback=" + encodeURIComponent(cbName);

    script.src = url;
    script.async = true;
    script.onerror = () => {
      clearTimeout(t);
      cleanup();
      reject(new Error("Nominatim load error"));
    };

    document.head.appendChild(script);
  });

  const now = Date.now();
  const waitMs = Math.max(0, (__cm_nominatim_lastCallAt + minGapMs) - now);

  const doCall = () => {
    __cm_nominatim_lastCallAt = Date.now();
    __cm_nominatim_inflight = runOnce()
      .catch((err) => {
        if (retries > 0) {
          return new Promise((res) => setTimeout(res, minGapMs)).then(() =>
            nominatimReverseJSONP(lat, lng, { timeoutMs, minGapMs, retries: retries - 1 })
          );
        }
        throw err;
      })
      .finally(() => {
        __cm_nominatim_inflight = null;
      });
    return __cm_nominatim_inflight;
  };

  if (__cm_nominatim_inflight) return __cm_nominatim_inflight;
  if (waitMs > 0) return new Promise((res) => setTimeout(res, waitMs)).then(doCall);
  return doCall();
}

function showHint(text, ms = 2500) {
  const el = document.getElementById("hint");
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => (el.style.display = "none"), ms);
}

function openModal(latlng) {
  markerModalMode = "add";
  const tb = document.getElementById('fTypeBtn'); if (tb) tb.disabled = false;
  const sb = document.getElementById('fStatusBtn'); if (sb) sb.disabled = false;
  setPickerValue('type', null);
  setPickerValue('status', null);
  editingMarkerId = null;
  editingMarkerUuid = null;
  pendingLatLng = latlng;

  // v5.11: új marker felviteli folyamat => új draft uuid fényképekhez
  draftHasSaved = false;
  currentDraftUuid = genUuid();

  document.getElementById("fCity").value = "";
  document.getElementById("fStreet").value = "";
  document.getElementById("fHouse").value = "";
  document.getElementById("fNotes").value = "";
  try { const ts=document.getElementById('fType'); if (ts) ts.value=''; } catch(_){}
  try { const ss=document.getElementById('fStatus'); if (ss) ss.value=''; } catch(_){}

  setMarkerModalTitle("add");
  setMarkerModalControlsDisabled({ addressLocked: false });

  updateAttachPhotoLabel();

  // reverse geocode (CORS-safe JSONP)
  nominatimReverseJSONP(latlng.lat, latlng.lng)
    .then(j => {
      const a = (j && j.address) || {};
      if (a.city || a.town || a.village)
        document.getElementById("fCity").value = a.city || a.town || a.village || "";
      if (a.road)
        document.getElementById("fStreet").value = a.road;
      if (a.house_number)
        document.getElementById("fHouse").value = a.house_number;
    })
    .catch(() => {});

document.getElementById("markerModal").style.display = "flex";
}

async function closeModal() {
  document.getElementById("markerModal").style.display = "none";
  pendingLatLng = null;

  // Ha a felhasználó mégsem ment ÚJ MARKERT, a draft képeket töröljük, hogy ne maradjon szemét.
  if (markerModalMode === "add") {
    await cleanupDraftPhotosIfNeeded();
  }

  markerModalMode = "add";
  const tb = document.getElementById('fTypeBtn'); if (tb) tb.disabled = false;
  const sb = document.getElementById('fStatusBtn'); if (sb) sb.disabled = false;
  setPickerValue('type', null);
  setPickerValue('status', null);
  editingMarkerId = null;
  editingMarkerUuid = null;
  currentDraftUuid = null;
}

let myLocationMarker = null;
let myLocationWatchId = null;

