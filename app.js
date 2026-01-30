// CityMap
// Verzió: ezt és a service-worker.js-ben lévő CACHE_VERSION-t együtt növeld.
const APP_VERSION = "5.1";

// Ha valami elszáll, legalább legyen látható (ne "néma" fehér oldal).
window.addEventListener("error", (e) => {
  try {
    const msg = (e && (e.message || (e.error && e.error.message)))
      ? (e.message || (e.error && e.error.message))
      : "Ismeretlen hiba";
    console.error("CityMap error:", e);
    const hint = document.getElementById("hint");
    if (hint) {
      hint.textContent = `Hiba: ${msg}`;
      hint.style.display = "block";
    }
  } catch (_) {}
});

window.addEventListener("unhandledrejection", (e) => {
  try {
    console.error("CityMap unhandledrejection:", e);
    const msg = (e && e.reason && (e.reason.message || String(e.reason))) ? (e.reason.message || String(e.reason)) : "Ismeretlen hiba";
    const hint = document.getElementById("hint");
    if (hint) {
      hint.textContent = `Hiba: ${msg}`;
      hint.style.display = "block";
    }
  } catch (_) {}
});

let map;
let addMode = false;
let pendingLatLng = null;

const markerLayers = new Map(); // dbId -> leaflet marker
const markerData = new Map();   // dbId -> marker record (latest)

let editId = null;
let lastAllMarkers = [];

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

function openModal(latlng, marker = null) {
  pendingLatLng = latlng;
  editId = marker ? marker.id : null;

  document.getElementById("fAddress").value = marker ? (marker.address || "") : "";
  document.getElementById("fNotes").value = marker ? (marker.notes || "") : "";

  const typeSel = document.getElementById("fType");
  const statusSel = document.getElementById("fStatus");
  if (marker) {
    if (typeSel) typeSel.value = marker.type || "";
    if (statusSel) statusSel.value = marker.status || "";
  }

  document.getElementById("markerModal").style.display = "flex";
}

function closeModal() {
  document.getElementById("markerModal").style.display = "none";
  pendingLatLng = null;
  editId = null;
}

