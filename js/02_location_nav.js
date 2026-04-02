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

// v5.51.8: Leaflet ág – haladási irány módban a térkép FOROG (heading-up).
// Technikai megoldás: a Leaflet mapPane-t egy wrapper div-be tesszük, és azt forgatjuk.
// A kattintások/long-press latlng-jét mi számoljuk vissza (rotatedClickLatLng), hogy a forgatás ne rontsa el.
let _rotateWrapperEl = null;
let _mapRotDeg360 = 0;          // 0..360
let _mapRotTargetDeg360 = 0;    // 0..360
let _mapRotCssDeg = 0;          // -180..+180 (CSS)
let _mapRotRaf = null;

function _deg360(d){ return (d % 360 + 360) % 360; }
function _degToCss(d360){
  // 0..360 -> -180..+180 (ugrás nélkül)
  d360 = _deg360(d360);
  return ((d360 + 540) % 360) - 180;
}

// v5.51.10: Észak indikátor – north módban is a VALÓDI (kompassz/GPS) Észak felé mutasson.
function _bestCompassHeadingDeg(){
  try {
    const sp = (typeof lastSpeedMps === "number" && isFinite(lastSpeedMps)) ? lastSpeedMps : NaN;
    // Menet közben a simított mozgás-irány a legstabilabb
    if (isFinite(sp) && sp >= 0.9) {
      if (typeof _smoothedNavBearing === "number" && isFinite(_smoothedNavBearing)) return _smoothedNavBearing;
      if (typeof lastNavBearingDeg === "number" && isFinite(lastNavBearingDeg)) return lastNavBearingDeg;
    }
    // Állva/forgás közben: iránytű (deviceorientation)
    if (typeof lastHeadingDeg === "number" && isFinite(lastHeadingDeg)) return lastHeadingDeg;
    // Végső fallback
    if (typeof lastNavBearingDeg === "number" && isFinite(lastNavBearingDeg)) return lastNavBearingDeg;
  } catch (_) {}
  return NaN;
}

function updateNorthIndicator(){
  try {
    const el = document.getElementById('northIndicator');
    const inner = el ? el.querySelector('.ni-arrow') : null;
    if (!inner) return;

    // A nyíl mindig a képernyőn a VALÓDI Észak irányába mutasson.
    // - heading mód: a térkép forgása már -heading, ezért a mapRotCssDeg ugyanazt adja.
    // - north mód: a térkép nem forog, ezért heading alapján forgatjuk a nyilat.
    let cssDeg = 0;

    if (navMode === 'heading') {
      cssDeg = _mapRotCssDeg;
    } else {
      const h = _bestCompassHeadingDeg();
      if (isFinite(h)) {
        const d360 = _deg360(360 - _deg360(h)); // -h mod 360
        cssDeg = _degToCss(d360);
      } else {
        cssDeg = 0;
      }
    }

    inner.style.transform = `rotate(${cssDeg}deg)`;
  } catch (_) {}
}


function initRotateWrapper(){
  try {
    if (_rotateWrapperEl || !map || !map.getPane) return;
    const pane = map.getPane('mapPane');
    if (!pane || !pane.parentNode) return;

    const wrap = document.createElement('div');
    wrap.className = 'leaflet-rotate-wrapper';
    wrap.style.position = 'absolute';
    wrap.style.left = '0';
    wrap.style.top = '0';
    wrap.style.right = '0';
    wrap.style.bottom = '0';
    wrap.style.transformOrigin = '50% 50%';
    wrap.style.willChange = 'transform';

    pane.parentNode.insertBefore(wrap, pane);
    wrap.appendChild(pane);
    _rotateWrapperEl = wrap;

    _applyMapRotationNow(_mapRotDeg360, true);
  } catch (err) {
    console.warn('initRotateWrapper failed', err);
  }
}

