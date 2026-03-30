const APP_VERSION = "5.51.5";

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

const photoCountCache = new Map(); // uuid -> number
const photoCountInFlight = new Map(); // uuid -> Promise<number>

function getPhotoCountCached(uuid){
  if (!uuid) return Promise.resolve(0);
  if (photoCountCache.has(uuid)) return Promise.resolve(photoCountCache.get(uuid));
  if (photoCountInFlight.has(uuid)) return photoCountInFlight.get(uuid);
  const p = Promise.resolve(DB.countPhotosByMarkerUuid(uuid))
    .then((cnt) => {
      const n = Number(cnt) || 0;
      photoCountCache.set(uuid, n);
      return n;
    })
    .catch(() => 0)
    .finally(() => {
      photoCountInFlight.delete(uuid);
    });
  photoCountInFlight.set(uuid, p);
  return p;
}


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

// v5.11: új markerhez fényképek hozzárendelése mentés előtt (draft uuid)
let currentDraftUuid = null;
let draftHasSaved = false;

async function updateAttachPhotoLabel() {
  const btn = document.getElementById("btnAttachPhoto");
  if (!btn) return;
  try {
    const n = currentDraftUuid ? await DB.countPhotosByMarkerUuid(currentDraftUuid) : 0;
    btn.textContent = `Fénykép hozzárendelése (${n})`;
  } catch (e) {
    console.warn("Photo count failed", e);
  }
}

async function cleanupDraftPhotosIfNeeded() {
  try {
    if (currentDraftUuid && !draftHasSaved) {
      await DB.deletePhotosByMarkerUuid(currentDraftUuid);
    }
  } catch (e) {
    console.warn("Draft photo cleanup failed", e);
  }
}

const markerLayers = new Map();

// Fotó galéria (markerhez rendelt képek megtekintése)
const photoGalleryModal = document.getElementById("photoGalleryModal");
const photoGalleryGrid = document.getElementById("photoGalleryGrid");
const photoGalleryMeta = document.getElementById("photoGalleryMeta");
const btnPhotoGalleryClose = document.getElementById("btnPhotoGalleryClose");
const btnPhotoGalleryCloseTop = document.getElementById("btnPhotoGalleryCloseTop");

function openSimpleModal(el) {
  if (!el) return;
  el.style.display = "block";
}

function closeSimpleModal(el) {
  if (!el) return;
  el.style.display = "none";
}

async function openPhotoGalleryForMarker(marker) {
  if (!marker) return;
  const uuid = marker.uuid || marker.markerUuid || marker.markerUUID;
  if (!uuid) return;
  const title = `${idText(marker.id)} – ${marker.address || ""}`;
  await openPhotoGallery(uuid, title);
}

async function openPhotoGallery(markerUuid, titleText) {
  try {
    const updatePopupPhotoCountUI = async () => {
      try {
        // db.js-ben a publikus függvény neve: countPhotosByMarkerUuid
        const count = await DB.countPhotosByMarkerUuid(markerUuid);
        const span = document.getElementById(`pc-${markerUuid}`);
        if (span) span.textContent = count;
        const btn = document.querySelector(`button.btnPhotos[data-uuid="${markerUuid}"]`);
        if (btn) btn.disabled = count === 0;
      } catch (_) {
        // no-op
      }
    };

    const render = async () => {
      const photos = await DB.getPhotosByMarkerUuid(markerUuid);
      if (photoGalleryGrid) photoGalleryGrid.innerHTML = "";
      if (photoGalleryMeta) {
        const t = titleText ? `${titleText} — ` : "";
        photoGalleryMeta.textContent = `${t}${photos.length} kép`;
      }

      if (!photoGalleryGrid) {
        openSimpleModal(photoGalleryModal);
        return;
      }

      if (photos.length === 0) {
        photoGalleryGrid.innerHTML = '<div class="photo-empty">Nincs hozzárendelt kép.</div>';
        await updatePopupPhotoCountUI();
        return;
      }

      for (const p of photos) {
        const url = URL.createObjectURL(p.blob);

        const item = document.createElement("div");
        item.className = "photo-item";

        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";

        const img = document.createElement("img");
        img.src = url;
        img.alt = "Fénykép";
        a.appendChild(img);

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = new Date(p.createdAt || Date.now()).toLocaleString();

        const del = document.createElement("button");
        del.type = "button";
        del.className = "photo-delete";
        del.textContent = "Törlés";
        del.title = "Kép törlése";
        del.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const ok = confirm("Biztosan törlöd ezt a képet? Ez nem visszavonható.");
          if (!ok) return;

          try {
            URL.revokeObjectURL(url);
            await DB.deletePhotoById(p.id);
            await render();
          } catch (err) {
            console.error("delete photo error", err);
            alert("Nem sikerült törölni a képet.");
          }
        });

        item.appendChild(a);
        item.appendChild(del);
        item.appendChild(meta);
        photoGalleryGrid.appendChild(item);
      }

      await updatePopupPhotoCountUI();
    };

    await render();

    openSimpleModal(photoGalleryModal);
  } catch (err) {
    console.error("openPhotoGallery error", err);
    alert("Nem sikerült betölteni a képeket.");
  }
}

