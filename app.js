const APP_VERSION = "5.21.2";

// Szűrés táblázat kijelölés (több sor is kijelölhető)
let selectedFilterMarkerIds = new Set();
let filterShowDeleted = false; // Szűrés listában töröltek megjelenítése

// v5.17.1: szűrés ablak "Fotók" gomb engedélyezése aszinkron fotószám ellenőrzéssel
let filterPhotosBtnCheckToken = 0;

// v5.15: térképi megjelenítés szűrése (csak kijelöltek / táblázat tartalma)
let activeMapFilterIds = null; // null = nincs térképi szűrés, minden aktív marker látszik

let map;
let addMode = false;
let pendingLatLng = null;

// Objektum módosítás (markerModal újrafelhasználása)
let markerModalMode = "add"; // "add" | "edit"
let editingMarkerId = null;
let editingMarkerUuid = null;

// Térképi szűrés UI ("Összes megjelenítése" gomb)
function updateShowAllButtonVisibility() {
  const btn = document.getElementById("btnShowAll");
  if (!btn) return;

  // Akkor tekintjük szűrtnek a térképet, ha van aktív filter SET,
  // és a jelenlegi aktív marker-készletből NEM mindegyik szerepel a filterben.
  let filtered = false;
  if (activeMapFilterIds instanceof Set) {
    for (const id of markerLayers.keys()) {
      if (!activeMapFilterIds.has(Number(id))) {
        filtered = true;
        break;
      }
    }
    // Ha a filter üres, az is "szűrt" (0 marker látszik), ha van egyáltalán marker.
    if (!filtered && markerLayers.size > 0 && activeMapFilterIds.size === 0) filtered = true;
  }
  btn.style.display = filtered ? "inline-block" : "none";
}

