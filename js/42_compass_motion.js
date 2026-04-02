// Compass + motion fusion
// (from former 02_location_nav.js)

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