async function centerToMyLocation() {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 20);
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
    <div>Azonosító: <b>${idText(m.id)}</b></div>
    <div style="margin-top:4px"><b>${escapeHtml(m.typeLabel)}</b></div>
    <div>${escapeHtml(m.address)}</div>
    <div>Állapot: ${escapeHtml(m.statusLabel)}</div>
    ${m.notes ? `<div style="margin-top:6px"><i>${escapeHtml(m.notes)}</i></div>` : ""}
    <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px">
      <button data-edit="${m.id}">Szerkesztés</button>
      <button data-del="${m.id}">Törlés</button>
    </div>
  </div>`;
}

function wirePopupActions(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;

    const btnDel = el.querySelector(`button[data-del="${dbId}"]`);
    if (btnDel) {
      btnDel.addEventListener("click", async () => {
        await DB.deleteMarker(dbId);
        map.removeLayer(marker);
        markerLayers.delete(dbId);
        markerData.delete(dbId);
        refreshListAndFilters();
      });
    }

    const btnEdit = el.querySelector(`button[data-edit="${dbId}"]`);
    if (btnEdit) {
      btnEdit.addEventListener("click", async () => {
        const m = markerData.get(dbId) || (await getMarker(dbId));
        if (!m) return;
        const p = marker.getLatLng();
        openModal(p, m);
      });
    }
  });
}

async function getMarker(id) {
  const all = await DB.getAllMarkers();
  return all.find(x => x.id === id) || null;
}

function addMarkerToMap(m) {
  const mk = L.marker([m.lat, m.lng], { draggable: true }).addTo(map);
  mk.bindPopup(popupHtml(m));
  wirePopupActions(mk, m.id);

  mk.on("dragend", async (e) => {
    const p = e.target.getLatLng();
    await DB.updateMarker(m.id, { lat: p.lat, lng: p.lng });

    const updated = await getMarker(m.id);
    if (updated) {
      mk.setPopupContent(popupHtml(updated));
      markerData.set(m.id, updated);
      refreshListAndFilters();
    }
  });

  markerLayers.set(m.id, mk);
  markerData.set(m.id, m);
}

async function loadMarkers() {
  const all = await DB.getAllMarkers();
  lastAllMarkers = all;
  all.forEach(addMarkerToMap);
  refreshListAndFilters();
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

  // szűrők (Mind)
  fillFilters(types, statuses);
}

function fillFilters(types, statuses) {
  const fltType = document.getElementById("fltType");
  const fltStatus = document.getElementById("fltStatus");
  if (!fltType || !fltStatus) return;

  fltType.innerHTML = "";
  fltStatus.innerHTML = "";

  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "Minden típus";
  fltType.appendChild(o0);
  types.forEach(t => {
    const o = document.createElement("option");
    o.value = t.code;
    o.textContent = t.label;
    fltType.appendChild(o);
  });

  const s0 = document.createElement("option");
  s0.value = "";
  s0.textContent = "Minden állapot";
  fltStatus.appendChild(s0);
  statuses.forEach(s => {
    const o = document.createElement("option");
    o.value = s.code;
    o.textContent = s.label;
    fltStatus.appendChild(o);
  });
}

function getFilters() {
  const type = document.getElementById("fltType")?.value || "";
  const status = document.getElementById("fltStatus")?.value || "";
  const q = (document.getElementById("txtSearch")?.value || "").trim().toLowerCase();
  return { type, status, q };
}

function markerMatches(m, f) {
  if (f.type && m.type !== f.type) return false;
  if (f.status && m.status !== f.status) return false;
  if (f.q) {
    const hay = ((m.address || "") + " " + (m.notes || "")).toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

function applyFiltersToMap() {
  const f = getFilters();
  for (const [id, mk] of markerLayers.entries()) {
    const m = markerData.get(id);
    if (!m) continue;
    const ok = markerMatches(m, f);
    const onMap = map.hasLayer(mk);
    if (ok && !onMap) mk.addTo(map);
    if (!ok && onMap) map.removeLayer(mk);
  }
}

function renderList() {
  const list = document.getElementById("markerList");
  if (!list) return;

  const f = getFilters();
  const items = Array.from(markerData.values())
    .filter(m => markerMatches(m, f))
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

  list.innerHTML = "";
  if (items.length === 0) {
    const d = document.createElement("div");
    d.className = "small";
    d.textContent = "Nincs találat a szűrőkre.";
    list.appendChild(d);
    return;
  }

  items.forEach(m => {
    const d = document.createElement("div");
    d.className = "list-item";
    d.innerHTML = `
      <div class="t">${escapeHtml(m.typeLabel || m.type)}</div>
      <div class="a">${escapeHtml(m.address)}</div>
      <div class="s">Állapot: ${escapeHtml(m.statusLabel || m.status)} • ${escapeHtml(idText(m.id))}</div>
    `;
    d.addEventListener("click", () => {
      const mk = markerLayers.get(m.id);
      if (!mk) return;
      map.setView(mk.getLatLng(), Math.max(map.getZoom(), 19));
      mk.openPopup();
    });
    list.appendChild(d);
  });
}

function refreshListAndFilters() {
  applyFiltersToMap();
  renderList();
}

async async function saveMarker() {
  if (!pendingLatLng) return;

  const address = document.getElementById("fAddress").value.trim();
  if (!address) {
    alert("A cím megadása kötelező (város, utca, házszám).");
    return;
  }

  const typeSel = document.getElementById("fType");
  const statusSel = document.getElementById("fStatus");

  const marker = {
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    address,
    type: typeSel.value,
    typeLabel: typeSel.options[typeSel.selectedIndex]?.textContent || typeSel.value,
    status: statusSel.value,
    statusLabel: statusSel.options[statusSel.selectedIndex]?.textContent || statusSel.value,
    notes: document.getElementById("fNotes").value.trim(),
    createdAt: Date.now()
  };

  if (editId) {
    await DB.updateMarker(editId, {
      address: marker.address,
      type: marker.type,
      typeLabel: marker.typeLabel,
      status: marker.status,
      statusLabel: marker.statusLabel,
      notes: marker.notes
    });

    const updated = await getMarker(editId);
    if (updated) {
      const mk = markerLayers.get(editId);
      if (mk) mk.setPopupContent(popupHtml(updated));
      markerData.set(editId, updated);
    }

    closeModal();
    refreshListAndFilters();
    return;
  }

  const id = await DB.addMarker(marker);
  marker.id = id;

  addMarkerToMap(marker);
  closeModal();
  refreshListAndFilters();
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      showHint("Új verzió elérhető. Frissítéshez zárd be és nyisd meg újra, vagy frissíts (Ctrl+F5).", 6000);
    });
  }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", async () => {
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };

  try {
    const vEl = document.getElementById("appVersion");
    if (vEl) vEl.textContent = "v" + APP_VERSION;

    registerSW();

    if (!window.L) {
      showHint("Hiba: a Leaflet nem töltődött be (L is undefined).", 8000);
      return;
    }

    map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    await DB.init();
    await fillLookups();

    on("btnCancel", "click", closeModal);
    on("btnSave", "click", saveMarker);

    on("btnAdd", "click", () => {
      addMode = true;
      showHint("Bökj a térképre az objektum helyéhez.");
    });

    on("btnMyLoc", "click", async () => {
      const ok = await centerToMyLocation();
      if (!ok) alert("Nem sikerült lekérni a pozíciót.");
    });

    on("btnClear", "click", async () => {
      if (!confirm("Biztosan törlöd az összes markert?")) return;
      await DB.clearMarkers();
      for (const mk of markerLayers.values()) map.removeLayer(mk);
      markerLayers.clear();
      markerData.clear();
      refreshListAndFilters();
    });

    on("btnList", "click", () => {
      const sp = document.getElementById("sidePanel");
      if (!sp) return;
      sp.style.display = (sp.style.display === "flex") ? "none" : "flex";
      refreshListAndFilters();
    });

    on("btnSpClose", "click", () => {
      const sp = document.getElementById("sidePanel");
      if (sp) sp.style.display = "none";
    });

    on("fltType", "change", refreshListAndFilters);
    on("fltStatus", "change", refreshListAndFilters);
    on("txtSearch", "input", () => {
      clearTimeout(refreshListAndFilters._t);
      refreshListAndFilters._t = setTimeout(refreshListAndFilters, 120);
    });

    on("btnExport", "click", async () => {
      const all = await DB.getAllMarkers();
      const payload = {
        app: "CityMap",
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        markers: all
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `citymap-export-${APP_VERSION}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    on("btnImport", "click", () => {
      const fi = document.getElementById("fileImport");
      if (fi) fi.click();
    });

    on("fileImport", "change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;

      try {
        const txt = await file.text();
        const data = JSON.parse(txt);
        const markers = Array.isArray(data && data.markers) ? data.markers : [];
        if (markers.length === 0) {
          alert("Nincs marker a fájlban.");
          return;
        }
        if (!confirm(`Importálás: ${markers.length} marker. Folytassam?`)) return;

        for (const m of markers) {
          const copy = { ...m };
          delete copy.id;
          const id = await DB.addMarker(copy);
          copy.id = id;
          addMarkerToMap(copy);
        }
        refreshListAndFilters();
        alert("Import kész.");
      } catch (err) {
        alert("Import hiba: nem sikerült beolvasni a JSON-t.");
      }
    });

    map.on("click", (e) => {
      if (!addMode) return;
      addMode = false;
      openModal(e.latlng);
    });

    const ok = await centerToMyLocation();
    if (!ok) map.setView([47.4979, 19.0402], 15);

    await loadMarkers();
  } catch (err) {
    console.error("CityMap init error:", err);
    showHint("Indítási hiba: " + (err && err.message ? err.message : String(err)), 8000);
  }
});
