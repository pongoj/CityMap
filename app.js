
// --- MAP INIT ---
const map = L.map('map');

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    map.setView([lat, lon], 17);

    const marker = L.marker([lat, lon]).addTo(map);

    const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
    );
    const data = await res.json();

    const a = data.address || {};
    const city = a.city || a.town || a.village || "";
    const road = a.road || "";
    const house = a.house_number || "";

    const text = `${city}, ${road} ${house}`.trim();

    marker.bindPopup(text).openPopup();
});
