const APP_VERSION = "0.4.7";

let map;
let addMode = false;
let pendingLatLng = null;

const markerLayers = new Map(); // dbId -> leaflet marker

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
  document.getElementById("fCity").value = "";
  document.getElementById("fStreet").value = "";
  document.getElementById("fHouse").value = "";
  document.getElementById("fNotes").value = "";

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

function closeModal() {
  document.getElementById("markerModal").style.display = "none";
  pendingLatLng = null;
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

        myLocationMarker = L.circleMarker(ll, {
          radius: 8,
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.9
        }).addTo(map);

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
  // address cleanup: remove comma before house number
  const addr = escapeHtml(m.address || "").replace(/,\s*(\d+)/, " $1");

  return `
  <div style="min-width:220px">
    <div><b>Azonosítószám:</b> ${idText(m.id)}</div>
    <div><b>Cím:</b> ${addr}</div>
    <div><b>Típus:</b> ${escapeHtml(m.typeLabel)}</div>
    <div><b>Állapot:</b> ${escapeHtml(m.statusLabel)}</div>
    <div><b>Megjegyzés:</b> ${m.notes ? escapeHtml(m.notes) : "-"}</div>

    <div style="margin-top:10px;display:flex;justify-content:flex-end">
      <button data-del="${m.id}">Törlés</button>
    </div>
  </div>`;
}</b></div>
    <div style="margin-top:4px"><b>${escapeHtml(m.typeLabel)}</b></div>
    <div>${escapeHtml(m.address)}</div>
    <div>Állapot: ${escapeHtml(m.statusLabel)}</div>
    ${m.notes ? `<div style="margin-top:6px"><i>${escapeHtml(m.notes)}</i></div>` : ""}
    <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px">
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
      await DB.deleteMarker(dbId);
      map.removeLayer(marker);
      markerLayers.delete(dbId);
    });
  });
}

async function getMarker(id) {
  const all = await DB.getAllMarkers();
  return all.find(x => x.id === id) || null;
}

function addMarkerToMap(m) {
  const mk = L.marker([m.lat, m.lng], { draggable: true }).addTo(map);
  mk.bindPopup(popupHtml(m));
  wirePopupDelete(mk, m.id);

  mk.on("dragend", async (e) => {
    const p = e.target.getLatLng();
    await DB.updateMarker(m.id, { lat: p.lat, lng: p.lng });

    const updated = await getMarker(m.id);
    if (updated) mk.setPopupContent(popupHtml(updated));
  });

  markerLayers.set(m.id, mk);
}

async function loadMarkers() {
  const all = await DB.getAllMarkers();
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

  const id = await DB.addMarker(marker);
  marker.id = id;

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
  await fillLookups();

  document.getElementById("btnCancel").addEventListener("click", closeModal);
  document.getElementById("btnSave").addEventListener("click", saveMarker);

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
