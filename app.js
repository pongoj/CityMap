const APP_VERSION = "5.15.0";

// Szűrés táblázat kijelölés (több sor is kijelölhető)
let selectedFilterMarkerIds = new Set();
let filterShowDeleted = false; // Szűrés listában töröltek megjelenítése

// v5.15: térképi megjelenítés szűrése (csak kijelöltek / táblázat tartalma)
let activeMapFilterIds = null; // null = nincs térképi szűrés, minden aktív marker látszik

let map;
let addMode = false;
let pendingLatLng = null;

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
        const count = await DB.getPhotoCount(markerUuid);
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
  pendingLatLng = latlng;

  // v5.11: új marker felviteli folyamat => új draft uuid fényképekhez
  draftHasSaved = false;
  currentDraftUuid = genUuid();

  document.getElementById("fCity").value = "";
  document.getElementById("fStreet").value = "";
  document.getElementById("fHouse").value = "";
  document.getElementById("fNotes").value = "";

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

  // Ha a felhasználó mégsem ment, a draft képeket töröljük, hogy ne maradjon szemét.
  await cleanupDraftPhotosIfNeeded();
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
      await DB.softDeleteMarker(dbId);
      map.removeLayer(marker);
      markerLayers.delete(dbId);
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
}

async function loadMarkers() {
  const all = await DB.getAllMarkersActive();
  all.forEach(addMarkerToMap);
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

  // v5.15: Megjelenítés akkor is működjön, ha nincs kijelölés (ilyenkor a táblázat aktuális sorai alapján)
  if (showBtn) showBtn.disabled = !tableHasRows;
  if (clearBtn) clearBtn.disabled = !hasSelection;
  if (deleteBtn) deleteBtn.disabled = !hasSelection;
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
}

function toggleFilterRowSelection(markerId, trEl) {
  if (selectedFilterMarkerIds.has(markerId)) {
    selectedFilterMarkerIds.delete(markerId);
    if (trEl) trEl.classList.remove("row-selected");
  } else {
    selectedFilterMarkerIds.add(markerId);
    if (trEl) trEl.classList.add("row-selected");
  }
  updateFilterShowButtonState();
}

function clearAllFilterSelections() {
  selectedFilterMarkerIds.clear();
  // csak a táblázatban vegyük le a kijelölést
  document.querySelectorAll('#sfList tr.row-selected').forEach(tr => tr.classList.remove('row-selected'));
  updateFilterShowButtonState();
}

function renderFilterList(list) {
const tb = document.getElementById("sfList");
  tb.innerHTML = "";
  list.forEach(m => {
    const tr = document.createElement("tr");
    tr.dataset.markerId = String(m.id);
	    if (selectedFilterMarkerIds.has(m.id)) {
	      tr.classList.add("row-selected");
	    }
	    // Soft delete: törölt sorok vizuális jelölése
	    if (m.deletedAt || m.deleted) {
	      tr.classList.add("row-deleted");
	    }
    tr.innerHTML = `
      <td>${idText(m.id)}</td>
      <td>${escapeHtml(m.address)}</td>
      <td>${escapeHtml(m.typeLabel)}</td>
      <td>${escapeHtml(m.statusLabel)}</td>
      <td>${escapeHtml(m.notes || "")}</td>
    `;
	    // 1 kattintás: kijelölés (több sor is lehet)
	    tr.addEventListener("click", (ev) => {
	      ev.stopPropagation();
	      const markerId = tr.dataset.markerId;
	      if (!markerId) return;
	      toggleFilterRowSelection(markerId, tr);
	      updateFilterShowButtonState();
	    });

	    // dupla kattintás: ugrás a markerre + ablak bezárása
	    tr.addEventListener("dblclick", (ev) => {
	      ev.stopPropagation();
	      // Törölt elemre ne ugorjunk / ne zárjuk be a szűrés ablakot
	      const markerId = tr.dataset.markerId;
	      if (markerId) {
	        // biztos kijelölés a duplakattnál is
	        if (!selectedFilterMarkerIds.has(Number(markerId))) {
	          selectedFilterMarkerIds.add(Number(markerId));
	          tr.classList.add("row-selected");
	          updateFilterShowButtonState();
	        }
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


async function refreshFilterData() {
  _allMarkersCache = filterShowDeleted ? await DB.getAllMarkers() : await DB.getAllMarkersActive();
  fillFilterCombos();
  applyFilter();
}


document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnFilter").addEventListener("click", openFilterModal);
  document.getElementById("btnFilterClose").addEventListener("click", closeFilterModal);

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
      } else {
        idsToShow = getIdsFromCurrentFilterTable({ includeDeleted: false });
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
        }

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
