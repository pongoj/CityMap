const map = L.map('map').setView([47.4979, 19.0402], 18);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 22,
  attribution: '© OpenStreetMap'
}).addTo(map);

let marker = null;
let accuracyCircle = null;

navigator.geolocation.getCurrentPosition(pos => {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const acc = pos.coords.accuracy;

  if (marker) map.removeLayer(marker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);

  marker = L.marker([lat, lon]).addTo(map);
  accuracyCircle = L.circle([lat, lon], { radius: acc }).addTo(map);

  map.setView([lat, lon], 20);

  fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`)
    .then(r => r.json())
    .then(d => marker.bindPopup(d.display_name || "Cím nem található").openPopup())
    .catch(() => marker.bindPopup("Cím lekérdezési hiba").openPopup());
},
err => alert("Helymeghatározási hiba: " + err.message),
{ enableHighAccuracy: true });