if (btnPhotoGalleryClose) btnPhotoGalleryClose.addEventListener("click", () => closeSimpleModal(photoGalleryModal));
if (btnPhotoGalleryCloseTop) btnPhotoGalleryCloseTop.addEventListener("click", () => closeSimpleModal(photoGalleryModal));
if (photoGalleryModal) {
  photoGalleryModal.addEventListener("click", (e) => {
    if (e.target === photoGalleryModal) closeSimpleModal(photoGalleryModal);
  });
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

  return new L.Icon({
    iconUrl: markerSvgDataUrl(color),
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

// v5.51.5: geolocation preferálja a GPS-t (high accuracy), és csak hiba esetén
// vált "low" (hálózati) módra.
let geoWatchMode = "high"; // "high" | "low"
let geoErrStreak = 0;
let lastGeoModeSwitchTs = 0;

let myLocationAddressText = "Saját hely";
let lastMyLocCenterTs = 0; // (megtartva kompatibilitás miatt, de már mindig követjük a pozíciót)


// v5.40: GPS simítás (Google-szerűbb mozgás):
// - pontosság szűrés (nagyon rossz accuracy esetén nem frissítünk)
// - drift elleni deadzone (álló helyzetben ne remegjen)
// - EMA (exponenciális mozgóátlag) a folyamatosabb mozgáshoz
// - animált marker mozgatás két mérés között
// - követés ki/be: kézi térképmozgatás letiltja, "Saját helyem" gomb visszakapcsolja
const GPS_ACCURACY_MAX_M = 60;      // efölött nem frissítünk (beltér/rossz jel)
const GPS_ACCURACY_HARD_REJECT_M = 250; // efölött teljesen eldobjuk (nagyon rossz / hibás pozíció)
const GPS_DEADZONE_MIN_M = 4;       // ennyi alatt (állva) ne mozduljon
const GPS_DEADZONE_MAX_M = 14;      // deadzone felső korlát (v5.51.5: hálózati módban is stabilabb)
const GPS_JUMP_REJECT_M = 120;      // irreális ugrás eldobása (ha túl gyors)
const GPS_MARKER_ANIM_MS = 650;     // marker animáció időtartam
const GPS_CENTER_ANIM_S = 0.55;     // térkép pan animáció
const GPS_MIN_CENTER_INTERVAL_MS = 650;

let myLocFollowEnabled = true;
// v5.41: Navigáció mód (térkép követés viselkedése)
// - "north": észak felül, középre követ
// - "lite": haladási irány (kompromisszum): a térkép NEM forog, csak a nyíl + "előrenézős" követés
let navMode = (() => {
  let raw = "north";
  try {
    raw = (localStorage.getItem("citymap_nav_mode") || "north");
  } catch (_) {
    raw = "north";
  }
  // v5.51: migráció – a régi "heading" (térkép forgatós) mód helyett a stabil "lite" módot használjuk.
  raw = (raw === "heading") ? "lite" : raw;
  // csak ismert értékeket engedünk
  return (raw === "lite") ? "lite" : "north";
})(); // "north" | "lite"

// v5.42: "lite" módban a saját helyet kissé lejjebb tartjuk (előrenézés érzet)
function navYOffsetPx() {
  try {
    const h = map && map.getSize ? map.getSize().y : 0;
    // v5.51.4: nagyobb, jobban érezhető előrenézés (és arányos képernyőmérettel)
    const px = Math.round(h * 0.24);
    return clamp(px, 90, 240);
  } catch (_) {
    return 140;
  }
}

// v5.51.4: lite mód pixel-eltolás számítás (a marker képernyőn előre tolása)
function navDeltaPx(speedMps, accM) {
  try {
    if (navMode !== "lite") return { active:false, dx:0, dy:0, px:0 };
    if (!isFinite(speedMps)) speedMps = 0;
    // kis sebességnél ne legyen agresszív (állva ne mászkáljon)
    if (speedMps < 0.6) return { active:false, dx:0, dy:0, px:0 };
    if (!isFinite(lastHeadingDeg)) return { active:false, dx:0, dy:0, px:0 };

    let px = navYOffsetPx();
    // sebességfüggő skálázás (lassan kisebb, gyorsabban teljes)
    const k = clamp(speedMps / 6, 0.55, 1.0);
    px = Math.round(px * k);

    const rad = lastHeadingDeg * Math.PI / 180;
    const dx = -Math.sin(rad) * px;
    const dy =  Math.cos(rad) * px;
    return { active:true, dx, dy, px };
  } catch (_) {
    return { active:false, dx:0, dy:0, px:0 };
  }
}

// v5.51.1: követés célpont (map center) számítása –
// 'lite' módban a térkép nem forog, csak a nézet tolódik előre a haladási irányba.
// A Középre gomb csak akkor jelenjen meg, ha a felhasználó kézzel elmozdította a térképet.
function desiredFollowCenter(lat, lng, speedMps, accM) {
  let cLat = lat, cLng = lng;
  try {
    if (!map) return { lat: cLat, lng: cLng };

    const dpx = navDeltaPx(speedMps, accM);
    if (!dpx.active) return { lat: cLat, lng: cLng };

    const z = map.getZoom ? map.getZoom() : 18;
    const p0 = map.project([lat, lng], z);

    // A center a pozícióhoz képest 'előre' tolódik: így a marker képernyőn a haladási irány mögé kerül.
    const pc = L.point(p0.x - dpx.dx, p0.y - dpx.dy);
    const ll = map.unproject(pc, z);
    cLat = ll.lat;
    cLng = ll.lng;
  } catch (_) {}
  return { lat: cLat, lng: cLng };
}



// v5.45 – "Középre" gomb láthatóság (Google Maps-szerű)
// Csak akkor jelenjen meg, ha a térkép el van mozdítva, és a saját hely nincs középen.
function updateMyLocFabVisibility() {
  const btn = document.getElementById("btnMyLocFab");
  if (!btn || !map) return;

  if (!lastMyLocation) {
    btn.style.display = "none";
    return;
  }

  // v5.51.1: ha a GPS-követés be van kapcsolva, a 'Középre' gomb NE jelenjen meg.
  // (lite módban szándékosan nem középen van a saját hely, ezért a régi logika állandóan mutatta.)
  if (myLocFollowEnabled) {
    btn.style.display = "none";
    return;
  }

  try {
    const p = map.latLngToContainerPoint([lastMyLocation.lat, lastMyLocation.lng]);
    const s = map.getSize();
    const cx = s.x / 2, cy = s.y / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy);

    // 28px ~ kb. "középen van" tolerancia
    const THRESH_PX = 28;
    const show = dist > THRESH_PX;
    btn.style.display = show ? "inline-flex" : "none";
  } catch (_) {
    btn.style.display = "none";
  }
}

// v5.51: Leaflet ág – nincs térképforgatás (heading-up).
// A régi "heading" (térkép forgatós) kódot kiszedtük, mert a kompromisszumos "lite"
// mód csak a saját hely nyilat forgatja és a nézetet tolja előre.
// Kompatibilitásból meghagyjuk a hookokat, mert több helyről hívjuk őket.
function scheduleApplyNavBearing(){ /* no-op (no map rotation) */ }

function rotatedClickLatLng(e){ return e.latlng; }

// Saját hely nyíl iránya (0..360). Ha a böngésző ad heading-et, azt használjuk,
// különben két GPS pontból számolunk irányt (ha van elmozdulás).
let lastHeadingDeg = 0;
let compassHeadingDeg = NaN; // 0..360, eszköz iránytűből (állva forgásnál is)
let _compassInited = false;
let _compassPermGranted = false;

// v5.42.3: kompasz zaj csillapítás (Google-szerűbb, kevesebb ugrálás)
let _compassLastTs = 0;
let _compassOutlierStreak = 0;

// v5.42.4: kompasz + giroszkóp fúzió (remegés/ugrálás jelentős csökkentése)
let gyroHeadingDeg = NaN;   // integrált yaw (deg)
let fusedHeadingDeg = NaN;  // a ténylegesen használt heading
let _motionLastTs = 0;
let _gyroAvailable = false;
let _motionInited = false;

// v5.42.4: legutóbbi sebesség becslés (ha mozgunk, ne írja felül a kompasz)
let lastSpeedMps = NaN;
let lastSpeedTs = 0;

function _shouldUseCompassHeading(){
  try {
    const now = Date.now();
    if (isFinite(lastSpeedMps) && lastSpeedMps >= 1.2 && (now - lastSpeedTs) < 5000) return false;
  } catch (_) {}
  return true;
}


function _normDeg(d){
  d = (d % 360 + 360) % 360;
  return d;
}

// v5.51.5: egyes eszközök/böngészők 180 fokkal elforgatott heading-et adnak.
// Menet közben a GPS mozgásirány (bearing) alapján automatikusan kalibráljuk a "flip"-et.
let headingFlip180 = (() => {
  try {
    return (localStorage.getItem("citymap_heading_flip180") === "1");
  } catch (_) {
    return false;
  }
})();
let _flipVotes = 0; // >0: flip felé, <0: no-flip felé
function applyHeadingFlip(h){
  if (!(typeof h === "number" && isFinite(h))) return h;
  return _normDeg(h + (headingFlip180 ? 180 : 0));
}
function voteHeadingFlip(candidateDeg, moveBearingDeg){
  // candidateDeg: a szenzor/geo által adott heading, moveBearingDeg: GPS mozgásirány
  if (!(typeof candidateDeg === "number" && isFinite(candidateDeg))) return;
  if (!(typeof moveBearingDeg === "number" && isFinite(moveBearingDeg))) return;
  const d0 = Math.abs(shortestAngleDelta(candidateDeg, moveBearingDeg));
  const d180 = Math.abs(shortestAngleDelta(_normDeg(candidateDeg + 180), moveBearingDeg));
  // 15 fok hiszterézis
  if (d180 + 15 < d0) _flipVotes = Math.min(6, _flipVotes + 1);
  else if (d0 + 15 < d180) _flipVotes = Math.max(-6, _flipVotes - 1);

  if (_flipVotes >= 3 && !headingFlip180) {
    headingFlip180 = true;
    _flipVotes = 0;
    try { localStorage.setItem("citymap_heading_flip180", "1"); } catch (_) {}
  } else if (_flipVotes <= -3 && headingFlip180) {
    headingFlip180 = false;
    _flipVotes = 0;
    try { localStorage.setItem("citymap_heading_flip180", "0"); } catch (_) {}
  }
}


function _getScreenAngle(){
  // 0, 90, 180, 270
  try {
    if (screen && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  } catch (_) {}
  // iOS Safari
  try {
    if (typeof window.orientation === 'number') return window.orientation;
  } catch (_) {}
  return 0;
}

function _updateMyLocIconHeading(){
  if (!myLocationMarker) return;
  try {
    myLocationMarker.setIcon(myLocArrowIconForZoomHeading(map.getZoom(), lastHeadingDeg));
  } catch (_) {}
}

function _handleDeviceOrientation(e){
  // iOS: webkitCompassHeading (0..360, észak=0, kelet=90)
  let hdg = NaN;
  if (typeof e.webkitCompassHeading === "number" && isFinite(e.webkitCompassHeading)) {
    hdg = e.webkitCompassHeading;
  } else if (typeof e.alpha === "number" && isFinite(e.alpha)) {
    // Android/Chromium: alpha-t több böngésző eltérően adja vissza.
    // Kiszámoljuk mindkét elterjedt variánst, és a legstabilabbat választjuk.
    const a = e.alpha;
    const sa = _getScreenAngle();
    const h1 = _normDeg(a + sa);             // alpha direkt
    const h2 = _normDeg((360 - a) + sa);     // alpha invertált

    const abs = (e && (e.absolute === true || e.type === "deviceorientationabsolute"));
    if (!isFinite(compassHeadingDeg)) {
      hdg = abs ? h1 : h2;
    } else {
      const d1 = Math.abs(shortestAngleDelta(compassHeadingDeg, h1));
      const d2 = Math.abs(shortestAngleDelta(compassHeadingDeg, h2));
      hdg = (d1 <= d2) ? h1 : h2;
    }
  }
  if (!isFinite(hdg)) return;
  hdg = _normDeg(hdg);

  // v5.42.3: adaptív (időalapú) simítás + deadband + outlier szűrés,
// hogy állva se "rezegjen", de forgásra gyorsan reagáljon.
  const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const dt = Math.min(0.08, Math.max(0.005, _compassLastTs ? (now - _compassLastTs) / 1000 : 0.02));
  _compassLastTs = now;

  if (!isFinite(compassHeadingDeg)) {
    compassHeadingDeg = hdg;
    _compassOutlierStreak = 0;
  } else {
    const delta = shortestAngleDelta(compassHeadingDeg, hdg);
    const absd = Math.abs(delta);

    // deadband: apró remegés ignorálása
    if (absd < 1.2) {
      // nem frissítünk, hogy ne remegjen
    } else {
      // outlier: nagy hirtelen ugrásokat (pl. szenzor "flip") csak akkor engedünk át,
      // ha egymás után többször előfordul (különben csak zaj).
      if (absd > 95 && dt < 0.06) {
        _compassOutlierStreak += 1;
        if (_compassOutlierStreak < 3) {
          // ignoráljuk
        } else {
          // 3 egymás után: valószínű tényleg elfordultunk
          _compassOutlierStreak = 0;
          compassHeadingDeg = _normDeg(compassHeadingDeg + delta * 0.35);
        }
      } else {
        _compassOutlierStreak = 0;

        // adaptív időállandó: nagy elfordulásra gyorsabb, kis változásra erősebb simítás
        let tau;
        if (absd > 35) tau = 0.12;
        else if (absd > 15) tau = 0.22;
        else tau = 0.75;

        let alpha = 1 - Math.exp(-dt / tau);
        alpha = clamp(alpha, 0.04, 0.35);
        compassHeadingDeg = _normDeg(compassHeadingDeg + delta * alpha);
      }
    }
  }

  // v5.42.4: ha van giroszkóp, a forgást az integrált yaw adja (sokkal simább),
  // a kompasz csak lassan korrigál (drift ellen). Ha nincs gyro, marad a kompasz.
  if (!_gyroAvailable || !isFinite(gyroHeadingDeg)) {
    fusedHeadingDeg = compassHeadingDeg;
  } else if (isFinite(compassHeadingDeg)) {
    // apró korrekció itt is, ha a devicemotion ritka
    const d = shortestAngleDelta(gyroHeadingDeg, compassHeadingDeg);
    gyroHeadingDeg = _normDeg(gyroHeadingDeg + d * 0.02);
    fusedHeadingDeg = gyroHeadingDeg;
  } else {
    fusedHeadingDeg = gyroHeadingDeg;
  }

  if (_shouldUseCompassHeading() && isFinite(fusedHeadingDeg)) {
    lastHeadingDeg = fusedHeadingDeg;
    _updateMyLocIconHeading();
    scheduleApplyNavBearing();
  }
}



// v5.42.4: Gyro integráció (devicemotion.rotationRate) + kompasz korrekció
function _handleDeviceMotion(e){
  try {
    const rr = e && e.rotationRate;
    if (!rr) return;
    let yawRate = rr.alpha;
    if (!(typeof yawRate === 'number' && isFinite(yawRate))) return;
    yawRate = clamp(yawRate, -360, 360);

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dt = Math.min(0.05, Math.max(0.005, _motionLastTs ? (now - _motionLastTs) / 1000 : 0.02));
    _motionLastTs = now;

    if (!isFinite(gyroHeadingDeg)) {
      gyroHeadingDeg = isFinite(compassHeadingDeg) ? compassHeadingDeg : 0;
    } else {
      gyroHeadingDeg = _normDeg(gyroHeadingDeg + yawRate * dt);
    }

    _gyroAvailable = true;

    if (isFinite(compassHeadingDeg)) {
      const delta = shortestAngleDelta(gyroHeadingDeg, compassHeadingDeg);
      const corr = clamp(dt * 0.10, 0.0, 0.06);
      gyroHeadingDeg = _normDeg(gyroHeadingDeg + delta * corr);
    }

    fusedHeadingDeg = gyroHeadingDeg;

    if (_shouldUseCompassHeading() && isFinite(fusedHeadingDeg)) {
      lastHeadingDeg = fusedHeadingDeg;
      _updateMyLocIconHeading();
      scheduleApplyNavBearing();
    }
  } catch (_) {}
}

function startMotionIfPossible(){
  if (_motionInited) return;
  if (!('DeviceMotionEvent' in window)) return;
  _motionInited = true;
  window.addEventListener('devicemotion', _handleDeviceMotion, true);
}
async function requestCompassPermissionIfNeeded(){
  // Csak user-gesture-ből hívjuk (gombnyomás), különben iOS nem engedi.
  try {
    if (!("DeviceOrientationEvent" in window)) return false;
    // iOS 13+
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      if (_compassPermGranted) return true;
      const res = await DeviceOrientationEvent.requestPermission();
      _compassPermGranted = (res === "granted");
      return _compassPermGranted;
    }
    // Android/Chromium: nincs külön permission prompt (ha szenzor elérhető)
    _compassPermGranted = true;
    return true;
  } catch (_) {
    return false;
  }
}

function startCompassIfPossible(){
  if (_compassInited) return;
  if (!("DeviceOrientationEvent" in window)) return;
  _compassInited = true;
  // Próbáljuk az abszolút eventet, ha van.
  window.addEventListener("deviceorientationabsolute", _handleDeviceOrientation, true);
  window.addEventListener("deviceorientation", _handleDeviceOrientation, true);
  startMotionIfPossible();
}

let _prevHeadingRaw = null; // {lat,lng,ts}
 // induláskor bekapcsolva (Saját helyem gomb visszakapcsolja)

let lastRawMyLocation = null;        // {lat,lng,ts,acc}
let filteredMyLocation = null;       // {lat,lng,ts}
let lastCenteredMyLocation = null;   // {lat,lng}
let lastMyLocation = null;           // { lat:number, lng:number, ts:number } (utolsó simított)

const myLocWaiters = new Set(); // resolves waiting for first fix

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function inferLocProviderMode(pos, accM){
  try {
    const sp = (pos && pos.coords && typeof pos.coords.speed === "number" && isFinite(pos.coords.speed)) ? pos.coords.speed : NaN;
    const hd = (pos && pos.coords && typeof pos.coords.heading === "number" && isFinite(pos.coords.heading)) ? pos.coords.heading : NaN;
    const hasMotion = isFinite(sp) || isFinite(hd);
    if (typeof accM !== "number" || !isFinite(accM)) accM = 999999;
    // Tipikus: GPS 5-30m, hálózat 80m+ (nem garantált, ezért több jelből döntünk)
    if (accM <= 65) return "G";
    if (accM <= 90 && hasMotion) return "G";
    return "N";
  } catch (_) {
    return "?";
  }
}

function pickAlpha(speedMps, accM) {
  // lassú mozgásnál erősebb simítás; gyorsnál kisebb lag.
  let a;
  if (!isFinite(speedMps)) speedMps = 0;
  if (speedMps < 0.8) a = 0.08;
  else if (speedMps < 3) a = 0.18;
  else if (speedMps < 8) a = 0.28;
  else a = 0.38;

  // nagyon jó pontosságnál kicsit kevésbé simítunk (gyorsabb reakció)
  if (accM <= 8) a = Math.min(0.45, a + 0.05);
  return a;
}

let myLocAnim = { raf: null, from: null, to: null, start: 0, dur: GPS_MARKER_ANIM_MS };
function cancelMyLocAnim() {
  if (myLocAnim.raf) {
    try { cancelAnimationFrame(myLocAnim.raf); } catch (_) {}
    myLocAnim.raf = null;
  }
}

function animateMarkerTo(marker, toLat, toLng, durationMs = GPS_MARKER_ANIM_MS) {
  if (!marker) return;
  const fromLL = marker.getLatLng();
  const from = { lat: fromLL.lat, lng: fromLL.lng };
  const to = { lat: toLat, lng: toLng };

  // ha nagyon közel van, inkább csak tegyük át
        const d = distanceMeters(from.lat, from.lng, to.lat, to.lng);
  if (d < 0.5) {
    marker.setLatLng([to.lat, to.lng]);
    return;
  }

  cancelMyLocAnim();
  myLocAnim = { raf: null, from, to, start: performance.now(), dur: durationMs };

  const step = (t) => {
    const k = clamp((t - myLocAnim.start) / myLocAnim.dur, 0, 1);
    // easeOutCubic
    const e = 1 - Math.pow(1 - k, 3);
    const lat = myLocAnim.from.lat + (myLocAnim.to.lat - myLocAnim.from.lat) * e;
    const lng = myLocAnim.from.lng + (myLocAnim.to.lng - myLocAnim.from.lng) * e;
    marker.setLatLng([lat, lng]);
    if (k < 1) {
      myLocAnim.raf = requestAnimationFrame(step);
    } else {
      myLocAnim.raf = null;
    }
  };

  myLocAnim.raf = requestAnimationFrame(step);
}

async function ensureMyLocationMarker(lat, lng, fetchAddressOnce = false) {
  const ll = [lat, lng];

  if (fetchAddressOnce) {
    try {
      const j = await nominatimReverseJSONP(lat, lng, { timeoutMs: 8000 });
      if (j && j.display_name) myLocationAddressText = j.display_name;
    } catch (e) {
      // no-op
    }
  }

if (!myLocationMarker) {
    myLocationMarker = L.marker(ll, { icon: myLocArrowIconForZoomHeading(map.getZoom(), lastHeadingDeg) }).addTo(map);
    myLocationMarker.bindPopup(`<b>Saját hely</b><br>${escapeHtml(myLocationAddressText)}`);
  } else {
    animateMarkerTo(myLocationMarker, lat, lng, GPS_MARKER_ANIM_MS);
    try {
      myLocationMarker.setIcon(myLocArrowIconForZoomHeading(map.getZoom(), lastHeadingDeg));
    } catch (_) {}
    if (myLocationMarker.getPopup()) {
      myLocationMarker.getPopup().setContent(
        `<b>Saját hely</b><br>${escapeHtml(myLocationAddressText)}`
      );
    }
  }
}

function restartMyLocationWatch(mode){
  try {
    if (myLocationWatchId !== null) navigator.geolocation.clearWatch(myLocationWatchId);
  } catch (_) {}
  myLocationWatchId = null;
  startMyLocationWatch(mode);
}

function startMyLocationWatch(mode = "high") {
  if (!navigator.geolocation) return;
  if (myLocationWatchId !== null) return;

  geoWatchMode = (mode === "low") ? "low" : "high";
  // induláskor / váltáskor frissítsük a verzió melletti jelzést (ha még nincs fix)
  try { updateAppVersionUI(); } catch (_) {}


  myLocationWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const latRaw = pos.coords.latitude;
      const lngRaw = pos.coords.longitude;
      const acc = typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : 999999;

      // v5.51.5: helymeghatározás mód becslése + kijelzés (G/N)
      try {
        locProviderMode = inferLocProviderMode(pos, acc);
        updateAppVersionUI();
      } catch (_) {}

      // Ha low módban vagyunk, de közben megjött a jó GPS (G), váltsunk vissza high-ra.
      try {
        if (geoWatchMode === "low" && locProviderMode === "G" && (Date.now() - lastGeoModeSwitchTs) > 30000) {
          lastGeoModeSwitchTs = Date.now();
          restartMyLocationWatch("high");
          return;
        }
      } catch (_) {}

      // Release any waiters that are waiting for first position fix
      if (myLocWaiters.size) {
        for (const fn of Array.from(myLocWaiters)) {
          try { fn(true); } catch (_) {}
        }
        myLocWaiters.clear();
      }

      const nowTs = Date.now();

      geoErrStreak = 0;

      const prevRaw = lastRawMyLocation;
      // Heading források:
      // - menet közben: GPS mozgásirány (bearing) a legstabilabb (kompasz nélkül, nincs 180° fordulás)
      // - ha nincs elég mozgás: geolocation heading (ha van)
      // - állva/forgás közben: iránytű (DeviceOrientation)

      let speedHint = (typeof pos.coords.speed === "number" && isFinite(pos.coords.speed)) ? pos.coords.speed : NaN;

      // Mozgásból számolt irány (bearing) + sebesség (raw GPS pontokból).
      let moveBearing = NaN;
      let moveSpeed = NaN;
      if (prevRaw) {
        const dtMove = Math.max(0.001, (nowTs - prevRaw.ts) / 1000);
        const dMove = distanceMeters(prevRaw.lat, prevRaw.lng, latRaw, lngRaw);
        moveSpeed = dMove / dtMove;
        // Autóban jellemzően 10m+ mozgás kell a stabil bearing-hez
        if (dMove >= 10 && dtMove <= 10) {
          moveBearing = bearingDeg(prevRaw.lat, prevRaw.lng, latRaw, lngRaw);
        }
        if (!isFinite(speedHint)) speedHint = moveSpeed;
      }

      // v5.42.4: sebesség hint mentése (mozgás közben ne írja felül a gyro/kompasz a heading-et)
      const speedBest = (typeof pos.coords.speed === "number" && isFinite(pos.coords.speed)) ? pos.coords.speed
        : (isFinite(speedHint) ? speedHint : moveSpeed);
      lastSpeedMps = speedBest;
      lastSpeedTs = nowTs;

      // Geolocation heading (ha van). Sok böngésző csak GPS módban adja.
      const geoHeadingOk = (typeof pos.coords.heading === "number" && isFinite(pos.coords.heading) && isFinite(speedBest) && speedBest >= 1.2 && acc <= 120);
      const hGeoRaw = geoHeadingOk ? _normDeg(pos.coords.heading) : NaN;

      // Iránytű heading-et a deviceorientation event frissíti (compassHeadingDeg).
      const hCompassRaw = (typeof compassHeadingDeg === "number" && isFinite(compassHeadingDeg)) ? _normDeg(compassHeadingDeg) : NaN;

      // v5.51.5: 180° flip auto-kalibráció (ha a szenzor/geo heading fordítva jön).
      if (isFinite(moveBearing) && isFinite(moveSpeed) && moveSpeed >= 2.0 && acc <= 90) {
        if (isFinite(hGeoRaw)) voteHeadingFlip(hGeoRaw, moveBearing);
        if (isFinite(hCompassRaw)) voteHeadingFlip(hCompassRaw, moveBearing);
      }

      // Heading választás: mozgásirány az első (autóban a legjobb).
      let chosenHeading = NaN;
      if (isFinite(moveBearing) && isFinite(moveSpeed) && moveSpeed >= 1.4 && acc <= 120) {
        chosenHeading = moveBearing;
      } else if (isFinite(hGeoRaw)) {
        chosenHeading = applyHeadingFlip(hGeoRaw);
      } else if (isFinite(hCompassRaw)) {
        const hFused = (typeof fusedHeadingDeg === "number" && isFinite(fusedHeadingDeg)) ? _normDeg(fusedHeadingDeg) : hCompassRaw;
        chosenHeading = applyHeadingFlip(hFused);
      }

      if (isFinite(chosenHeading)) {
        if (!isFinite(lastHeadingDeg)) lastHeadingDeg = chosenHeading;
        else {
          const delta = shortestAngleDelta(lastHeadingDeg, chosenHeading);
          const absd = Math.abs(delta);
          // nagy fordulásra gyorsabb, egyenesben stabilabb
          const k = (absd > 60) ? 0.45 : (absd > 20 ? 0.30 : 0.22);
          lastHeadingDeg = _normDeg(lastHeadingDeg + delta * k);
        }
        _updateMyLocIconHeading();
      }

      // fallback bázis frissítés
      if (!_prevHeadingRaw) _prevHeadingRaw = { lat: latRaw, lng: lngRaw, ts: nowTs };
      else if (!prevRaw || (nowTs - _prevHeadingRaw.ts) > 8000) _prevHeadingRaw = { lat: latRaw, lng: lngRaw, ts: nowTs };


      scheduleApplyNavBearing();

      // Nagyon rossz pontosságnál inkább ne frissítsünk (ugrálás/beltér).
      if (acc > GPS_ACCURACY_HARD_REJECT_M) {
        lastRawMyLocation = { lat: latRaw, lng: lngRaw, ts: nowTs, acc };
        return;
      }

      // Sebesség becslés (ha nincs pos.coords.speed)
      let speed = (typeof pos.coords.speed === "number" && isFinite(pos.coords.speed)) ? pos.coords.speed : speedHint;
      if (!isFinite(speed) && prevRaw) {
        const dt = Math.max(0.001, (nowTs - prevRaw.ts) / 1000);
        const d = distanceMeters(latRaw, lngRaw, prevRaw.lat, prevRaw.lng);
        speed = d / dt;
      }

      // Ugrás szűrés: ha irreálisan nagy az ugrás rövid idő alatt, eldobjuk.
      if (prevRaw) {
        const dt = Math.max(0.001, (nowTs - prevRaw.ts) / 1000);
        const d = distanceMeters(latRaw, lngRaw, prevRaw.lat, prevRaw.lng);
        const impliedSpeed = d / dt;
        if (d > GPS_JUMP_REJECT_M && impliedSpeed > 40) {
          // pl. 120m ugrás 1-2 mp alatt
          lastRawMyLocation = { lat: latRaw, lng: lngRaw, ts: nowTs, acc };
          return;
        }
      }

      lastRawMyLocation = { lat: latRaw, lng: lngRaw, ts: nowTs, acc };

      // EMA szűrés
      if (!filteredMyLocation) {
        filteredMyLocation = { lat: latRaw, lng: lngRaw, ts: nowTs };
      } else {
        const dToFiltered = distanceMeters(latRaw, lngRaw, filteredMyLocation.lat, filteredMyLocation.lng);
        const deadzone = clamp(Math.max(GPS_DEADZONE_MIN_M, acc * 0.35), GPS_DEADZONE_MIN_M, GPS_DEADZONE_MAX_M);

        // ha gyakorlatilag állunk és a drift kicsi → ne mozdítsuk
        if (dToFiltered < deadzone && (!isFinite(speed) || speed < 0.8)) {
          // csak az időt frissítjük
          filteredMyLocation.ts = nowTs;
        } else {
          const a = pickAlpha(speed, acc);
          filteredMyLocation = {
            lat: filteredMyLocation.lat + (latRaw - filteredMyLocation.lat) * a,
            lng: filteredMyLocation.lng + (lngRaw - filteredMyLocation.lng) * a,
            ts: nowTs,
          };
        }
      }

      lastMyLocation = { lat: filteredMyLocation.lat, lng: filteredMyLocation.lng, ts: nowTs };

      const shouldFetchAddress = myLocationAddressText === "Saját hely";
      await ensureMyLocationMarker(filteredMyLocation.lat, filteredMyLocation.lng, shouldFetchAddress);

      // Térkép követés (ha be van kapcsolva): panTo animációval, hogy ne "ugorjon".
      // v5.51.1: a 'lite' előrenézés a map center célpontba van beépítve (nem panBy),
      // így nem csúszik szét a követés, és a 'Középre' gomb sem ragad be.
      if (myLocFollowEnabled) {
        const lowQ = (typeof acc === "number" && isFinite(acc) && acc > 90);
        const minInterval = lowQ ? 1100 : ((navMode === "lite" && isFinite(speed) && speed >= 0.7) ? 350 : GPS_MIN_CENTER_INTERVAL_MS);
        const canCenterByTime = (nowTs - lastMyLocCenterTs) >= minInterval;
        let shouldCenter = false;

        const desired = desiredFollowCenter(filteredMyLocation.lat, filteredMyLocation.lng, speed, acc);
        const centerNow = map.getCenter ? map.getCenter() : null;

        if (!centerNow || !isFinite(centerNow.lat) || !isFinite(centerNow.lng)) {
          shouldCenter = true;
        } else {
          try {
            const s = map.getSize();
            const cx = s.x / 2;
            const cy = s.y / 2;

            const dpx = navDeltaPx(speed, acc);
            const ax = cx + (dpx.active ? dpx.dx : 0);
            const ay = cy + (dpx.active ? dpx.dy : 0);

            const p = map.latLngToContainerPoint([filteredMyLocation.lat, filteredMyLocation.lng]);
            const distPx = Math.hypot(p.x - ax, p.y - ay);

            // pixeles holtzóna: így nem rángatjuk apró driftre, de lite módban stabilan érezhető marad az előrenézés
            const threshPx = dpx.active ? (lowQ ? 28 : 16) : (lowQ ? 32 : 22);
            if (distPx >= threshPx) shouldCenter = true;
          } catch (_) {
            // fallback: méter alapú küszöb
            const dc = distanceMeters(desired.lat, desired.lng, centerNow.lat, centerNow.lng);
            const dynThreshold = clamp(Math.max(6, acc * 0.6), 6, 18);
            if (dc >= dynThreshold) shouldCenter = true;
          }
        }

        if (shouldCenter && canCenterByTime) {
          lastMyLocCenterTs = nowTs;
          lastCenteredMyLocation = { lat: desired.lat, lng: desired.lng };

          const fast = (isFinite(speed) && speed >= 6);
          let dur = GPS_CENTER_ANIM_S;
          if (isFinite(speed)) {
            if (speed < 1.5) dur = 0.45;
            else if (speed < 4) dur = 0.32;
            else dur = 0.22;
          }

          map.panTo([desired.lat, desired.lng], {
            animate: (!fast && !lowQ),
            duration: lowQ ? 0.0 : dur,
            easeLinearity: 0.25,
            noMoveStart: true,
          });
        }
      }

      // v5.45: 'Középre' gomb frissítése
      updateMyLocFabVisibility();
    },
    (err) => {
      console.warn("watchPosition error", err);
      if (myLocationWatchId !== null) {
        try {
          navigator.geolocation.clearWatch(myLocationWatchId);
        } catch (_) {}
        myLocationWatchId = null;
      }

      // If someone is waiting for a fix, fail them.
      if (myLocWaiters.size) {
        for (const fn of Array.from(myLocWaiters)) {
          try {
            fn(false);
          } catch (_) {}
        }
        myLocWaiters.clear();
      }

      // v5.51.5: újrapróbálkozás + fallback (GPS -> hálózat), ha nincs GPS jel / timeout.
      try {
        if (err && err.code === 1) {
          // Permission denied: ne próbálkozzunk újra.
          return;
        }
        geoErrStreak = (geoErrStreak || 0) + 1;
        const now = Date.now();
        const canSwitch = (now - lastGeoModeSwitchTs) > 15000;

        if (geoWatchMode === "high" && geoErrStreak >= 2 && canSwitch) {
          lastGeoModeSwitchTs = now;
          restartMyLocationWatch("low");
          return;
        }

        // Maradunk ugyanabban a módban, rövid késleltetéssel újraindítjuk.
        setTimeout(() => {
          try { startMyLocationWatch(geoWatchMode); } catch (_) {}
        }, 1200);
      } catch (_) {}
    },
    {
      enableHighAccuracy: (geoWatchMode === "high"),
      maximumAge: 0,
      timeout: 10000,
    }
  );
}