function clearMapMarkerVisibilityFilter() {
  activeMapFilterIds = null;

  for (const [, mk] of markerLayers.entries()) {
    if (map && mk && !map.hasLayer(mk)) mk.addTo(map);
  }
  updateShowAllButtonVisibility();
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


const TYPE_ICON = {
  PAD: "green",
  ZEBRA: "yellow",
  TABLA: "blue",
  DEFAULT: "grey"
};

function iconForType(type) {

  const c = TYPE_ICON[type] || TYPE_ICON.DEFAULT;
  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${c}.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
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

function showHint(text, ms = 2500) {
  const el = document.getElementById("hint");
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => (el.style.display = "none"), ms);
}

function openModal(latlng) {
  markerModalMode = "add";
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

  setMarkerModalTitle("add");
  setMarkerModalControlsDisabled({ addressLocked: false });

  updateAttachPhotoLabel();

  // reverse geocode
  fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latlng.lat}&lon=${latlng.lng}`)
    .then(r => r.json())
    .then(j => {
      const a = j.address || {};
      if (a.city || a.town || a.village)
        document.getElementById("fCity").value = a.city || a.town || a.village || "";
      if (a.road)
        document.getElementById("fStreet").value =
          a.road + (a.road_type ? " " + a.road_type : "");
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
  editingMarkerId = null;
  editingMarkerUuid = null;
  currentDraftUuid = null;
}

let myLocationMarker = null;

async function centerToMyLocation() {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const ll = [lat, lng];

        map.setView(ll, 20);

        if (myLocationMarker) {
          map.removeLayer(myLocationMarker);
        }

        let addressText = "Saját hely";
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
          );
          const j = await r.json();
          if (j.display_name) addressText = j.display_name;
        } catch (e) {}

        myLocationMarker = L.marker(ll, { icon: userIconForZoom(map.getZoom()) }).addTo(map);

        myLocationMarker.bindPopup(
          `<b>Saját hely</b><br>${addressText}`
        );

        resolve(true);
      },
      () => resolve(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function idText(id) {
  return "M-" + String(id).padStart(6, "0");
}

function popupHtml(m) {
  return `
  <div style="min-width:220px">
    <div><b>Azonosítószám:</b> ${idText(m.id)}</div>
    <div><b>Cím:</b> ${escapeHtml(m.address)}</div>
    <div><b>Típus:</b> ${escapeHtml(m.typeLabel)}</div>
    <div><b>Állapot:</b> ${escapeHtml(m.statusLabel)}</div>
    <div><b>Megjegyzés:</b> ${m.notes ? escapeHtml(m.notes) : "-"}</div>

    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btnPhotos" data-uuid="${m.uuid}" data-title="${idText(m.id)}">Fotók (<span id="pc-${m.uuid}">…</span>)</button>
      ${m.deletedAt ? '<span style="color:#b91c1c;font-weight:700;">TÖRÖLT</span>' : ''}
    </div>

    <div style="margin-top:10px;display:flex;justify-content:flex-end">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <button data-edit="${m.id}">Objektum módosítása</button>
        <button data-del="${m.id}">Törlés</button>
      </div>
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

function addMarkerToMap(m) {
  const mk = L.marker([m.lat, m.lng], { draggable: true, icon: iconForType(m.type) }).addTo(map);
mk.__data = m;
  mk.bindPopup(popupHtml(m));
  wirePopupDelete(mk, m.id);
  wirePopupEdit(mk, m.id);
  wirePopupPhotos(mk, m);

  mk.on("dragend", async (e) => {
    const p = e.target.getLatLng();
    await DB.updateMarker(m.id, { lat: p.lat, lng: p.lng, updatedAt: Date.now() });

    const updated = await getMarker(m.id);
    if (updated) mk.setPopupContent(popupHtml(updated));
  });

  markerLayers.set(m.id, mk);

  // v5.15: ha aktív térképi szűrés van, az új marker csak akkor maradjon látható, ha benne van a szűrésben
  if (activeMapFilterIds instanceof Set) {
    if (!activeMapFilterIds.has(Number(m.id))) {
      map.removeLayer(mk);
    }
  }

  updateShowAllButtonVisibility();
}

function setMarkerModalControlsDisabled({ addressLocked }) {
  const city = document.getElementById("fCity");
  const street = document.getElementById("fStreet");
  const house = document.getElementById("fHouse");
  const type = document.getElementById("fType");
  if (city) city.disabled = !!addressLocked;
  if (street) street.disabled = !!addressLocked;
  if (house) house.disabled = !!addressLocked;
  if (type) type.disabled = !!addressLocked;
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
  const typeSel = document.getElementById("fType");
  if (typeSel) typeSel.value = marker.type || typeSel.value;

  // Állapot + megjegyzés (módosítható)
  const statusSel = document.getElementById("fStatus");
  if (statusSel) statusSel.value = marker.status || statusSel.value;
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
  const types = await DB.getLookup("markerTypes") || [];
  const statuses = await DB.getLookup("markerStatus") || [];

  const typeSel = document.getElementById("fType");
  typeSel.innerHTML = "";
  types.forEach(t => {
    const o = document.createElement("option");
    o.value = t.code;
    o.textContent = t.label;
    typeSel.appendChild(o);
  });

  const statusSel = document.getElementById("fStatus");
  statusSel.innerHTML = "";
  statuses.forEach(s => {
    const o = document.createElement("option");
    o.value = s.code;
    o.textContent = s.label;
    statusSel.appendChild(o);
  });
}

async function saveMarker() {
  // EDIT mód
  if (markerModalMode === "edit") {
    if (!editingMarkerId) return;
    const statusSel = document.getElementById("fStatus");
    const notes = document.getElementById("fNotes").value.trim();
    const status = statusSel ? statusSel.value : "";
    const statusLabel = statusSel ? (statusSel.options[statusSel.selectedIndex]?.textContent || status) : status;

    await DB.updateMarker(editingMarkerId, {
      status,
      statusLabel,
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

  const typeSel = document.getElementById("fType");
  const statusSel = document.getElementById("fStatus");

  const uuid = currentDraftUuid || genUuid();
  const marker = {
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    address,
    type: typeSel.value,
    typeLabel: typeSel.options[typeSel.selectedIndex]?.textContent || typeSel.value,
    status: statusSel.value,
    statusLabel: statusSel.options[statusSel.selectedIndex]?.textContent || statusSel.value,
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
  document.getElementById("appVersion").textContent = "v" + APP_VERSION;
  registerSW();
  checkForUpdateOnline();

  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  await DB.init();

  // DB migrations / safety cleanups (uuid backfill, invalid photo rows)
  await DB.backfillMarkerMeta();
  await DB.cleanInvalidPhotos();

  await fillLookups();

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

  document.getElementById("btnAdd").addEventListener("click", () => {
    addMode = true;
    showHint("Bökj a térképre az objektum helyéhez.");
  });

  document.getElementById("btnMyLoc").addEventListener("click", async () => {
    const ok = await centerToMyLocation();
    if (!ok) alert("Nem sikerült lekérni a pozíciót.");
  });

  document.getElementById("btnClear").addEventListener("click", async () => {
    if (!confirm("Biztosan törlöd az összes markert?")) return;
    await DB.clearMarkers();
    for (const mk of markerLayers.values()) map.removeLayer(mk);
    markerLayers.clear();
    activeMapFilterIds = null;
    updateShowAllButtonVisibility();
  });

  map.on("click", (e) => {
    addMode = false;
    openModal(e.latlng);
  });

  const ok = await centerToMyLocation();
  if (!ok) map.setView([47.4979, 19.0402], 15);

  await loadMarkers();
  
  map.on("zoomend", () => {
  const z = map.getZoom();
  markerLayers.forEach((mk, id) => {
    const data = mk.__data;
    if (!data) return;
    mk.setIcon(resizedIconForType(data.type, z));
  });
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

function resizedIconForType(type, zoom) {
  const base = iconForType(type);
  const scale = markerScaleForZoom(zoom);
  const size = [25 * scale, 41 * scale];
  const anchor = [12 * scale, 41 * scale];
  const popup = [1 * scale, -34 * scale];

  return new L.Icon({
    iconUrl: base.options.iconUrl,
    iconSize: size,
    iconAnchor: anchor,
    popupAnchor: popup,
  });
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


/* ===== Filter modal (v5.3) ===== */
let _allMarkersCache = [];

function openFilterModal() {
  document.getElementById("filterModal").style.display = "flex";
  document.getElementById("sfAddress").value = "";

  // újranyitáskor alapból töröljük a kijelöléseket (később átállítható, ha kell)
  selectedFilterMarkerIds = new Set();
  const showBtn = document.getElementById("filterShowBtn");
  const showDeletedBtn = document.getElementById("filterShowDeletedBtn");
  if (showBtn) showBtn.disabled = true;
refreshFilterData();

  const showDelBtn = document.getElementById("filterShowDeletedBtn");
  if (showDelBtn) {
    showDelBtn.textContent = filterShowDeleted ? "Töröltek elrejtése" : "Töröltek megjelenítése";
  }
}

function closeFilterModal() {
  document.getElementById("filterModal").style.display = "none";
  selectedFilterMarkerIds = new Set();
  const showBtn = document.getElementById("filterShowBtn");
  const showDeletedBtn = document.getElementById("filterShowDeletedBtn");
  if (showBtn) showBtn.disabled = true;
}

async function fillFilterCombos() {
  const types = await DB.getLookup("markerTypes") || [];
  const statuses = await DB.getLookup("markerStatus") || [];

  const t = document.getElementById("sfType");
  const s = document.getElementById("sfStatus");

  t.innerHTML = '<option value="">Összes</option>';
  types.forEach(x => {
    const o = document.createElement("option");
    o.value = x.code;
    o.textContent = x.label;
    t.appendChild(o);
  });

  s.innerHTML = '<option value="">Összes</option>';
  statuses.forEach(x => {
    const o = document.createElement("option");
    o.value = x.code;
    o.textContent = x.label;
    s.appendChild(o);
  });
}

function updateFilterShowButtonState() {
  // 5.8: a kijelöléshez kötött gombok állapotának frissítése
  const hasSelection = selectedFilterMarkerIds.size > 0;

  const tableHasRows = document.querySelectorAll('#sfList tr').length > 0;

  const showBtn = document.getElementById("filterShowBtn");
  const showDeletedBtn = document.getElementById("filterShowDeletedBtn");
  const clearBtn = document.getElementById("filterClearSelectionBtn");
  const deleteBtn = document.getElementById("filterDeleteSelectedBtn");
  const photosBtn = document.getElementById("filterPhotosBtn");
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

  // v5.17.1: Fotók gomb csak akkor aktív, ha pontosan 1 sor van kijelölve ÉS van hozzárendelt fotó
  // (törölt marker esetén is aktív lehet, mert a fotók nem törlődnek a soft delete-tel)
  if (photosBtn) {
    const selectedRows = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
    if (selectedRows.length !== 1) {
      photosBtn.disabled = true;
    } else {
      const tr = selectedRows[0];
      const uuid = tr?.dataset?.markerUuid || "";
      if (!uuid) {
        photosBtn.disabled = true;
      } else {
        // alapból tiltjuk, amíg meg nem jön a DB-ből a fotószám (race-safe tokennel)
        photosBtn.disabled = true;
        const myToken = ++filterPhotosBtnCheckToken;
        // db.js-ben a publikus függvény neve: countPhotosByMarkerUuid
        Promise.resolve(DB.countPhotosByMarkerUuid(uuid))
          .then((count) => {
            if (myToken !== filterPhotosBtnCheckToken) return;
            photosBtn.disabled = !(Number(count) > 0);
          })
          .catch(() => {
            if (myToken !== filterPhotosBtnCheckToken) return;
            photosBtn.disabled = true;
          });
      }
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

  // Ha már pontosan ez az egy van kijelölve, ne "kapcsolgassuk" le
  if (selectedFilterMarkerIds.size === 1 && selectedFilterMarkerIds.has(id)) {
    if (trEl) {
      const cb = trEl.querySelector('input.row-select');
      if (cb) cb.checked = true;
    }
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

function renderFilterList(list) {
const tb = document.getElementById("sfList");
  tb.innerHTML = "";
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
      <td>${idText(m.id)}</td>
      <td>${escapeHtml(m.address)}</td>
      <td>${escapeHtml(m.typeLabel)}</td>
      <td>${escapeHtml(m.statusLabel)}</td>
      <td>${escapeHtml(m.notes || "")}</td>
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

function applyFilter() {
  const a = document.getElementById("sfAddress").value.toLowerCase();
  const t = document.getElementById("sfType").value;
  const s = document.getElementById("sfStatus").value;

  const res = _allMarkersCache.filter(m =>
    (!a || m.address.toLowerCase().includes(a)) &&
    (!t || m.type === t) &&
    (!s || m.status === s)
  );

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
    hintEl.textContent = "Itt később az állapotok kezelése (adatbázis, színek, bővítés/módosítás) lesz elérhető.";
    renderSettingsPlaceholderPage();
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

// Választható marker-színek (pontosan 30 db, 2-3 árnyalat / alapszín)
// Megjegyzés: a korábbi "régi" (leaflet-color-markers) kódokat kivettük.
const OBJECT_TYPE_COLORS = [
  // Zöld
  { code: "#22c55e", label: "Zöld" },
  { code: "#16a34a", label: "Zöld (sötét)" },
  { code: "#15803d", label: "Zöld (nagyon sötét)" },

  // Türkiz / Teal
  { code: "#14b8a6", label: "Türkiz" },
  { code: "#0d9488", label: "Türkiz (sötét)" },
  { code: "#0f766e", label: "Türkiz (nagyon sötét)" },

  // Cián
  { code: "#06b6d4", label: "Cián" },
  { code: "#0891b2", label: "Cián (sötét)" },
  { code: "#0e7490", label: "Cián (nagyon sötét)" },

  // Kék
  { code: "#3b82f6", label: "Kék" },
  { code: "#2563eb", label: "Kék (sötét)" },
  { code: "#1d4ed8", label: "Kék (nagyon sötét)" },

  // Indigó
  { code: "#6366f1", label: "Indigó" },
  { code: "#4f46e5", label: "Indigó (sötét)" },
  { code: "#4338ca", label: "Indigó (nagyon sötét)" },

  // Lila / Violet
  { code: "#8b5cf6", label: "Lila" },
  { code: "#7c3aed", label: "Lila (sötét)" },
  { code: "#6d28d9", label: "Lila (nagyon sötét)" },

  // Rózsaszín
  { code: "#ec4899", label: "Rózsaszín" },
  { code: "#db2777", label: "Rózsaszín (sötét)" },
  { code: "#be185d", label: "Rózsaszín (nagyon sötét)" },

  // Piros
  { code: "#ef4444", label: "Piros" },
  { code: "#dc2626", label: "Piros (sötét)" },
  { code: "#b91c1c", label: "Piros (nagyon sötét)" },

  // Narancs
  { code: "#f97316", label: "Narancs" },
  { code: "#ea580c", label: "Narancs (sötét)" },
  { code: "#c2410c", label: "Narancs (nagyon sötét)" },

  // Borostyán (Amber)
  { code: "#f59e0b", label: "Borostyán" },
  { code: "#d97706", label: "Borostyán (sötét)" },
  { code: "#b45309", label: "Borostyán (nagyon sötét)" }
];

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
    const addBtn = document.getElementById("btnAddObjectType");
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
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
      });
    }

    // delegált eseménykezelés (minden input/select)
    container.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      markRowDirty(tr);
    });
    container.addEventListener("change", async (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      await saveObjectTypeRow(tr);
    });
    container.addEventListener("blur", async (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      await saveObjectTypeRow(tr);
    }, true);
    container.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action='delete-ot']");
      if (!btn) return;
      const tr = btn.closest("tr[data-ot-id]");
      if (!tr) return;
      const id = Number(tr.dataset.otId);
      if (!Number.isFinite(id)) return;
      if (!confirm("Biztosan törlöd ezt a típust?")) return;
      await DB.deleteObjectType(id);
      showHint("Típus törölve.");
      await loadAndRenderObjectTypes();
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
  const color = tr.querySelector("select[data-field='color']")?.value || "#22c55e";
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
}

async function loadAndRenderObjectTypes(opts = {}) {
  await DB.init();
  _objectTypesCache = await DB.getAllObjectTypes();
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
        <select data-field="color" style="width:100%;">
          ${OBJECT_TYPE_COLORS.map(c => `<option value="${c.code}" ${String(rec.color||"#22c55e")===c.code?"selected":""}>${c.label}</option>`).join("")}
        </select>
      </td>
    `;
    tb.appendChild(tr);

    // kis szín-minta a lenyíló mezőn (ha HEX kód)
    const sel = tr.querySelector("select[data-field='color']");
    if (sel) {
      const apply = () => {
        const v = String(sel.value || "").trim();
        if (v.startsWith("#") && v.length >= 4) {
          sel.style.background = v;
          // kontraszt: egyszerű luminancia becslés
          const hex = v.replace("#", "");
          const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16) || 0;
          const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16) || 0;
          const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16) || 0;
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b);
          sel.style.color = lum < 140 ? "#ffffff" : "#111827";
        } else {
          sel.style.background = "";
          sel.style.color = "";
        }
      };
      apply();
      sel.addEventListener("change", apply);
    }
  });
}


async function refreshFilterData() {
  _allMarkersCache = filterShowDeleted ? await DB.getAllMarkers() : await DB.getAllMarkersActive();
  fillFilterCombos();
  applyFilter();
}


document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnFilter").addEventListener("click", openFilterModal);
  document.getElementById("btnFilterClose").addEventListener("click", closeFilterModal);

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
      clearMapMarkerVisibilityFilter();
      showHint("Összes marker megjelenítve.");
    });
  }

    const showBtn = document.getElementById("filterShowBtn");
  const showDeletedBtn = document.getElementById("filterShowDeletedBtn");
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
      closeFilterModal();
    });
  }

  const clearBtn = document.getElementById("filterClearSelectionBtn");
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.addEventListener("click", clearAllFilterSelections);
  }

  const photosBtn = document.getElementById("filterPhotosBtn");
  if (photosBtn) {
    photosBtn.disabled = true;
    photosBtn.addEventListener("click", async () => {
      const rows = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
      if (rows.length !== 1) return;

      const tr = rows[0];
      const id = Number(tr.dataset.markerId);
      const uuid = tr.dataset.markerUuid || "";
      if (!uuid) return;

      // Ugyanaz a galéria modal, mint a marker popup "Fotók" gombjánál
      openPhotoGallery(uuid, Number.isFinite(id) ? idText(id) : "Fotók");
    });
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
  if (showDeletedBtn) {
    showDeletedBtn.addEventListener("click", async () => {
      filterShowDeleted = !filterShowDeleted;
      showDeletedBtn.textContent = filterShowDeleted ? "Töröltek elrejtése" : "Töröltek megjelenítése";
      clearAllFilterSelections();
      await refreshFilterData();
    });
  }

  document.getElementById("sfAddress").addEventListener("input", applyFilter);
  document.getElementById("sfType").addEventListener("change", applyFilter);
  document.getElementById("sfStatus").addEventListener("change", applyFilter);
});
