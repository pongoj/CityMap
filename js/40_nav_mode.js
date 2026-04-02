// Navigation mode + follow math (from former 02_location_nav.js)

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
// v5.41: Navigáció mód (térkép követés + forgatás)
// - "north": észak felül (térkép nem forog)
// - "heading": haladási irány (heading-up) – a térkép a mozgás irányába fordul
let navMode = (() => {
  let raw = "north";
  try {
    raw = (localStorage.getItem("citymap_nav_mode") || "north");
  } catch (_) {
    raw = "north";
  }
  // migráció: a korábbi "lite" mód most a forgatós haladási irány módnak felel meg
  raw = (raw === "lite") ? "heading" : raw;
  // csak ismert értékeket engedünk
  return (raw === "heading") ? "heading" : "north";
})(); // "north" | "heading"

// v5.51.7: nav mód váltáskor rövid ideig (néhány mp) engedjük a lite eltolást akkor is,
// ha a sebesség bizonytalan. Ez segít vizuálisan azonnal látni, hogy átváltottunk.
let navForceUntilTs = 0;

// v5.51.7: a "lite" mód eltolásához a HALADÁSI IRÁNYT (mozgás bearing) használjuk,
// nem a kompaszt. Így autóban stabil és nem fordul 180°-kal.
let lastNavBearingDeg = NaN;

// v5.51.9: haladási irány simítása (EMA) + hiszterézis, hogy a követés és a forgatás ne kapcsolgasson.
let _smoothedNavBearing = NaN;
const NAV_BEARING_SMOOTHING = 0.15; // 0..1, kisebb = simább
let _navOffsetActive = false;


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
    if (navMode !== "heading") {
      _navOffsetActive = false;
      return { active:false, dx:0, dy:0, px:0 };
    }
    const now = Date.now();
    if (!isFinite(speedMps)) speedMps = 0;

    // Hiszterézis: lassításkor ne ugorjon vissza azonnal középre.
    const onTh  = (now < navForceUntilTs) ? 0.2 : 0.7;
    const offTh = (now < navForceUntilTs) ? 0.15 : 0.45;

    if (!_navOffsetActive) {
      if (speedMps < onTh) return { active:false, dx:0, dy:0, px:0 };
      _navOffsetActive = true;
    } else {
      if (speedMps < offTh) {
        _navOffsetActive = false;
        return { active:false, dx:0, dy:0, px:0 };
      }
    }

    let currentHdg = (typeof lastNavBearingDeg === "number" && isFinite(lastNavBearingDeg)) ? lastNavBearingDeg : NaN;
    if (!isFinite(currentHdg)) currentHdg = (typeof lastHeadingDeg === "number" && isFinite(lastHeadingDeg)) ? lastHeadingDeg : NaN;
    if (!isFinite(currentHdg)) return { active:false, dx:0, dy:0, px:0 };

    // EMA szűrés az irányra
    if (!isFinite(_smoothedNavBearing)) _smoothedNavBearing = currentHdg;
    else {
      let diff = currentHdg - _smoothedNavBearing;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      _smoothedNavBearing = _normDeg(_smoothedNavBearing + diff * NAV_BEARING_SMOOTHING);
    }

    let px = navYOffsetPx();
    // Sebességfüggő skálázás a simább átmenetért
    const k = clamp(speedMps / 5, 0.4, 1.0);
    px = Math.round(px * k);

    const rad = _smoothedNavBearing * Math.PI / 180;
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
  // v5.51.10: ha a követés KI van kapcsolva (user húzta/zoomolta), akkor mindig mutassuk a gombot,
  // mert ez jelzi egyértelműen, hogy vissza lehet térni a saját hely követéséhez.
  if (myLocFollowEnabled) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-flex";
  return;

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