// Startup check: detect whether geolocation permission is enabled and notify the user if not.
// Note: browsers do not allow us to "enable" permission programmatically. We can only inform.
async function checkGeolocationPermissionOnStartup() {
  try {
    if (!navigator.geolocation) return;

    // Prefer Permissions API when available (does NOT trigger a prompt).
    if (navigator.permissions && navigator.permissions.query) {
      let p;
      try {
        p = await navigator.permissions.query({ name: "geolocation" });
      } catch (_) {
        // Some browsers throw for unsupported permission names.
        p = null;
      }

      if (p && p.state === "denied") {
        alert(
          "A helymeghatározás tiltva van ehhez az oldalhoz.\n\n" +
            "Engedélyezd a böngészőben a lakatszimbólumnál (Webhely beállításai → Hely), majd frissítsd az oldalt."
        );
      } else if (p && p.state === "prompt") {
        alert(
          "A helymeghatározás még nincs engedélyezve.\n\n" +
            "Ha a böngésző rákérdez, válaszd az Engedélyezés opciót, vagy állítsd be a lakatszimbólumnál (Webhely beállításai → Hely)."
        );
      }

      return;
    }

    // No reliable, prompt-free way to check without Permissions API.
    // We intentionally do nothing here to avoid an unsolicited permission prompt on page load.
  } catch (e) {
    // Never fail app startup due to permission checks.
    console.warn("Geolocation permission check failed", e);
  }
}

async function centerToMyLocation() {
  myLocFollowEnabled = true;
  // If we already have a recent fix from watchPosition, use it immediately.
  if (lastMyLocation && Date.now() - lastMyLocation.ts < 60_000) {
    lastMyLocCenterTs = Date.now();
    {
    const sp = (typeof lastSpeedMps === "number" && isFinite(lastSpeedMps)) ? lastSpeedMps : NaN;
    const accM = (lastRawMyLocation && typeof lastRawMyLocation.acc === "number") ? lastRawMyLocation.acc : 999999;
    const desired = desiredFollowCenter(lastMyLocation.lat, lastMyLocation.lng, sp, accM);
    map.setView([desired.lat, desired.lng], 20, { animate: true, duration: 0.6 });
    lastCenteredMyLocation = { lat: desired.lat, lng: desired.lng };
  }
    // lastCenteredMyLocation fentebb beállítva (lite módban előretolt centerrel)
    await ensureMyLocationMarker(lastMyLocation.lat, lastMyLocation.lng, false);
    startMyLocationWatch();
    return true;
  }

  // Try to get a fix via getCurrentPosition (this often triggers permission prompt).
  const got = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        lastMyLocation = { lat, lng, ts: Date.now() };

        try {
          const accM0 = (typeof pos.coords.accuracy === "number" && isFinite(pos.coords.accuracy)) ? pos.coords.accuracy : 999999;
          locProviderMode = inferLocProviderMode(pos, accM0);
          updateAppVersionUI();
        } catch (_) {}

        lastMyLocCenterTs = Date.now();
        {
          const sp = (typeof pos.coords.speed === "number" && isFinite(pos.coords.speed)) ? pos.coords.speed : NaN;
          const accM = (typeof pos.coords.accuracy === "number" && isFinite(pos.coords.accuracy)) ? pos.coords.accuracy : 999999;
          const desired = desiredFollowCenter(lat, lng, sp, accM);
          map.setView([desired.lat, desired.lng], 20, { animate: true, duration: 0.6 });
          lastCenteredMyLocation = { lat: desired.lat, lng: desired.lng };
        }
        await ensureMyLocationMarker(lat, lng, true);

        startMyLocationWatch();
        resolve(true);
      },
      () => resolve(false),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
  });

  if (got) return true;

  // Fallback: start watch and wait briefly for first fix.
  startMyLocationWatch();
  const ok = await new Promise((resolve) => {
    const fn = (v) => resolve(v);
    myLocWaiters.add(fn);
    setTimeout(() => {
      if (myLocWaiters.has(fn)) {
        myLocWaiters.delete(fn);
        resolve(false);
      }
    }, 15000);
  });

  if (!ok || !lastMyLocation) return false;

  map.setView([lastMyLocation.lat, lastMyLocation.lng], 20, { animate: true, duration: 0.6 });
  // lastCenteredMyLocation fentebb beállítva (lite módban előretolt centerrel)
  await ensureMyLocationMarker(lastMyLocation.lat, lastMyLocation.lng, true);
  return true;
}

function idText(id) {
  return "M-" + String(id).padStart(6, "0");
}

function popupHtml(m) {
  const isDeleted = !!m.deletedAt;
  return `
  <div class="cm-popup" style="min-width:240px">
    <div><b>Azonosítószám:</b> ${idText(m.id)}</div>
    <div><b>Cím:</b> ${escapeHtml(m.address)}</div>
    <div><b>Típus:</b> ${escapeHtml(m.typeLabel)}</div>
    <div><b>Állapot:</b> ${escapeHtml(m.statusLabel)}</div>
    <div><b>Megjegyzés:</b> ${m.notes ? escapeHtml(m.notes) : "-"}</div>

    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btnPhotos" data-uuid="${m.uuid}" data-title="${idText(m.id)}">Fotók (<span id="pc-${m.uuid}">…</span>)</button>
      ${isDeleted ? '<span style="color:#b91c1c;font-weight:700;">TÖRÖLT</span>' : ''}
    </div>

    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <button data-edit="${m.id}" ${isDeleted ? 'disabled title="A törölt objektum nem módosítható"' : ''}>Módosítás</button>
      <button data-move="${m.id}" ${isDeleted ? 'disabled title="A törölt objektum nem mozgatható"' : ''}>Mozgatás</button>
      <button data-del="${m.id}">Törlés</button>
    </div>
  </div>`;
}


function wirePopupDelete(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(`button[data-del="${dbId}"]`);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      const ok = confirm(
        "Biztosan törlöd ezt a markert? (soft delete)\nA törölt marker később megjeleníthető a szűrés ablakban."
      );
      if (!ok) return;

      await DB.softDeleteMarker(dbId);
      map.removeLayer(marker);
      markerLayers.delete(dbId);

      if (activeMapFilterIds instanceof Set) activeMapFilterIds.delete(Number(dbId));
      updateShowAllButtonVisibility();
    });
  });
}

function wirePopupMove(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(`button[data-move="${dbId}"]`);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const m = await DB.getMarkerById(dbId);
        if (!m || m.deletedAt) {
          alert("A törölt marker nem mozgatható.");
          return;
        }
        // Mozgatás mód: a következő térképkattintás áthelyezi a markert.
        moveModeMarkerId = dbId;
        showHint("Mozgatás: válaszd ki az új helyet a térképen.");
        try { marker.closePopup(); } catch (_) {}
      } catch (err) {
        console.error("move from popup failed", err);
        alert("Nem sikerült betölteni a marker adatait.");
      }
    });
  });
}