function _applyMapRotationNow(d360, immediate){
  try {
    _mapRotDeg360 = _deg360(d360);
    _mapRotCssDeg = _degToCss(_mapRotDeg360);

    if (_rotateWrapperEl) {
      // kis skála, hogy forgatásnál ne látszódjon a sarokban üres rész
      const scale = (Math.abs(_mapRotCssDeg) > 0.01) ? 1.12 : 1;
      _rotateWrapperEl.style.transform = `rotate(${_mapRotCssDeg}deg) scale(${scale})`;
    }

    // Észak indikátor frissítése
    try { updateNorthIndicator(); } catch (_) {}
  } catch (_) {}
}

function scheduleApplyNavBearing(){
  try {
    if (!map) return;
    initRotateWrapper();

    let target = 0;
    if (navMode === 'heading') {
      // elsődlegesen a mozgás bearing (autóban stabil), fallback: heading
      let b = (typeof _smoothedNavBearing === 'number' && isFinite(_smoothedNavBearing)) ? _smoothedNavBearing : NaN;
      if (!isFinite(b)) b = (typeof lastNavBearingDeg === 'number' && isFinite(lastNavBearingDeg)) ? lastNavBearingDeg : NaN;
      if (!isFinite(b)) b = (typeof lastHeadingDeg === 'number' && isFinite(lastHeadingDeg)) ? lastHeadingDeg : NaN;
      if (isFinite(b)) {
        // heading-up: a térkép ellenkező irányba forog, hogy a haladás felfelé (képernyő teteje) legyen
        target = _deg360(360 - _deg360(b));
      }
    }
    _mapRotTargetDeg360 = _deg360(target);

    if (_mapRotRaf) return;
    const step = () => {
      _mapRotRaf = null;
      const cur = _mapRotDeg360;
      const tgt = _mapRotTargetDeg360;
      const d = shortestAngleDelta(cur, tgt);
      const absd = Math.abs(d);

      if (absd < 0.6) {
        _applyMapRotationNow(tgt, true);
        return;
      }

      // simítás: nagy fordulás gyorsabb, kis zajra stabilabb
      const k = (absd > 60) ? 0.26 : (absd > 25 ? 0.18 : 0.12);
      const next = _deg360(cur + d * k);
      _applyMapRotationNow(next, false);

      _mapRotRaf = requestAnimationFrame(step);
    };
    _mapRotRaf = requestAnimationFrame(step);
  } catch (_) {}
}

