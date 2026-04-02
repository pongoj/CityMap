// Map / geo helpers used across the app (globals)

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

function _normDeg(d) {
  d = (d % 360 + 360) % 360;
  return d;
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