function wirePopupEdit(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(`button[data-edit="${dbId}"]`);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const m = await DB.getMarkerById(dbId);
        if (!m || m.deletedAt) {
          alert("A törölt marker nem módosítható.");
          return;
        }
        openEditModal(m);
      } catch (err) {
        console.error("open edit from popup failed", err);
        alert("Nem sikerült betölteni a marker adatait.");
      }
    });
  });
}

function wirePopupPhotos(marker, m) {
  marker.on("popupopen", async (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(".btnPhotos");
    const span = el.querySelector(`#pc-${CSS.escape(m.uuid)}`);

    try {
      const cnt = await DB.countPhotosByMarkerUuid(m.uuid);
      if (span) span.textContent = String(cnt);
      if (btn) {
        btn.disabled = cnt === 0;
        btn.title = cnt === 0 ? "Nincs hozzárendelt kép" : "Képek megtekintése";
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openPhotoGallery(m.uuid, btn.getAttribute("data-title") || idText(m.id));
        };
      }
    } catch (err) {
      console.error("photo count error", err);
      if (span) span.textContent = "0";
    }
  });
}

async function getMarker(id) {
  const all = await DB.getAllMarkersActive();
  return all.find(x => x.id === id) || null;
}

function addMarkerToMap(m) {  const mk = L.marker([m.lat, m.lng], { draggable: false, icon: iconForMarker(m, map.getZoom()) }).addTo(map);
mk.__data = m;
  mk.bindPopup(popupHtml(m));
  wirePopupDelete(mk, m.id);
  wirePopupEdit(mk, m.id);
  wirePopupMove(mk, m.id);
  wirePopupPhotos(mk, m);

  markerLayers.set(m.id, mk);

  // v5.15: ha aktív térképi szűrés van, az új marker csak akkor maradjon látható, ha benne van a szűrésben
  if (activeMapFilterIds instanceof Set) {
    if (!activeMapFilterIds.has(Number(m.id))) {
      map.removeLayer(mk);
    }
  }

  updateShowAllButtonVisibility();
}

function refreshAllMarkerIcons() {
  try {
    markerLayers.forEach((mk, id) => {
      const d = mk && mk.__data ? mk.__data : null;
      if (!d) return;
      mk.setIcon(iconForMarker(d, map.getZoom()));
    });
  } catch (e) {
    console.warn('refreshAllMarkerIcons failed', e);
  }
}


function setMarkerModalControlsDisabled({ addressLocked }) {
  const city = document.getElementById("fCity");
  const street = document.getElementById("fStreet");
  const house = document.getElementById("fHouse");
  const typeBtn = document.getElementById("fTypeBtn");
  if (city) city.disabled = !!addressLocked;
  if (street) street.disabled = !!addressLocked;
  if (house) house.disabled = !!addressLocked;
  if (typeBtn) typeBtn.disabled = !!addressLocked;
}

function setMarkerModalTitle(mode) {
  const titleEl = document.getElementById("markerModalTitle");
  const hintEl = document.getElementById("markerModalHint");
  if (titleEl) titleEl.textContent = mode === "edit" ? "Objektum módosítása" : "Objektum rögzítése";
  if (hintEl) {
    hintEl.textContent = mode === "edit"
      ? "A cím és a típus nem módosítható. Állapot, megjegyzés és fotók frissíthetők."
      : "Bökés helyén jön létre, utána húzással finomítható.";
  }
}

// v5.50: szép, táblázatos választó Típus/Állapot mezőkhöz
function getLabelForType(id){
  const n = Number(id);
  const rec = _formTypes.find(x => Number(x.id) === n);
  return rec ? String(rec.type || '').trim() : '';
}
function getLabelForStatus(id){
  const n = Number(id);
  const rec = _formStatuses.find(x => Number(x.id) === n);
  return rec ? String(rec.status || '').trim() : '';
}

function setPickerValue(kind, id){
  const hid = document.getElementById(kind === 'type' ? 'fType' : 'fStatus');
  const txt = document.getElementById(kind === 'type' ? 'fTypeBtnText' : 'fStatusBtnText');
  if (!hid || !txt) return;
  if (!id) {
    hid.value = '';
    txt.textContent = 'Válassz...';
    return;
  }
  hid.value = String(id);
  txt.textContent = kind === 'type' ? getLabelForType(id) : getLabelForStatus(id);
}

function openPickPanel(kind, anchorBtn){
  const panel = document.getElementById('cmPickPanel');
  if (!panel || !anchorBtn) return;

  const data = (kind === 'type') ? (_formTypes || []) : (_formStatuses || []);
  const selectedId = String(document.getElementById(kind === 'type' ? 'fType' : 'fStatus')?.value || '');

  const title = kind === 'type' ? 'Típus választása' : 'Állapot választása';
  const nameKey = kind === 'type' ? 'type' : 'status';

  const rows = data.map(r => {
    const id = String(r.id);
    const name = String(r[nameKey] || '').trim();
    const internalId = String(r.internalId || '').trim();
    const desc = String(r.description || '').trim();
    const sel = (id && id === selectedId) ? ' data-selected="1"' : '';
    return `<tr data-id="${escapeHtml(id)}"${sel}>
      <td class="col-name">${escapeHtml(name)}</td>
      <td class="col-int">${escapeHtml(internalId)}</td>
      <td class="col-desc">${escapeHtml(desc)}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="pick-head">
      <div class="pick-title">${escapeHtml(title)}</div>
      <button type="button" class="pick-close" aria-label="Bezárás">×</button>
    </div>
    <table>
      <thead><tr><th>${kind==='type'?'Típus':'Állapot'}</th><th>Saját az.</th><th>Leírás</th></tr></thead>
      <tbody>${rows || ''}</tbody>
    </table>
  `;

  const rect = anchorBtn.getBoundingClientRect();
  const maxW = Math.min(760, window.innerWidth - 20);
  const width = Math.max(320, Math.min(maxW, rect.width * 1.25));
  panel.style.width = width + 'px';
  panel.style.left = Math.min(window.innerWidth - width - 10, Math.max(10, rect.left)) + 'px';
  panel.style.top = Math.min(window.innerHeight - 240, rect.bottom + 8) + 'px';
  panel.style.display = 'block';

  const close = () => { panel.style.display = 'none'; };
  panel.querySelector('.pick-close')?.addEventListener('click', (e) => { e.preventDefault(); close(); });

  const onDoc = (ev) => {
    if (!panel.contains(ev.target) && ev.target !== anchorBtn) {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('touchstart', onDoc, true);
      close();
    }
  };
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('touchstart', onDoc, true);

  panel.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      e.preventDefault();
      const id = tr.getAttribute('data-id');
      setPickerValue(kind, id);
      close();
    });
  });
}


async function openEditModal(marker) {
  markerModalMode = "edit";
  editingMarkerId = marker.id;
  editingMarkerUuid = marker.uuid;
  pendingLatLng = null;

  setMarkerModalTitle("edit");
  setMarkerModalControlsDisabled({ addressLocked: true });

  // Cím mezők (csak megjelenítés)
  const parts = String(marker.address || "").split(",").map(x => x.trim()).filter(Boolean);
  document.getElementById("fCity").value = parts[0] || "";
  document.getElementById("fStreet").value = parts[1] || "";
  document.getElementById("fHouse").value = parts[2] || "";

  // Típus (nem módosítható)
  setPickerValue('type', marker.typeId || null);
  const typeBtn = document.getElementById('fTypeBtn');
  if (typeBtn) typeBtn.disabled = true;

  // Állapot + megjegyzés (módosítható)
  setPickerValue('status', marker.statusId || null);
  const statusBtn = document.getElementById('fStatusBtn');
  if (statusBtn) statusBtn.disabled = false;
  document.getElementById("fNotes").value = marker.notes || "";

  // Fotók hozzáadás: a marker UUID-hoz kötjük
  currentDraftUuid = editingMarkerUuid || genUuid();
  draftHasSaved = true; // szerkesztésnél soha ne töröljük a képeket cancel esetén
  await updateAttachPhotoLabel();

  document.getElementById("markerModal").style.display = "flex";
}

async function loadMarkers() {
  const all = await DB.getAllMarkersActive();
  all.forEach(addMarkerToMap);

  updateShowAllButtonVisibility();
}

async function fillLookups() {
  // v5.50: Felvitel/szerkesztés a Beállításokban tárolt típusok/állapotok alapján
  const types = await DB.getAllObjectTypes().catch(() => []) || [];
  const statuses = await DB.getAllObjectStatuses().catch(() => []) || [];

  _formTypes = types;
  _formStatuses = statuses;

  // cache a marker színekhez (typeId -> color)
  try { setTypeMetaCache(types); } catch (_) {}

  // alapértékek (nincs default kiválasztás)
  setPickerValue('type', null);
  setPickerValue('status', null);
}


async function saveMarker() {
  // EDIT mód
  if (markerModalMode === "edit") {
    if (!editingMarkerId) return;
    const notes = document.getElementById("fNotes").value.trim();
    const statusId = Number(document.getElementById("fStatus")?.value || NaN);
    const sRec = _formStatuses.find(x => Number(x.id) === statusId) || null;
    const statusLabel = sRec ? String(sRec.status || '').trim() : '';
    const statusInternalId = sRec ? String(sRec.internalId || '').trim() : '';

    await DB.updateMarker(editingMarkerId, {
      statusId: Number.isFinite(statusId) ? statusId : null,
      status: String(statusInternalId || ""),
      statusLabel: String(statusLabel || ""),
      statusInternalId: String(statusInternalId || ""),
      notes,
      updatedAt: Date.now()
    });

    const updated = await DB.getMarkerById(editingMarkerId);
    const mk = markerLayers.get(editingMarkerId);
    if (updated && mk) {
      mk.__data = updated;
      mk.setPopupContent(popupHtml(updated));
    }

    closeModal();
    showHint("Objektum módosítva.");
    return;
  }

  // ADD mód
  if (!pendingLatLng) return;

  const city = document.getElementById("fCity").value.trim();
  const street = document.getElementById("fStreet").value.trim();
  const house = document.getElementById("fHouse").value.trim();

  const address = [city, street, house].filter(Boolean).join(", ");
  if (!address) {
    alert("A cím megadása kötelező (város / közterület / házszám).");
    return;
  }

  const uuid = currentDraftUuid || genUuid();
  const typeId = Number(document.getElementById("fType")?.value || NaN);
  const statusId = Number(document.getElementById("fStatus")?.value || NaN);

  if (!Number.isFinite(typeId)) {
    alert('A Típus kiválasztása kötelező.');
    return;
  }
  if (!Number.isFinite(statusId)) {
    alert('Az Állapot kiválasztása kötelező.');
    return;
  }
  const tRec = _formTypes.find(x => Number(x.id) === typeId) || null;
  const sRec = _formStatuses.find(x => Number(x.id) === statusId) || null;
  const typeInternalId = tRec ? String(tRec.internalId || '').trim() : '';
  const statusInternalId = sRec ? String(sRec.internalId || '').trim() : '';
  const typeLabel = tRec ? String(tRec.type || '').trim() : '';
  const statusLabel = sRec ? String(sRec.status || '').trim() : '';
  const marker = {
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    address,
    // v5.48: a marker a kiválasztott típus/állapot ID-t menti (nem beégetett kódot)
    typeId: Number.isFinite(typeId) ? typeId : null,
    statusId: Number.isFinite(statusId) ? statusId : null,
    // kompatibilitás / ikonok: belső azonosító(k) külön is megmaradnak
    type: String(typeInternalId || ""),
    status: String(statusInternalId || ""),
    typeInternalId: String(typeInternalId || ""),
    statusInternalId: String(statusInternalId || ""),
    typeLabel: String(typeLabel || ''),
    statusLabel: String(statusLabel || ''),
    notes: document.getElementById("fNotes").value.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    uuid
  };

  const id = await DB.addMarker(marker);
  marker.id = id;

  // Ettől kezdve a draft-hoz tartozó képek "éles" markerhez vannak kötve.
  draftHasSaved = true;

  addMarkerToMap(marker);
  closeModal();
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (window.__cmReloaded) return;
    window.__cmReloaded = true;
    location.reload();
  });

  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          w.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    reg.update().catch(() => {});
  }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", async () => {
  window.addEventListener("online", checkForUpdateOnline);
  updateAppVersionUI();
  registerSW();
  checkForUpdateOnline();

  // Induláskor ellenőrizzük, hogy engedélyezve van-e a helymeghatározás.
  // (Ez nem kér engedélyt automatikusan, csak tájékoztat.)
  await checkGeolocationPermissionOnStartup();

  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  // v5.42.2: iránytű indítás (ha elérhető)
  startCompassIfPossible();
  scheduleApplyNavBearing();


  // v5.40: ha a felhasználó kézzel mozgatja/zoomolja a térképet, kikapcsoljuk a GPS-követést.
  // A "Saját helyem" gomb visszakapcsolja.
  map.on("dragstart", (e) => { if (e && e.originalEvent) myLocFollowEnabled = false; });
  map.on("zoomstart", (e) => { if (e && e.originalEvent) myLocFollowEnabled = false; });
  map.on("moveend", () => updateMyLocFabVisibility());
  map.on("zoomend", () => updateMyLocFabVisibility());


  await DB.init();

  // DB migrations / safety cleanups (uuid backfill, invalid photo rows)
  await DB.backfillMarkerMeta();
  await DB.cleanInvalidPhotos();

  await fillLookups();
  // v5.50: Táblázatos Típus/Állapot választó
  const fTypeBtn = document.getElementById('fTypeBtn');
  if (fTypeBtn) fTypeBtn.addEventListener('click', (e) => { e.preventDefault(); if (!fTypeBtn.disabled) openPickPanel('type', fTypeBtn); });
  const fStatusBtn = document.getElementById('fStatusBtn');
  if (fStatusBtn) fStatusBtn.addEventListener('click', (e) => { e.preventDefault(); if (!fStatusBtn.disabled) openPickPanel('status', fStatusBtn); });


  document.getElementById("btnCancel").addEventListener("click", closeModal);
  document.getElementById("btnSave").addEventListener("click", saveMarker);

  // v5.11: fénykép hozzárendelése (kamera / tallózás)
  const btnAttachPhoto = document.getElementById("btnAttachPhoto");
  const photoInput = document.getElementById("photoInput");
  if (btnAttachPhoto && photoInput) {
    btnAttachPhoto.addEventListener("click", () => {
      if (!currentDraftUuid) {
        draftHasSaved = false;
        currentDraftUuid = genUuid();
      }
      photoInput.value = "";
      photoInput.click();
    });

    photoInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      for (const f of files) {
        try {
          await DB.addPhoto(currentDraftUuid, f);
        } catch (err) {
          console.error("Photo save failed", err);
        }
      }
      await updateAttachPhotoLabel();
    });
  }
  const btnMyLocFab = document.getElementById("btnMyLocFab");
if (btnMyLocFab) {
  btnMyLocFab.addEventListener("click", async () => {
    // Saját hely középre (Google Maps-szerű gomb)
    try { await requestCompassPermissionIfNeeded(); } catch (_) {}
    startCompassIfPossible();
    myLocFollowEnabled = true;

    const ok = await centerToMyLocation();
    if (!ok) {
      alert(
	        "Nem sikerült lekérni a pozíciót.\n\n" +
	        "Ellenőrizd, hogy engedélyezve van-e a helymeghatározás, és hogy van-e GPS/jel."
      );
    }
    updateMyLocFabVisibility();
  });
}


  

