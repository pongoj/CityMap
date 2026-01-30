const APP_VERSION = "0.4.1";

let map;
let addMode = false;
let pendingLatLng = null;
let myLocMarker = null;

const markerLayers = new Map();

function showHint(text, ms = 2500) {
  const el = document.getElementById("hint");
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => (el.style.display = "none"), ms);
}

function openModal(latlng) {
  pendingLatLng = latlng;
  document.getElementById("markerModal").style.display = "flex";
}

function closeModal() {
  document.getElementById("markerModal").style.display = "none";
  pendingLatLng = null;
}

async function centerToMyLocation() {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        map.setView(ll, 20);
        if (myLocMarker) map.removeLayer(myLocMarker);
        myLocMarker = L.circleMarker(ll, {
          radius: 8,
          color: "#16a34a",
          fillOpacity: 0.9
        }).addTo(map);
        resolve(true);
      },
      () => resolve(false)
    );
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("appVersion").textContent = "v" + APP_VERSION;

  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  await DB.init();

  document.getElementById("btnAdd").addEventListener("click", () => {
    addMode = true;
    showHint("Kattints a térképre az objektum helyéhez.");
  });

  document.getElementById("btnMyLoc").addEventListener("click", async () => {
    await centerToMyLocation();
  });

  document.getElementById("btnCancel").addEventListener("click", closeModal);

  map.on("click", (e) => {
    if (!addMode) return;
    addMode = false;
    openModal(e.latlng);
  });

  await centerToMyLocation();
});