function rotatedClickLatLng(e){
  try {
    if (!map) return e.latlng;
    if (!(_rotateWrapperEl) || Math.abs(_mapRotCssDeg) < 0.01) return e.latlng;

    const oe = (e && e.originalEvent) ? e.originalEvent : e;
    let cx = null, cy = null;

    // Touch / Pointer / Mouse
    if (oe && oe.touches && oe.touches.length) {
      cx = oe.touches[0].clientX;
      cy = oe.touches[0].clientY;
    } else if (oe && oe.changedTouches && oe.changedTouches.length) {
      cx = oe.changedTouches[0].clientX;
      cy = oe.changedTouches[0].clientY;
    } else if (oe && typeof oe.clientX === 'number') {
      cx = oe.clientX;
      cy = oe.clientY;
    }

    if (!(typeof cx === 'number' && typeof cy === 'number')) return e.latlng;

    const rect = map.getContainer().getBoundingClientRect();
    const x = cx - rect.left;
    const y = cy - rect.top;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const dx = x - mx;
    const dy = y - my;

    const rad = (_mapRotCssDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Inverz forgatás (a vizuális forgatás ellentéte): visszaszámoljuk az unrotated map koordinátát.
    const xr = cos * dx + sin * dy + mx;
    const yr = -sin * dx + cos * dy + my;

    const pt = L.point(xr, yr);
    return map.containerPointToLatLng(pt);
  } catch (_) {
    return e.latlng;
  }
}

// Saját hely nyíl iránya (0..360). Ha a böngésző ad heading-et, azt használjuk,
// különben két GPS pontból számolunk irányt (ha van elmozdulás).
let lastHeadingDeg = NaN;
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
    try { updateNorthIndicator(); } catch (_) {}
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
      try { updateNorthIndicator(); } catch (_) {}
      try { updateNorthIndicator(); } catch (_) {}
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

// v5.51.7: "bearing anchor" a mozgásirány (haladási irány) stabil számításához.
// Sok eszköz nagyon gyakran frissít (2-5m lépésekkel). Ha csak rövid bázison számolunk,
// a bearing zajos/NaN lesz, és a nav-lite eltolás "nem látszik".
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

      // Mozgásból számolt sebesség + irány (bearing) a raw GPS pontokból.
      // v5.51.7: a bearing számításhoz hosszabb bázist használunk (anchor), mert sok eszköz
      // 1-2 mp-enként frissít és egy-egy lépés csak pár méter → a régi 10m küszöb miatt
      // gyakran NaN maradt, így a "haladási irány (lite)" nem tudott érdemben eltolni.
      let moveBearing = NaN;
      let moveSpeed = NaN;
      let moveAnchorDist = NaN;
      if (prevRaw) {
        const dtMove = Math.max(0.001, (nowTs - prevRaw.ts) / 1000);
        const dMove = distanceMeters(prevRaw.lat, prevRaw.lng, latRaw, lngRaw);
        moveSpeed = dMove / dtMove;
        if (!isFinite(speedHint)) speedHint = moveSpeed;
      }

      try {
        const anchor = _prevHeadingRaw || prevRaw;
        if (anchor) {
          const dtA = Math.max(0.001, (nowTs - anchor.ts) / 1000);
          const dA = distanceMeters(anchor.lat, anchor.lng, latRaw, lngRaw);
          moveAnchorDist = dA;

          // Elsődlegesen a hosszabb bázis (>=6m) ad stabil irányt.
          if (dA >= 6 && dtA <= 15) {
            moveBearing = bearingDeg(anchor.lat, anchor.lng, latRaw, lngRaw);
          }

          // Rövid bázis fallback: ha kicsit mozdultunk, még mindig jobb, mint a 0°.
          if (!isFinite(moveBearing) && prevRaw) {
            const dtS = Math.max(0.001, (nowTs - prevRaw.ts) / 1000);
            const dS = distanceMeters(prevRaw.lat, prevRaw.lng, latRaw, lngRaw);
            if (dS >= 3 && dtS <= 10) {
              moveBearing = bearingDeg(prevRaw.lat, prevRaw.lng, latRaw, lngRaw);
            }
          }

          // Anchor frissítés: ha már elég nagyot mentünk, vagy túl régi.
          if (!_prevHeadingRaw || dA >= 12 || dtA >= 8) {
            _prevHeadingRaw = { lat: latRaw, lng: lngRaw, ts: nowTs };
          }
        } else {
          _prevHeadingRaw = { lat: latRaw, lng: lngRaw, ts: nowTs };
        }
      } catch (_) {}

      // v5.42.4: sebesség hint mentése (mozgás közben ne írja felül a gyro/kompasz a heading-et)
      const speedBest = (typeof pos.coords.speed === "number" && isFinite(pos.coords.speed)) ? pos.coords.speed
        : (isFinite(speedHint) ? speedHint : moveSpeed);
      lastSpeedMps = speedBest;
      lastSpeedTs = nowTs;

      // Geolocation heading (ha van). Sok böngésző csak GPS módban adja.
      const geoHeadingOk = (typeof pos.coords.heading === "number" && isFinite(pos.coords.heading) && isFinite(speedBest) && speedBest >= 1.2 && acc <= 250);
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
      if (isFinite(moveBearing) && isFinite(moveSpeed) && moveSpeed >= 1.4 && (acc <= 250 || (isFinite(moveAnchorDist) && moveAnchorDist >= 25))) {
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

      // v5.51.7: a nav-lite eltolás irányát (bearing) külön is simítjuk.
      // Menet közben a mozgás bearing a legjobb; állva pedig a chosenHeading (geo/kompasz) adhat támpontot.
      try {
        if (isFinite(moveBearing) && isFinite(moveSpeed) && moveSpeed >= 0.7 && (acc <= 500 || (isFinite(moveAnchorDist) && moveAnchorDist >= 25))) {
          if (!isFinite(lastNavBearingDeg)) {
            lastNavBearingDeg = moveBearing;
          } else {
            const d = shortestAngleDelta(lastNavBearingDeg, moveBearing);
            const absd = Math.abs(d);
            let k = (absd > 60) ? 0.45 : (absd > 25 ? 0.30 : 0.20);
            // gyenge pontosságnál óvatosabban közelítsünk (kevesebb rángás)
            if (isFinite(acc) && acc > 160) k *= 0.75;
            if (isFinite(acc) && acc > 300) k *= 0.65;
            if (isFinite(moveSpeed)) k = clamp(k + moveSpeed / 55, 0.20, 0.60);
            lastNavBearingDeg = _normDeg(lastNavBearingDeg + d * k);
          }
        } else if (isFinite(chosenHeading) && acc <= 500) {
          if (!isFinite(lastNavBearingDeg)) lastNavBearingDeg = chosenHeading;
          else {
            const d = shortestAngleDelta(lastNavBearingDeg, chosenHeading);
            lastNavBearingDeg = _normDeg(lastNavBearingDeg + d * 0.12);
          }
        }
      } catch (_) {}

      // v5.51.9: a térkép-forgatáshoz is használjuk a simított bearinget
      try {
        if (typeof lastNavBearingDeg === "number" && isFinite(lastNavBearingDeg)) {
          if (!isFinite(_smoothedNavBearing)) _smoothedNavBearing = lastNavBearingDeg;
          else {
            let diff = lastNavBearingDeg - _smoothedNavBearing;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            _smoothedNavBearing = _normDeg(_smoothedNavBearing + diff * 0.10);
          }
        }
      } catch (_) {}


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
      // v5.51.9: a korábbi pixeles holtzóna "kifutás" után rántotta utána a térképet.
      // Most folyamatosan, kis lépésekben követünk (állva továbbra sem mászkál).
      if (myLocFollowEnabled) {
        const lowQ = (typeof acc === "number" && isFinite(acc) && acc > 120);
        const desired = desiredFollowCenter(filteredMyLocation.lat, filteredMyLocation.lng, speed, acc);

        const centerNow = map.getCenter ? map.getCenter() : null;
        const dc = (centerNow && isFinite(centerNow.lat) && isFinite(centerNow.lng))
          ? distanceMeters(desired.lat, desired.lng, centerNow.lat, centerNow.lng)
          : 999999;

        const still = (!isFinite(speed) || speed < 0.55);
        const nearM = clamp(Math.max(2.5, acc * 0.25), 2.5, 10);

        // állva + kicsi drift esetén ne mozogjon a térkép
        if (!(still && dc < nearM)) {
          const minInterval = lowQ ? 900 : ((navMode === "heading") ? 320 : 520);
          if ((nowTs - lastMyLocCenterTs) >= minInterval) {
            // az intervalt előbb számoljuk, majd a duration-t már a várható frissítéshez igazítjuk
            const dt = Math.max(200, nowTs - (lastMyLocCenterTs || nowTs));
            lastMyLocCenterTs = nowTs;
            lastCenteredMyLocation = { lat: desired.lat, lng: desired.lng };

            let dur = lowQ ? 0.0 : clamp(dt / 1000 * 0.85, 0.35, 0.85);

            const fast = (isFinite(speed) && speed >= 10);
            try { map.stop(); } catch (_) {}
            map.panTo([desired.lat, desired.lng], {
              animate: (!fast && !lowQ),
              duration: dur,
              easeLinearity: 0.25,
              noMoveStart: true,
            });
          }
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