// v5.41: Navigáció mód váltó gomb (észak felül / haladási irány – kompromisszumos "lite")
const navBtn = document.getElementById("btnNavMode");
if (navBtn) {
  const syncNavBtn = () => {
    const isLite = (navMode === "lite");
    navBtn.classList.toggle("nav-heading", isLite);
    navBtn.title = isLite ? "Navigáció: haladási irány (lite)" : "Navigáció: észak felül";
    navBtn.setAttribute("aria-label", navBtn.title);
  };
  syncNavBtn();


  navBtn.addEventListener("click", async () => {
    navMode = (navMode === "lite") ? "north" : "lite";
    try { localStorage.setItem("citymap_nav_mode", navMode); } catch (_) {}
    syncNavBtn();

    // Mindkét mód váltáskor: követés bekapcsol és saját hely középre
    myLocFollowEnabled = true;

    // Iránytű indítása (Androidon általában prompt nélkül működik)
    try { await requestCompassPermissionIfNeeded(); } catch (_) {}
    startCompassIfPossible();

    // Mindig középre rakjuk a saját helyet gombnyomásra (mindkét módban)
    try {
      await centerToMyLocation();
    } catch (_) {}

    // Azonnali vizuális váltás: ha van friss pozíciónk, a kiválasztott mód szerint
    // állítsuk be a követés cél-centerét (lite módban előretolás).
    try {
      if (map && lastMyLocation) {
        const sp = (typeof lastSpeedMps === "number" && isFinite(lastSpeedMps)) ? lastSpeedMps : NaN;
        const accM = (lastRawMyLocation && typeof lastRawMyLocation.acc === "number") ? lastRawMyLocation.acc : 999999;
        const desired = desiredFollowCenter(lastMyLocation.lat, lastMyLocation.lng, sp, accM);
        lastMyLocCenterTs = Date.now();
        map.panTo([desired.lat, desired.lng], {
          animate: true,
          duration: GPS_CENTER_ANIM_S,
          easeLinearity: 0.25,
        });
      }
    } catch (_) {}


    // Forgatás/irány alkalmazása a kiválasztott navigáció mód szerint
    scheduleApplyNavBearing();

    // frissítsük az alsó "Középre" gomb láthatóságát is
    try { updateMyLocFabVisibility(); } catch (_) {}
  });
}

  document.getElementById("btnClear").addEventListener("click", async () => {
    if (!confirm("Biztosan törlöd az összes markert?")) return;
    await DB.clearMarkers();
    for (const mk of markerLayers.values()) map.removeLayer(mk);
    markerLayers.clear();
    activeMapFilterIds = null;
    updateShowAllButtonVisibility();
  });
  map.on("click", async (e) => {
    // Ha marker mozgatás mód aktív, akkor a kattintás az új pozíció
    if (moveModeMarkerId) {
      const ll = rotatedClickLatLng(e);
      const id = moveModeMarkerId;
      moveModeMarkerId = null;
      try {
        await DB.updateMarker(id, { lat: ll.lat, lng: ll.lng, updatedAt: Date.now() });
        const mk = markerLayers.get(id);
        if (mk) {
          mk.setLatLng([ll.lat, ll.lng]);
          const updated = await getMarker(id);
          if (updated) {
            mk.__data = updated;
            mk.setIcon(resizedIconForMarker(updated, map.getZoom()));
            mk.setPopupContent(popupHtml(updated));
          }
        }
        showHint("Objektum áthelyezve.");
      } catch (err) {
        console.error("move marker failed", err);
        alert("Nem sikerült áthelyezni az objektumot.");
      }
      return;
    }
  });


  // v5.44: Új objektum felvitele csak hosszú nyomásra (mobilon is)
  (function setupLongPressAddObject(){
    const container = map.getContainer();
    const LONGPRESS_MS = 550;
    const MOVE_TOL_PX = 12;

    let timer = null;
    let startPt = null;
    let startEvt = null;
    let activePointerId = null;
    let suppressClickUntil = 0;

    function clear(){
      if (timer) { clearTimeout(timer); timer = null; }
      startPt = null;
      startEvt = null;
      activePointerId = null;
    }

    function getPrimaryEvent(ev){
      // TouchEvent -> Touch point; Pointer/Mouse -> itself
      if (ev.touches && ev.touches[0]) return ev.touches[0];
      if (ev.changedTouches && ev.changedTouches[0]) return ev.changedTouches[0];
      return ev;
    }

    function getPoint(ev){
      const e = getPrimaryEvent(ev);
      const x = typeof e.clientX === 'number' ? e.clientX : 0;
      const y = typeof e.clientY === 'number' ? e.clientY : 0;
      return {x,y};
    }

    function eventToLatLng(ev){
      const e = getPrimaryEvent(ev);
      const cp = map.mouseEventToContainerPoint(e); // needs clientX/Y
      return map.containerPointToLatLng(cp);
    }

    function trigger(ev){
      if (!ev) return;
      // Mozgatás módban a sima kattintás kezeli, longpress ne zavarjon be
      if (moveModeMarkerId) return;

      suppressClickUntil = Date.now() + 800;

      try { if (ev.preventDefault) ev.preventDefault(); } catch(_){}
      try { if (ev.stopPropagation) ev.stopPropagation(); } catch(_){}

      const latlngRaw = eventToLatLng(ev);
      const ll = rotatedClickLatLng({ latlng: latlngRaw, originalEvent: ev });
      openModal(ll);
    }

    function onDown(ev){
      // Csak bal gomb / touch / pointer
      if (ev.type === 'mousedown' && ev.button !== 0) return;
      if (ev.type === 'pointerdown') activePointerId = ev.pointerId;

      startPt = getPoint(ev);
      startEvt = ev;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        trigger(startEvt);
        clear();
      }, LONGPRESS_MS);
    }

    function onMove(ev){
      if (!startPt || !timer) return;
      if (ev.type === 'pointermove' && activePointerId !== null && ev.pointerId !== activePointerId) return;

      const p = getPoint(ev);
      const dx = p.x - startPt.x;
      const dy = p.y - startPt.y;
      if ((dx*dx + dy*dy) > (MOVE_TOL_PX*MOVE_TOL_PX)) clear();
    }

    function onUp(ev){
      if (ev && ev.type === 'pointerup' && activePointerId !== null && ev.pointerId !== activePointerId) return;
      clear();
    }

    // Pointer events (Android/modern browsers)
    container.addEventListener('pointerdown', onDown, {passive:false});
    container.addEventListener('pointermove', onMove, {passive:true});
    container.addEventListener('pointerup', onUp, {passive:true});
    container.addEventListener('pointercancel', onUp, {passive:true});

    // Fallback
    container.addEventListener('mousedown', onDown, {passive:true});
    container.addEventListener('mousemove', onMove, {passive:true});
    container.addEventListener('mouseup', onUp, {passive:true});
    container.addEventListener('mouseleave', onUp, {passive:true});

    // Touch fallback (iOS/older)
    container.addEventListener('touchstart', onDown, {passive:false});
    container.addEventListener('touchmove', onMove, {passive:true});
    container.addEventListener('touchend', onUp, {passive:true});
    container.addEventListener('touchcancel', onUp, {passive:true});

    // Prevent long-press context menu on mobile
    container.addEventListener('contextmenu', (e) => {
      if (timer || startPt) {
        try { e.preventDefault(); } catch(_){}
      }
    }, {passive:false});

    // Suppress synthetic click right after longpress
    map.on('click', (e) => {
      if (Date.now() < suppressClickUntil) {
        try { e.originalEvent && e.originalEvent.preventDefault && e.originalEvent.preventDefault(); } catch(_){}
        return;
      }
    });
  })();
  const ok = await centerToMyLocation();
  if (!ok) map.setView([47.4979, 19.0402], 15);

  await loadMarkers();
  
  map.on("zoomend", () => {
  const z = map.getZoom();
  markerLayers.forEach((mk, id) => {
    const data = mk.__data;
    if (!data) return;
    mk.setIcon(resizedIconForMarker(data, z));
  });
});

  document.getElementById("btnFilter").addEventListener("click", () => {
    // Ha épp térképi megjelenítés-szűrés aktív (csak kijelöltek / táblázat tartalma),
    // akkor a Szűrés gomb úgy viselkedjen, mintha "Összes megjelenítése" történt volna.
    if (isMapFiltered()) showAllMarkersAndFit();
    openFilterModal();
  });
  document.getElementById("btnFilterClose").addEventListener("click", closeFilterModal);
  initFilterDragClose();

  const btnSettings = document.getElementById("btnSettings");
  if (btnSettings) btnSettings.addEventListener("click", openSettingsModal);
  const btnSettingsClose = document.getElementById("btnSettingsClose");
  if (btnSettingsClose) btnSettingsClose.addEventListener("click", closeSettingsModal);

  // oldalsó menü kattintás
  document.querySelectorAll("#settingsModal .settings-nav-item").forEach((b) => {
    b.addEventListener("click", () => setSettingsPage(b.dataset.page));
  });

  // overlay kattintás: csak ha a háttérre kattint (nem a tartalomra)
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  const btnShowAll = document.getElementById("btnShowAll");
  if (btnShowAll) {
    btnShowAll.addEventListener("click", () => {
      showAllMarkersAndFit();
      showHint("Összes marker megjelenítve.");
    });
  }

    const showBtn = document.getElementById("filterShowBtn");
  if (showBtn) {
    showBtn.disabled = true;
    showBtn.addEventListener("click", () => {
      // v5.15: Megjelenítés
      // - ha van kijelölés: csak a kijelölt (nem törölt) markerek maradjanak a térképen
      // - ha nincs kijelölés: a táblázat aktuális (szűrt) tartalma alapján

      const selectedIds = Array.from(selectedFilterMarkerIds)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));

      let idsToShow = [];
      if (selectedIds.length > 0) {
        // törölt elemeket ne próbáljuk megjeleníteni (amúgy sincsenek a térképen)
        const deletedInSelection = new Set(
          Array.from(document.querySelectorAll('#sfList tr.row-selected.row-deleted'))
            .map((tr) => Number(tr.dataset.markerId))
            .filter((x) => Number.isFinite(x))
        );
        idsToShow = selectedIds.filter((id) => !deletedInSelection.has(id));

        // Ha csak törölt elemek vannak kijelölve, akkor ne zárjuk be az ablakot
        if (idsToShow.length === 0) {
          showHint("Nem lehet megjeleníteni a törölt markereket.");
          return;
        }

        if (deletedInSelection.size > 0) {
          showHint("A törölt markereket nem lehet megjeleníteni – kihagyva.");
        }
      } else {
        idsToShow = getIdsFromCurrentFilterTable({ includeDeleted: false });
        if (idsToShow.length === 0) {
          showHint("Nincs megjeleníthető (nem törölt) marker a listában.");
          return;
        }
      }

      applyMapMarkerVisibility(idsToShow);
      // A térkép legyen úgy méretezve, hogy az összes megjelenített marker látszódjon
      fitMapToMarkersByIds(idsToShow);
      closeFilterModal();
    });
  }

  const clearBtn = document.getElementById("filterClearSelectionBtn");
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.addEventListener("click", clearAllFilterSelections);
  }

  const clearIconBtn = document.getElementById("filterClearSelectionIconBtn");
  if (clearIconBtn) {
    clearIconBtn.addEventListener("click", (e) => { e.preventDefault(); clearAllFilterSelections(); });
  }
  const editBtn = document.getElementById("filterEditBtn");
  if (editBtn) {
    editBtn.disabled = true;
    editBtn.addEventListener("click", async () => {
      const rows = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
      if (rows.length !== 1) return;

      const tr = rows[0];
      if (tr.classList.contains('row-deleted')) return;

      const id = Number(tr.dataset.markerId);
      if (!Number.isFinite(id)) return;

      try {
        const m = await DB.getMarkerById(id);
        if (!m || m.deletedAt) {
          showHint("A törölt marker nem módosítható.");
          return;
        }
        closeFilterModal();
        openEditModal(m);
      } catch (err) {
        console.error("filter edit open failed", err);
        alert("Nem sikerült betölteni a marker adatait.");
      }
    });
  }

  const deleteBtn = document.getElementById("filterDeleteSelectedBtn");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.addEventListener("click", async () => {
      const ids = Array.from(selectedFilterMarkerIds)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));

      if (ids.length === 0) {
        alert("Nincs kijelölt sor.");
        return;
      }

      const count = ids.length;
      const ok = confirm(
        `Biztosan törlöd (soft delete) a kijelölt ${count} db marker(eke)t? A töröltek később megjeleníthetők.`
      );
      if (!ok) return;

      try {
        // Törlés az adatbázisból (soft delete) + eltávolítás a térképről
        for (const id of ids) {
          await DB.softDeleteMarker(id);

          const leafletMarker = markerLayers.get(id);
          if (leafletMarker) {
            map.removeLayer(leafletMarker);
            markerLayers.delete(id);
          }

          if (activeMapFilterIds instanceof Set) activeMapFilterIds.delete(Number(id));
        }

        updateShowAllButtonVisibility();

        // UI frissítés: cache frissítés + kiválasztások törlése + táblázat újraszűrése
        // (különben törlés után a táblázatban még látszódhatnak sorok a cache miatt)
        _allMarkersCache = filterShowDeleted ? await DB.getAllMarkers() : await DB.getAllMarkersActive();
        selectedFilterMarkerIds.clear();
        updateFilterShowButtonState();
        applyFilter();
      } catch (e) {
        console.error(e);
        alert("Hiba történt a törlés közben.");
      }
    });
  }
  const showDeletedBtn = document.getElementById("filterShowDeletedBtn");
  if (showDeletedBtn) {
    showDeletedBtn.addEventListener("click", async () => {
      filterShowDeleted = !filterShowDeleted;
      updateShowDeletedBtn(showDeletedBtn);
      clearAllFilterSelections();
      await refreshFilterData();
    });
  }

  const excelBtn = document.getElementById("filterExcelBtn");
  if (excelBtn) {
    excelBtn.disabled = false;
    excelBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      exportFilterTableToExcel();
    });
  }

  document.getElementById("sfAddress").addEventListener("input", applyFilter);
  document.getElementById("sfType").addEventListener("change", applyFilter);
  document.getElementById("sfStatus").addEventListener("change", applyFilter);
  const sfNotesEl = document.getElementById("sfNotes");
  if (sfNotesEl) sfNotesEl.addEventListener("input", applyFilter);

  // v5.31: Szűrők az oszlopfejlécben (felugró input/select)
  const popIds = ["sfAddressPop", "sfTypePop", "sfStatusPop", "sfNotesPop"];
  function closeHeaderFilterPops() {
    popIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("open");
    });
  }

  function togglePop(popId, focusElId) {
    const pop = document.getElementById(popId);
    if (!pop) return;
    const willOpen = !pop.classList.contains("open");
    closeHeaderFilterPops();
    if (willOpen) {
      pop.classList.add("open");
      const f = document.getElementById(focusElId);
      if (f && typeof f.focus === "function") setTimeout(() => f.focus(), 0);
    }
  }

  const bAddr = document.getElementById("sfAddressFilterBtn");
  if (bAddr) bAddr.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfAddressPop", "sfAddress"); });
  const bType = document.getElementById("sfTypeFilterBtn");
  if (bType) bType.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfTypePop", "sfType"); });
  const bStatus = document.getElementById("sfStatusFilterBtn");
  if (bStatus) bStatus.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfStatusPop", "sfStatus"); });
  const bNotes = document.getElementById("sfNotesFilterBtn");
  if (bNotes) bNotes.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfNotesPop", "sfNotes"); });

  popIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", (e) => e.stopPropagation());
  });

  document.addEventListener("click", closeHeaderFilterPops);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeHeaderFilterPops();
  });

  // Modal bezáráskor is zárjuk a felugrókat
  const btnFilterClose = document.getElementById("btnFilterClose");
  if (btnFilterClose) btnFilterClose.addEventListener("click", closeHeaderFilterPops);

  const sfClearBtn = document.getElementById("sfClearAllFiltersBtn");
  if (sfClearBtn) sfClearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const a = document.getElementById("sfAddress");
    const t = document.getElementById("sfType");
    const s = document.getElementById("sfStatus");
    const n = document.getElementById("sfNotes");
    if (a) a.value = "";
    if (t) t.value = "";
    if (s) s.value = "";
    if (n) n.value = "";
    closeHeaderFilterPops();
    applyFilter();
  });

});


async function checkForUpdateOnline() {
  if (!navigator.onLine) return;

  try {
    const r = await fetch("./app.js", { cache: "no-store" });
    const t = await r.text();
    const m = t.match(/const\s+APP_VERSION\s*=\s*"([^"]+)"/);
    if (m && m[1] !== APP_VERSION) {
      location.reload();
    }
  } catch (e) {}
}


function markerScaleForZoom(z) {
  if (z >= 18) return 1.0;
  if (z === 17) return 0.95;
  if (z === 16) return 0.85;
  if (z === 15) return 0.75;
  if (z === 14) return 0.65;
  return 0.6;
}

function resizedIconForMarker(data, zoom) {
  return iconForMarker(data, zoom);
}


function userIconForZoom(zoom) {
  const scale = markerScaleForZoom(zoom);
  const size = 28 * scale;
  return L.icon({
    iconUrl: "./icons/user.png",
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 0.9],
    popupAnchor: [0, -size / 2]
  });
}


function myLocArrowIconForZoomHeading(zoom, headingDeg) {
  const scale = markerScaleForZoom(zoom);
  const size = 38 * scale;

  // L.divIcon: az IMG forgatása inline style-lal történik (Leaflet alap, nincs plugin).
  const rot = (typeof headingDeg === "number" && isFinite(headingDeg)) ? headingDeg : 0;

  return L.divIcon({
    className: "my-loc-arrow-wrap",
    html:
      `<img class="my-loc-arrow" src="./icons/arrow.svg" ` +
      `style="width:${size}px;height:${size}px;transform:rotate(${rot}deg);transform-origin:50% 50%;" ` +
      `alt="irány">`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 0.9],
    popupAnchor: [0, -size / 2]
  });
}

function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = toDeg(Math.atan2(y, x));
  θ = (θ + 360) % 360;
  return θ;
}

// Két szög (fok) közti legkisebb eltérés (-180..+180)
function shortestAngleDelta(fromDeg, toDeg) {
  let d = ((toDeg - fromDeg + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

function offsetLatLng(lat, lng, bearing, meters) {
  // Nagyon kis távolságokra jó közelítés (nav kijelzéshez)
  const R = 6378137;
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;

  const δ = meters / R;
  const θ = toRad(bearing);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return [toDeg(φ2), toDeg(λ2)];
}


/* ===== Filter modal (v5.3) ===== */
let _allMarkersCache = [];
let _lastFilterList = [];

function openFilterModal() {
  photoCountCache.clear();
  const fm = document.getElementById("filterModal");
  if (fm) {
    const mc = fm.querySelector(".modal-content");
    if (mc) { mc.style.transition = ""; mc.style.transform = ""; mc.style.willChange = ""; }
    fm.style.display = "flex";
  }
  document.documentElement.classList.add("filter-modal-open");
  document.body.classList.add("filter-modal-open");
  initFilterDragClose();
  document.getElementById("sfAddress").value = "";

  // újranyitáskor alapból töröljük a kijelöléseket (később átállítható, ha kell)
  selectedFilterMarkerIds = new Set();
  const showBtn = document.getElementById("filterShowBtn");
  if (showBtn) showBtn.disabled = true;
  refreshFilterData().catch(console.error);

  const showDelBtn = document.getElementById("filterShowDeletedBtn");
  if (showDelBtn) {
    updateShowDeletedBtn(showDelBtn);
  }
}

function closeFilterModal() {
  const fm = document.getElementById("filterModal");
  if (fm) {
    const mc = fm.querySelector(".modal-content");
    if (mc) { mc.style.transition = ""; mc.style.transform = ""; mc.style.willChange = ""; }
    fm.style.display = "none";
  }
  document.documentElement.classList.remove("filter-modal-open");
  document.body.classList.remove("filter-modal-open");
  selectedFilterMarkerIds = new Set();
  const showBtn = document.getElementById("filterShowBtn");
  if (showBtn) showBtn.disabled = true;
}

// Mobilon: a szűrés ablak tetején lévő "fogantyú" lehúzásával bezárás
let _filterDragCloseInited = false;
function initFilterDragClose() {
  if (_filterDragCloseInited) return;
  const handle = document.getElementById("filterDragHandle");
  const modal = document.getElementById("filterModal");
  const modalContent = modal ? modal.querySelector(".modal-content") : null;
  if (!handle || !modal || !modalContent) return;

  _filterDragCloseInited = true;

  let startY = 0;
  let currentDY = 0;
  let dragging = false;

  const THRESHOLD_PX = 110;
  const MAX_TRANSLATE_PX = 260;

  const isMobile = () => window.matchMedia && window.matchMedia("(max-width: 640px)").matches;

  const resetTransform = () => {
    modalContent.style.transition = "";
    modalContent.style.transform = "";
  };

  handle.addEventListener("pointerdown", (e) => {
    if (!isMobile()) return;
    if (modal.style.display !== "flex") return;

    dragging = true;
    startY = e.clientY;
    currentDY = 0;

    modalContent.style.transition = "none";
    modalContent.style.willChange = "transform";

    try { handle.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = Math.max(0, e.clientY - startY);
    currentDY = dy;
    modalContent.style.transform = `translateY(${Math.min(dy, MAX_TRANSLATE_PX)}px)`;
    e.preventDefault();
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;

    modalContent.style.transition = "transform 160ms ease";
    modalContent.style.willChange = "";

    if (currentDY >= THRESHOLD_PX) {
      modalContent.style.transform = `translateY(${MAX_TRANSLATE_PX}px)`;
      setTimeout(() => {
        resetTransform();
        closeFilterModal();
      }, 170);
    } else {
      modalContent.style.transform = "translateY(0px)";
      setTimeout(() => resetTransform(), 180);
    }
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  // Biztonság: ha bezárjuk más módon (ESC, overlay click), ne maradjon transform
  window.addEventListener("resize", () => {
    if (!isMobile()) resetTransform();
  });
}


async function fillFilterCombos() {
  // v5.48: szűrés a Beállításokban tárolt típusok/állapotok alapján
  let types = await DB.getAllObjectTypes().catch(() => []) || [];
  let statuses = await DB.getAllObjectStatuses().catch(() => []) || [];
  if (!types || types.length === 0) {
    const base = await DB.getLookup("markerTypes") || [];
    types = base.map((x, i) => ({ id: i + 1, internalId: x.code, type: x.label }));
  }
  if (!statuses || statuses.length === 0) {
    const base = await DB.getLookup("markerStatus") || [];
    statuses = base.map((x, i) => ({ id: i + 1, internalId: x.code, status: x.label }));
  }

  const t = document.getElementById("sfType");
  const s = document.getElementById("sfStatus");
    const n = document.getElementById("sfNotes");

  t.innerHTML = '<option value="">Összes</option>';
  types.forEach(x => {
    const o = document.createElement("option");
    o.value = String(x.id);
    o.textContent = String(x.type || "");
    o.dataset.internalId = String(x.internalId || "");
    t.appendChild(o);
  });

  s.innerHTML = '<option value="">Összes</option>';
  statuses.forEach(x => {
    const o = document.createElement("option");
    o.value = String(x.id);
    o.textContent = String(x.status || "");
    o.dataset.internalId = String(x.internalId || "");
    s.appendChild(o);
  });
}

function updateFilterShowButtonState() {
  // 5.8: a kijelöléshez kötött gombok állapotának frissítése
  const hasSelection = selectedFilterMarkerIds.size > 0;

  const tableHasRows = document.querySelectorAll('#sfList tr').length > 0;

  const showBtn = document.getElementById("filterShowBtn");
const clearBtn = document.getElementById("filterClearSelectionBtn");
  const deleteBtn = document.getElementById("filterDeleteSelectedBtn");
const editBtn = document.getElementById("filterEditBtn");

  // v5.15: Megjelenítés akkor is működjön, ha nincs kijelölés (ilyenkor a táblázat aktuális sorai alapján)
  if (showBtn) showBtn.disabled = !tableHasRows;
  if (clearBtn) clearBtn.disabled = !hasSelection;
  if (deleteBtn) deleteBtn.disabled = !hasSelection;

  // v5.19: Objektum módosítása gomb: pontosan 1 sor kijelölve ÉS nem törölt
  if (editBtn) {
    const selectedRows = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
    if (selectedRows.length !== 1) {
      editBtn.disabled = true;
    } else {
      const tr = selectedRows[0];
      editBtn.disabled = tr.classList.contains('row-deleted');
    }
  }

  
  // v5.29: overlay szerkesztés ikon megjelenítése csak akkor, ha pontosan 1 (nem törölt) sor kijelölt
  const selectedRowsForOverlay = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
  document.querySelectorAll('#sfList .sf-edit-overlay-btn').forEach((b) => (b.style.display = 'none'));
  if (selectedRowsForOverlay.length === 1) {
    const tr = selectedRowsForOverlay[0];
    if (!tr.classList.contains('row-deleted')) {
      const b = tr.querySelector('.sf-edit-overlay-btn');
      if (b) b.style.display = 'flex';
    }
  }
}

function getIdsFromCurrentFilterTable({ includeDeleted = false } = {}) {
  const ids = [];
  document.querySelectorAll('#sfList tr').forEach((tr) => {
    const idStr = tr.dataset.markerId;
    if (!idStr) return;
    if (!includeDeleted && tr.classList.contains('row-deleted')) return;
    const id = Number(idStr);
    if (Number.isFinite(id)) ids.push(id);
  });
  return ids;
}

function applyMapMarkerVisibility(idsToShow) {
  const want = new Set((idsToShow || []).map((x) => Number(x)).filter((x) => Number.isFinite(x)));
  activeMapFilterIds = want.size > 0 ? want : new Set();

  // Minden aktív (térképen létező) markerből csak a kért id-k maradjanak láthatók
  for (const [id, mk] of markerLayers.entries()) {
    const shouldBeVisible = want.has(Number(id));
    const isVisibleNow = map && mk ? map.hasLayer(mk) : false;

    if (shouldBeVisible && !isVisibleNow) {
      mk.addTo(map);
    } else if (!shouldBeVisible && isVisibleNow) {
      map.removeLayer(mk);
    }
  }

  updateShowAllButtonVisibility();
}

// A térkép igazítása a megjelenített markerekhez (szűrés után)
function fitMapToMarkersByIds(idsToShow) {
  if (!map) return;
  const ids = (idsToShow || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (ids.length === 0) return;

  const latlngs = [];
  for (const id of ids) {
    const mk = markerLayers.get(Number(id));
    if (!mk) continue;
    if (typeof mk.getLatLng === "function") {
      latlngs.push(mk.getLatLng());
    }
  }

  if (latlngs.length === 0) return;

  if (latlngs.length === 1) {
    const targetZoom = Math.max(map.getZoom(), 18);
    map.setView(latlngs[0], targetZoom, { animate: true });
    return;
  }

  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18, animate: true });
}

function toggleFilterRowSelection(markerId, trEl) {
  const id = Number(markerId);
  if (!Number.isFinite(id)) return;

  const cb = trEl ? trEl.querySelector('input.row-select') : null;

  if (selectedFilterMarkerIds.has(id)) {
    selectedFilterMarkerIds.delete(id);
    if (trEl) trEl.classList.remove("row-selected");
    if (cb) cb.checked = false;
  } else {
    selectedFilterMarkerIds.add(id);
    if (trEl) trEl.classList.add("row-selected");
    if (cb) cb.checked = true;
  }
  updateFilterShowButtonState();
}

function selectOnlyFilterRow(markerId, trEl) {
  const id = Number(markerId);
  if (!Number.isFinite(id)) return;

  // v5.30.3: ha már pontosan ez az egy van kijelölve és újra rákattintunk,
  // akkor vegyük vissza a kijelölést (toggle off).
  if (selectedFilterMarkerIds.size === 1 && selectedFilterMarkerIds.has(id)) {
    clearAllFilterSelections();
    return;
  }

selectedFilterMarkerIds.clear();
  document.querySelectorAll('#sfList tr.row-selected').forEach(tr => tr.classList.remove('row-selected'));
  document.querySelectorAll('#sfList input.row-select').forEach(cb => cb.checked = false);

  selectedFilterMarkerIds.add(id);
  if (trEl) {
    trEl.classList.add('row-selected');
    const cb = trEl.querySelector('input.row-select');
    if (cb) cb.checked = true;
  }

  updateFilterShowButtonState();
}

function clearAllFilterSelections() {
  selectedFilterMarkerIds.clear();
  document.querySelectorAll('#sfList tr.row-selected').forEach(tr => tr.classList.remove('row-selected'));
  document.querySelectorAll('#sfList input.row-select').forEach(cb => cb.checked = false);
  updateFilterShowButtonState();
}


function formatGps(m) {
  if (!m) return "";
  const lat = Number(m.lat);
  const lng = Number(m.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return lat.toFixed(6) + ", " + lng.toFixed(6);
}

function renderFilterList(list) {
const tb = document.getElementById("sfList");
  tb.innerHTML = "";
  _lastFilterList = Array.isArray(list) ? list.slice() : [];
  list.forEach(m => {
    const tr = document.createElement("tr");
    tr.dataset.markerId = String(m.id);
	tr.dataset.markerUuid = String(m.uuid || "");
	    if (selectedFilterMarkerIds.has(m.id)) {
	      tr.classList.add("row-selected");
	    }
	    // Soft delete: törölt sorok vizuális jelölése
	    if (m.deletedAt || m.deleted) {
	      tr.classList.add("row-deleted");
	    }
    tr.innerHTML = `
      <td style="text-align:center;"><input class="row-select" type="checkbox" ${selectedFilterMarkerIds.has(m.id) ? 'checked' : ''}></td>
      <td class="sf-photo-cell">
        <button class="sf-photo-btn" type="button" title="Fotók" aria-label="Fotók" disabled>
          <svg class="ico" aria-hidden="true"><use href="#i-camera"></use></svg>
        </button>
      </td>
      <td>${escapeHtml(m.address)}</td>
      <td>${escapeHtml(m.typeLabel)}</td>
      <td>${escapeHtml(m.statusLabel)}</td>
      <td>${escapeHtml(m.notes || "")}</td>
      <td class="sf-gps-cell">${escapeHtml(formatGps(m))}</td>
      <td class="sf-id-cell">
        <span class="sf-id-text">${idText(m.id)}</span>
        <button class="sf-edit-overlay-btn" type="button" title="Objektum módosítása" aria-label="Objektum módosítása">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-edit"></use></svg>
        </button>
      </td>
`;

	    // Checkbox: többszörös kijelölés (nem törli a többit)
	    const cb = tr.querySelector('input.row-select');
	    if (cb) {
	      cb.addEventListener('click', (ev) => ev.stopPropagation());
	      cb.addEventListener('change', (ev) => {
	        ev.stopPropagation();
	        const markerId = tr.dataset.markerId;
	        if (!markerId) return;
	        toggleFilterRowSelection(markerId, tr);
	      });
	
	    // v5.29: overlay "Objektum módosítása" ikon az ID mezőn (csak 1 kijelölésnél fog látszani)
	    const overlayEditBtn = tr.querySelector('.sf-edit-overlay-btn');
	    if (overlayEditBtn) {
	      overlayEditBtn.addEventListener('click', async (ev) => {
	        ev.stopPropagation();
	        if (tr.classList.contains('row-deleted')) return;
	        const id = Number(tr.dataset.markerId);
	        if (!Number.isFinite(id)) return;
	        try {
	          const m = await DB.getMarkerById(id);
	          if (!m || m.deletedAt) {
	            showHint("A törölt marker nem módosítható.");
	            return;
	          }
	          closeFilterModal();
	          openEditModal(m);
	        } catch (err) {
	          console.error("filter edit open failed", err);
	          alert("Nem sikerült betölteni a marker adatait.");
	        }
	      });
	    

        // v5.30: fotó ikon oszlop (a bal oldali "Fotók" gomb kiváltása)
        const photoBtn = tr.querySelector('.sf-photo-btn');
        const uuid = String(tr.dataset.markerUuid || "");
        if (photoBtn) {
          // kattintás: galéria megnyitása az adott markerhez (kijelölést nem módosít)
          photoBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const id = Number(tr.dataset.markerId);
            if (!Number.isFinite(id)) return;
            try {
              const marker = await DB.getMarkerById(id);
              if (!marker) return;
              // ugyanazt a galéria megnyitót használjuk, mint eddig a "Fotók" gomb
              openPhotoGalleryForMarker(marker);
            } catch (e) {
              console.error("openPhotoGalleryForMarker failed", e);
              alert("Nem sikerült megnyitni a fotókat.");
            }
          });

          // engedélyezés/halványítás fotószám alapján
          getPhotoCountCached(uuid).then((cnt) => {
            const has = Number(cnt) > 0;
            photoBtn.disabled = !has;
          });
        }
}

    }

	    // 1 kattintás: kijelölés (több sor is lehet)
	    tr.addEventListener("click", (ev) => {
	      ev.stopPropagation();
	      const markerId = tr.dataset.markerId;
	      if (!markerId) return;
	      selectOnlyFilterRow(markerId, tr);
	    });

	    // dupla kattintás: ugrás a markerre + ablak bezárása
	    tr.addEventListener("dblclick", (ev) => {
	      ev.stopPropagation();
	      // Törölt elemre ne ugorjunk / ne zárjuk be a szűrés ablakot
	      const markerId = tr.dataset.markerId;
	      if (markerId) {
	        // biztos kijelölés a duplakattnál is (egykijelölés)
	      selectOnlyFilterRow(markerId, tr);
	      }
	      // ha törölt (soft delete), akkor ne zárjuk be a modalt
	      if (tr.classList.contains("row-deleted")) return;
	      const id = Number(tr.dataset.markerId);
	      const mk = markerLayers.get(id);
	      if (mk) {
	        const ll = mk.getLatLng();
	        map.setView(ll, Math.max(map.getZoom(), 18));
	        mk.openPopup();
	        closeFilterModal();
	      }
	    });
    tb.appendChild(tr);
  });
	  updateFilterShowButtonState();
}


function updateHeaderFilterIndicators() {
  const aVal = (document.getElementById("sfAddress")?.value || "").trim();
  const tVal = (document.getElementById("sfType")?.value || "").trim();
  const sVal = (document.getElementById("sfStatus")?.value || "").trim();
  const nVal = (document.getElementById("sfNotes")?.value || "").trim();

  const addrTh = document.getElementById("sfAddressTh");
  const typeTh = document.getElementById("sfTypeTh");
  const statusTh = document.getElementById("sfStatusTh");
  const notesTh = document.getElementById("sfNotesTh");

  if (addrTh) addrTh.classList.toggle("active", aVal.length > 0);
  if (typeTh) typeTh.classList.toggle("active", tVal.length > 0);
  if (statusTh) statusTh.classList.toggle("active", sVal.length > 0);
  if (notesTh) notesTh.classList.toggle("active", nVal.length > 0);
}

// ---------------------------
// Excel export (Filter table)
// ---------------------------
function csvEscape(val, delim) {
  const s = (val === null || val === undefined) ? "" : String(val);
  const needs = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delim);
  if (!needs) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildFilterCsv(rows) {
  const delim = ';'; // HU locale friendly (Excel)
  const header = ["Cím", "Típus", "Állapot", "Megjegyzés", "GPS", "ID", "Törölt"];
  const lines = [];
  lines.push(header.map(h => csvEscape(h, delim)).join(delim));

  (rows || []).forEach((m) => {
    const deleted = (m && (m.deletedAt || m.deleted)) ? "IGEN" : "";
    const gps = formatGps(m);
    const line = [
      m?.address || "",
      m?.typeLabel || "",
      m?.statusLabel || "",
      m?.notes || "",
      gps || "",
      idText(m?.id),
      deleted
    ];
    lines.push(line.map(v => csvEscape(v, delim)).join(delim));
  });

  // UTF-8 BOM, so Excel reads accents correctly
  return '\ufeff' + lines.join('\r\n');
}

async function exportFilterTableToExcel() {
  try {
    const rows = Array.isArray(_lastFilterList) ? _lastFilterList : [];
    const csv = buildFilterCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

    const fn = `CityMap_export_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;

    // Prefer Save As dialog if available (Chromium)
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fn,
        types: [{ description: "CSV (Excel)", accept: { "text/csv": [".csv"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    // Fallback: normal download (browser will ask location depending on settings)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    // User cancelled the save dialog -> do nothing
    if (err && (err.name === "AbortError" || String(err.message || "").toLowerCase().includes("abort"))) {
      return;
    }
    console.error("Excel export failed", err);
    alert("Nem sikerült exportálni a táblázatot.");
  }
}

function applyFilter() {
  const a = (document.getElementById("sfAddress")?.value || "").trim().toLowerCase();
  const n = (document.getElementById("sfNotes")?.value || "").trim().toLowerCase();

  const typeSel = document.getElementById("sfType");
  const statusSel = document.getElementById("sfStatus");

  const tId = Number((typeSel?.value || "").trim());
  const sId = Number((statusSel?.value || "").trim());
  const hasType = Number.isFinite(tId) && tId > 0;
  const hasStatus = Number.isFinite(sId) && sId > 0;
  const tInternal = (hasType && typeSel && typeSel.selectedIndex >= 0)
    ? (typeSel.options[typeSel.selectedIndex]?.dataset?.internalId || "")
    : "";
  const sInternal = (hasStatus && statusSel && statusSel.selectedIndex >= 0)
    ? (statusSel.options[statusSel.selectedIndex]?.dataset?.internalId || "")
    : "";

  const res = (_allMarkersCache || []).filter((m) => {
    const addr = String(m?.address || "").toLowerCase();

    const typeOk = !hasType || (Number(m?.typeId) === tId) || (!!tInternal && (String(m?.typeInternalId || m?.type || "") === String(tInternal)));
    const statusOk = !hasStatus || (Number(m?.statusId) === sId) || (!!sInternal && (String(m?.statusInternalId || m?.status || "") === String(sInternal)));

    const addrOk = !a || addr.includes(a);
    const notes = String(m?.notes || "").toLowerCase();
    const notesOk = !n || notes.includes(n);

    return addrOk && typeOk && statusOk && notesOk;
  });

  updateHeaderFilterIndicators();
  renderFilterList(res);
}

// ---------------------------
// Settings modal (v5.20.0)
// ---------------------------

function openSettingsModal() {
  const m = document.getElementById("settingsModal");
  if (!m) return;
  m.style.display = "flex";
  setSettingsPage("type");
}

function closeSettingsModal() {
  const m = document.getElementById("settingsModal");
  if (!m) return;
  m.style.display = "none";
}

function setSettingsPage(page) {
  const titleEl = document.getElementById("settingsTitle");
  const hintEl = document.getElementById("settingsHint");
  const contentEl = document.getElementById("settingsContent");
  const navItems = Array.from(document.querySelectorAll("#settingsModal .settings-nav-item"));

  navItems.forEach((b) => b.classList.toggle("active", b.dataset.page === page));

  if (!titleEl || !hintEl || !contentEl) return;

  if (page === "status") {
    titleEl.textContent = "Objektum állapota";
    hintEl.textContent = "Állapotok kezelése (helyi adatbázis / IndexedDB).";
    renderSettingsObjectStatusesPage();
  } else if (page === "users") {
    titleEl.textContent = "Felhasználó kezelés";
    hintEl.textContent = "Itt később a felhasználók kezelése (jogosultságok, admin, felvivő stb.) lesz elérhető.";
    renderSettingsPlaceholderPage();
  } else {
    titleEl.textContent = "Objektum típusa";
    hintEl.textContent = "Típusok kezelése (helyi adatbázis / IndexedDB).";
    renderSettingsObjectTypesPage();
  }
}

// ---------------------------
// Settings: Objektum típusa (v5.21)
// ---------------------------

// ---------------------------
// Excel-szerű színválasztó (v5.22.1)
// - 30 szín: 10 oszlop x 3 árnyalat
// - "További színek...": natív color picker
// ---------------------------


// ---------------------------
// "Excel-szerű" (saját) szín dialógus – natív picker helyett
// Cél: Edge laptopon is működjön megbízhatóan.
// ---------------------------


function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function rgbToHex(r, g, b) {
  const to2 = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  };
}

// ---------------------------
// v5.23.2: "Színek szerkesztése" – Excel/Windows jellegű, egyetlen ablak
// - nincs több szintű felugró
// - Edge laptopon is megbízható (nem natív picker)
// - Alapszínek + Egyéni színek (mentve localStorage-ba)
// ---------------------------

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s: s * 100, v: v * 100 };
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  };
}

const CUSTOM_COLORS_KEY = "citymap_custom_colors_v1";
function loadCustomColors() {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      const out = arr.map((x) => (typeof x === "string" ? x : "")).slice(0, 24);
      while (out.length < 24) out.push("");
      return out;
    }
  } catch {}
  return Array(24).fill("");
}
function saveCustomColors(arr) {
  try { localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(arr)); } catch {}
}

// Alapszínek: közel Excel/Win paletta hangulat (48 db)
const BASE_COLORS = [
  "#F87171","#EF4444","#7F1D1D","#FCA5A5","#F59E0B","#F97316","#9A3412","#FDBA74","#FDE047","#FACC15","#A16207","#FEF08A",
  "#86EFAC","#22C55E","#166534","#BBF7D0","#34D399","#14B8A6","#0F766E","#99F6E4","#22D3EE","#06B6D4","#0E7490","#A5F3FC",
  "#60A5FA","#3B82F6","#1D4ED8","#BFDBFE","#818CF8","#6366F1","#4338CA","#C7D2FE","#A78BFA","#8B5CF6","#6D28D9","#DDD6FE",
  "#F472B6","#EC4899","#BE185D","#FBCFE8","#FB7185","#E11D48","#9F1239","#FECDD3","#111827","#6B7280","#D1D5DB","#FFFFFF"
];

let _colorsEditorOverlay = null;

function openColorsEditorDialog(startHex, onOk) {
  const initial = /^#([0-9a-fA-F]{6})$/.test(String(startHex || "")) ? String(startHex).toUpperCase() : "#3B82F6";
  const rgb0 = hexToRgb(initial);
  const hsv0 = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);

  let hue = hsv0.h;  // 0..360
  let sat = hsv0.s;  // 0..100
  let val = hsv0.v;  // 0..100
  let currentHex = initial;

  // overlay újraépítése
  if (_colorsEditorOverlay) _colorsEditorOverlay.remove();
  const overlay = document.createElement("div");
  overlay.className = "colors-editor-overlay";
  overlay.innerHTML = `
    <div class="colors-editor colors-editor-compact" role="dialog" aria-modal="true">
      <div class="colors-editor-titlebar">
        <div class="colors-editor-title">Színek szerkesztése</div>
        <button type="button" class="colors-editor-x" aria-label="Bezár">×</button>
      </div>

      <div class="colors-editor-main">
        <div class="ce-left">
          <div class="ce-picker">
            <div class="ce-sv" aria-label="Szín kiválasztása" tabindex="0">
              <div class="ce-sv-white"></div>
              <div class="ce-sv-black"></div>
              <div class="ce-sv-cursor" aria-hidden="true"></div>
            </div>
            <div class="ce-bars">
              <div class="ce-bar ce-hue" aria-label="Árnyalat" tabindex="0">
                <div class="ce-bar-cursor" data-bar="hue"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="ce-right">
          <label class="small" style="color:#6b7280; font-weight:800;">Kód (HEX)</label>
          <input class="ce-hex" type="text" value="${initial}" />

          <div class="ce-preview" style="margin-top:14px;">
            <div class="ce-preview-box">
              <div class="ce-preview-swatch" data-kind="new"></div>
              <div>
                <div class="ce-preview-label">Új</div>
                <div class="ce-preview-hex" data-kind="new"></div>
              </div>
            </div>
            <div class="ce-preview-box">
              <div class="ce-preview-swatch" data-kind="old"></div>
              <div>
                <div class="ce-preview-label">Jelenlegi</div>
                <div class="ce-preview-hex" data-kind="old"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="colors-editor-bottom">
        <div class="ce-section">
          <div class="ce-section-title">Alapszínek</div>
          <div class="ce-base"></div>
        </div>
      </div>

      <div class="colors-editor-actions">
        <button type="button" class="btn btn-primary ce-ok">OK</button>
        <button type="button" class="btn ce-cancel">Mégse</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _colorsEditorOverlay = overlay;

  const btnX = overlay.querySelector(".colors-editor-x");
  const btnOk = overlay.querySelector(".ce-ok");
  const btnCancel = overlay.querySelector(".ce-cancel");
  const sv = overlay.querySelector(".ce-sv");
  const svCursor = overlay.querySelector(".ce-sv-cursor");
  const hueBar = overlay.querySelector(".ce-hue");
  const hueCursor = overlay.querySelector(".ce-bar-cursor[data-bar='hue']");
  const hexInput = overlay.querySelector(".ce-hex");
  const prevNewSw = overlay.querySelector(".ce-preview-swatch[data-kind='new']");
  const prevOldSw = overlay.querySelector(".ce-preview-swatch[data-kind='old']");
  const prevNewHex = overlay.querySelector(".ce-preview-hex[data-kind='new']");
  const prevOldHex = overlay.querySelector(".ce-preview-hex[data-kind='old']");
  const baseWrap = overlay.querySelector(".ce-base");

  function setFromHsv() {
    const rgb = hsvToRgb(hue, sat, val);
    currentHex = rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase();
    hexInput.value = currentHex;
    updateUi();
  }

  function setFromHex(hex) {
    const v = String(hex || "").trim();
    if (!/^#([0-9a-fA-F]{6})$/.test(v)) return;
    const rgb = hexToRgb(v);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    hue = hsv.h; sat = hsv.s; val = hsv.v;
    currentHex = v.toUpperCase();
    hexInput.value = currentHex;
    updateUi();
  }

  function updateUi() {
    // SV háttér: hue alapján
    const hueRgb = hsvToRgb(hue, 100, 100);
    const hueHex = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
    sv.style.background = hueHex;

    // SV cursor
    const svRect = sv.getBoundingClientRect();
    const x = clamp((sat / 100) * svRect.width, 0, svRect.width);
    const y = clamp(((100 - val) / 100) * svRect.height, 0, svRect.height);
    svCursor.style.left = `${x}px`;
    svCursor.style.top = `${y}px`;

    // hue cursor
    const hb = hueBar.getBoundingClientRect();
    hueCursor.style.top = `${clamp((hue / 360) * hb.height, 0, hb.height)}px`;

    // preview
    prevNewSw.style.background = currentHex;
    prevNewHex.textContent = currentHex;
  }

  function initPreview() {
    prevOldSw.style.background = initial;
    prevOldHex.textContent = initial;
    prevNewSw.style.background = currentHex;
    prevNewHex.textContent = currentHex;
  }

  function renderBaseColors() {
    baseWrap.innerHTML = "";
    BASE_COLORS.forEach((hex) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ce-swatch";
      b.style.background = hex;
      b.title = hex;
      b.addEventListener("click", () => setFromHex(hex));
      baseWrap.appendChild(b);
    });
  }

  function close() {
    overlay.remove();
    if (_colorsEditorOverlay === overlay) _colorsEditorOverlay = null;
  }

  function commit() {
    onOk(currentHex);
    close();
  }

  // Interakciók: SV
  function handleSv(e) {
    const r = sv.getBoundingClientRect();
    const cx = clamp(e.clientX - r.left, 0, r.width);
    const cy = clamp(e.clientY - r.top, 0, r.height);
    sat = (cx / r.width) * 100;
    val = 100 - (cy / r.height) * 100;
    setFromHsv();
  }
  sv.addEventListener("pointerdown", (e) => {
    sv.setPointerCapture(e.pointerId);
    handleSv(e);
    const move = (ev) => handleSv(ev);
    const up = (ev) => {
      try { sv.releasePointerCapture(ev.pointerId); } catch {}
      sv.removeEventListener("pointermove", move);
      sv.removeEventListener("pointerup", up);
      sv.removeEventListener("pointercancel", up);
    };
    sv.addEventListener("pointermove", move);
    sv.addEventListener("pointerup", up);
    sv.addEventListener("pointercancel", up);
  });

  // Hue bar
  function handleHue(e) {
    const r = hueBar.getBoundingClientRect();
    const cy = clamp(e.clientY - r.top, 0, r.height);
    hue = (cy / r.height) * 360;
    setFromHsv();
  }
  hueBar.addEventListener("pointerdown", (e) => {
    hueBar.setPointerCapture(e.pointerId);
    handleHue(e);
    const move = (ev) => handleHue(ev);
    const up = (ev) => {
      try { hueBar.releasePointerCapture(ev.pointerId); } catch {}
      hueBar.removeEventListener("pointermove", move);
      hueBar.removeEventListener("pointerup", up);
      hueBar.removeEventListener("pointercancel", up);
    };
    hueBar.addEventListener("pointermove", move);
    hueBar.addEventListener("pointerup", up);
    hueBar.addEventListener("pointercancel", up);
  });

  // HEX input
  hexInput.addEventListener("change", () => setFromHex(hexInput.value));

  // Gombok
  btnX.addEventListener("click", close);
  btnCancel.addEventListener("click", close);
  btnOk.addEventListener("click", commit);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const esc = (e) => {
    if (!_colorsEditorOverlay) return;
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  };
  document.addEventListener("keydown", esc);

  // init
  renderBaseColors();
  initPreview();
  updateUi();

  setTimeout(() => hexInput.focus(), 0);
}



let _objectTypesCache = [];
let _objectTypesUiWired = false;

function renderSettingsPlaceholderPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;
  container.innerHTML = "";
}

function renderSettingsObjectTypesPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;

  container.innerHTML = `
    <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div class="small" style="color:#666;">Oszlopok: Azonosító, Belső azonosító, Típus, Leírás, Szín</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-save" id="btnAddObjectType" type="button">Új sor</button>
      </div>
    </div>

    <div class="settings-table-wrap" style="margin-top:10px;">
      <table class="sf-table" id="objectTypesTable" style="min-width:900px;">
        <thead>
          <tr>
            <th style="width:120px;">Azonosító</th>
            <th style="width:160px;">Belső azonosító</th>
            <th style="width:220px;">Típus *</th>
            <th style="width:260px;">Leírás</th>
            <th style="width:140px;">Szín</th>
          </tr>
        </thead>
        <tbody id="objectTypesTbody"></tbody>
      </table>
    </div>
  `;

  if (!_objectTypesUiWired) {
    _objectTypesUiWired = true;


    // delegált eseménykezelés (minden input/select)
    container.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      markRowDirty(tr);
    });
    container.addEventListener("change", async (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      // pl. rejtett szín input csak change eseményt kap
      markRowDirty(tr);
      await saveObjectTypeRow(tr);
    });
    container.addEventListener("blur", async (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      await saveObjectTypeRow(tr);
    }, true);
    container.addEventListener("click", async (e) => {
      // Új sor (delegált, mert a jobb oldal újrarenderelődik lapváltáskor)
      const addBtn = e.target.closest("#btnAddObjectType");
      if (addBtn) {
        await DB.init();
        const newRec = {
          internalId: "",
          type: "",
          description: "",
          color: "#22c55e",
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        const id = await DB.addObjectType(newRec);
        showHint("Új sor létrehozva.");
        await loadAndRenderObjectTypes({ focusId: id });
        return;
      }

      // Sor törlése
      const btn = e.target.closest("button[data-action='delete-ot']");
      if (btn) {
        const tr = btn.closest("tr[data-ot-id]");
        if (!tr) return;
        const id = Number(tr.dataset.otId);
        if (!Number.isFinite(id)) return;
        if (!confirm("Biztosan törlöd ezt a típust?")) return;
        await DB.deleteObjectType(id);
        showHint("Típus törölve.");
        await loadAndRenderObjectTypes();
        return;
      }

      // Szín gomb (v5.23.2): közvetlen, egyetlen "Színek szerkesztése" ablak
      const colorBtn = e.target.closest("button.color-btn");
      if (colorBtn) {
        const tr = colorBtn.closest("tr[data-ot-id]");
        if (!tr) return;
        const input = tr.querySelector("input[data-field='color']");
        if (!input) return;
        openColorsEditorDialog(String(input.value || "#22c55e"), (hex) => {
          input.value = hex;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          markRowDirty(tr);
        });
        return;
      }
    });
  }

  loadAndRenderObjectTypes();
}

function markRowDirty(tr) {
  tr.dataset.dirty = "1";
}

function readObjectTypeRow(tr) {
  const id = Number(tr.dataset.otId);
  const internalId = (tr.querySelector("input[data-field='internalId']")?.value || "").trim();
  const type = (tr.querySelector("input[data-field='type']")?.value || "").trim();
  const description = (tr.querySelector("input[data-field='description']")?.value || "").trim();
  const color = tr.querySelector("input[data-field='color']")?.value || "#22c55e";
  return { id, internalId, type, description, color };
}

function validateObjectType(rec) {
  if (rec.internalId && rec.internalId.length > 10) return "A 'Belső azonosító' max 10 karakter.";
  if (!rec.type) return "A 'Típus' mező kötelező.";
  if (rec.type.length > 30) return "A 'Típus' max 30 karakter.";
  if (rec.description && rec.description.length > 50) return "A 'Leírás' max 50 karakter.";
  return null;
}

async function saveObjectTypeRow(tr) {
  const isDirty = tr.dataset.dirty === "1";
  if (!isDirty) return;

  const rec = readObjectTypeRow(tr);
  const err = validateObjectType(rec);
  if (err) {
    showHint(err);
    return;
  }

  await DB.init();
  await DB.updateObjectType(rec.id, {
    internalId: rec.internalId,
    type: rec.type,
    description: rec.description,
    color: rec.color,
    updatedAt: Date.now()
  });
  tr.dataset.dirty = "0";
  // v5.50: színváltozás azonnal hasson a markerekre
  try { _objectTypesCache = await DB.getAllObjectTypes(); setTypeMetaCache(_objectTypesCache); } catch (_) {}
  refreshAllMarkerIcons();
}

async function loadAndRenderObjectTypes(opts = {}) {
  await DB.init();
  _objectTypesCache = await DB.getAllObjectTypes();
  try { setTypeMetaCache(_objectTypesCache); } catch (_) {}
  refreshAllMarkerIcons();
  renderObjectTypesTable();
  if (opts.focusId) {
    const row = document.querySelector(`#objectTypesTbody tr[data-ot-id='${opts.focusId}'] input[data-field='type']`);
    if (row) row.focus();
  }
}

function renderObjectTypesTable() {
  const tb = document.getElementById("objectTypesTbody");
  if (!tb) return;
  tb.innerHTML = "";

  _objectTypesCache.forEach((rec) => {
    const tr = document.createElement("tr");
    tr.dataset.otId = rec.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${escapeHtml(rec.id)}</span>
          <button class="btn btn-ghost" type="button" data-action="delete-ot" style="padding:4px 8px;">🗑</button>
        </div>
      </td>
      <td><input data-field="internalId" type="text" maxlength="10" value="${escapeHtml(rec.internalId || "")}" style="width:100%;"/></td>
      <td><input data-field="type" type="text" maxlength="30" value="${escapeHtml(rec.type || "")}" style="width:100%;" placeholder="pl. Pad"/></td>
      <td><input data-field="description" type="text" maxlength="50" value="${escapeHtml(rec.description || "")}" style="width:100%;"/></td>
      <td>
        <div class="color-cell">
          <button type="button" class="color-btn" title="Szín kiválasztása">
            <span class="color-dot" style="background:${escapeHtml(String(rec.color || "#22c55e"))}"></span>
            <span class="color-hex">${escapeHtml(String(rec.color || "#22c55e"))}</span>
          </button>
          <input data-field="color" type="hidden" value="${escapeHtml(String(rec.color || "#22c55e"))}" />
        </div>
      </td>
    `;
    tb.appendChild(tr);

    // Szín UI frissítése (rejtett input -> gombon a dot + HEX)
    const colorInput = tr.querySelector("input[data-field='color']");
    const dot = tr.querySelector(".color-dot");
    const hexLabel = tr.querySelector(".color-hex");
    if (colorInput && dot && hexLabel) {
      const apply = () => {
        const v = String(colorInput.value || "#22c55e").trim();
        dot.style.background = v;
        hexLabel.textContent = v;
      };
      apply();
      colorInput.addEventListener("change", apply);
    }
  });
}



// ---------------------------
// Settings: Objektum állapota (v5.47)
// - mezők: Azonosító (auto), Belső azonosító, Állapot*, Leírás
// - felvitel/törlés logika: mint a típusoknál
// ---------------------------

let _objectStatusesCache = [];
let _objectStatusesUiWired = false;

function renderSettingsObjectStatusesPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;

  container.innerHTML = `
    <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div class="small" style="color:#666;">Oszlopok: Azonosító, Belső azonosító, Állapot, Leírás</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-save" id="btnAddObjectStatus" type="button">Új sor</button>
      </div>
    </div>

    <div class="settings-table-wrap" style="margin-top:10px;">
      <table class="sf-table" id="objectStatusesTable" style="min-width:760px;">
        <thead>
          <tr>
            <th style="width:120px;">Azonosító</th>
            <th style="width:160px;">Belső azonosító</th>
            <th style="width:240px;">Állapot *</th>
            <th style="width:300px;">Leírás</th>
          </tr>
        </thead>
        <tbody id="objectStatusesTbody"></tbody>
      </table>
    </div>
  `;

  if (!_objectStatusesUiWired) {
    _objectStatusesUiWired = true;

    // delegált input
    container.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-os-id]");
      if (!tr) return;
      markRowDirty(tr);
    });

    // mentés blur-re
    container.addEventListener(
      "blur",
      async (e) => {
        const tr = e.target.closest("tr[data-os-id]");
        if (!tr) return;
        await saveObjectStatusRow(tr);
      },
      true
    );

    container.addEventListener("click", async (e) => {
      // Új sor
      const addBtn = e.target.closest("#btnAddObjectStatus");
      if (addBtn) {
        await DB.init();
        const newRec = {
          internalId: "",
          status: "",
          description: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const id = await DB.addObjectStatus(newRec);
        showHint("Új sor létrehozva.");
        await loadAndRenderObjectStatuses({ focusId: id });
        return;
      }

      // Törlés
      const btn = e.target.closest("button[data-action='delete-os']");
      if (btn) {
        const tr = btn.closest("tr[data-os-id]");
        if (!tr) return;
        const id = Number(tr.dataset.osId);
        if (!Number.isFinite(id)) return;
        if (!confirm("Biztosan törlöd ezt az állapotot?")) return;
        await DB.deleteObjectStatus(id);
        showHint("Állapot törölve.");
        await loadAndRenderObjectStatuses();
        return;
      }
    });
  }

  loadAndRenderObjectStatuses();
}

function readObjectStatusRow(tr) {
  const id = Number(tr.dataset.osId);
  const internalId = (tr.querySelector("input[data-field='internalId']")?.value || "").trim();
  const status = (tr.querySelector("input[data-field='status']")?.value || "").trim();
  const description = (tr.querySelector("input[data-field='description']")?.value || "").trim();
  return { id, internalId, status, description };
}

function validateObjectStatus(rec) {
  if (rec.internalId && rec.internalId.length > 10) return "A 'Belső azonosító' max 10 karakter.";
  if (!rec.status) return "Az 'Állapot' mező kötelező.";
  if (rec.status.length > 30) return "Az 'Állapot' max 30 karakter.";
  if (rec.description && rec.description.length > 50) return "A 'Leírás' max 50 karakter.";
  return null;
}

async function saveObjectStatusRow(tr) {
  const isDirty = tr.dataset.dirty === "1";
  if (!isDirty) return;

  const rec = readObjectStatusRow(tr);
  const err = validateObjectStatus(rec);
  if (err) {
    showHint(err);
    return;
  }

  await DB.init();
  await DB.updateObjectStatus(rec.id, {
    internalId: rec.internalId,
    status: rec.status,
    description: rec.description,
    updatedAt: Date.now(),
  });
  tr.dataset.dirty = "0";
  // v5.50: színváltozás azonnal hasson a markerekre
  try { _objectTypesCache = await DB.getAllObjectTypes(); setTypeMetaCache(_objectTypesCache); } catch (_) {}
  refreshAllMarkerIcons();
}

async function loadAndRenderObjectStatuses(opts = {}) {
  await DB.init();
  _objectStatusesCache = await DB.getAllObjectStatuses();
  renderObjectStatusesTable();
  if (opts.focusId) {
    const el = document.querySelector(
      `#objectStatusesTbody tr[data-os-id='${opts.focusId}'] input[data-field='status']`
    );
    if (el) el.focus();
  }
}

function renderObjectStatusesTable() {
  const tb = document.getElementById("objectStatusesTbody");
  if (!tb) return;
  tb.innerHTML = "";

  _objectStatusesCache.forEach((rec) => {
    const tr = document.createElement("tr");
    tr.dataset.osId = rec.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${escapeHtml(rec.id)}</span>
          <button class="btn btn-ghost" type="button" data-action="delete-os" style="padding:4px 8px;">🗑</button>
        </div>
      </td>
      <td><input data-field="internalId" type="text" maxlength="10" value="${escapeHtml(rec.internalId || "")}" style="width:100%;"/></td>
      <td><input data-field="status" type="text" maxlength="30" value="${escapeHtml(rec.status || "")}" style="width:100%;" placeholder="pl. Új"/></td>
      <td><input data-field="description" type="text" maxlength="50" value="${escapeHtml(rec.description || "")}" style="width:100%;"/></td>
    `;
    tb.appendChild(tr);
  });
}
async function refreshFilterData() {
  _allMarkersCache = filterShowDeleted
    ? await DB.getAllMarkers()
    : await DB.getAllMarkersActive();
  await fillFilterCombos();
  applyFilter();
}

