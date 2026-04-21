// Geolocation watch + smoothing + follow
// (from former 02_location_nav.js)

let _prevHeadingRaw = null; // {lat,lng,ts}
 // induláskor bekapcsolva (Saját helyem gomb visszakapcsolja)

let lastRawMyLocation = null;        // {lat,lng,ts,acc}
let filteredMyLocation = null;       // {lat,lng,ts}
let lastCenteredMyLocation = null;   // {lat,lng}
let followCenterFiltered = null;   // {lat,lng} (map center EMA)
let followCenterTs = 0;             // ts of followCenterFiltered

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


// Map-follow smoothing (separate from marker smoothing):
// We keep an EMA of the desired follow-center so the map does not "wait then snap".
function smoothFollowCenter(desired, speedMps, accM, nowTs, dcMeters) {
  try {
    if (!desired || !isFinite(desired.lat) || !isFinite(desired.lng)) return desired;
    if (!followCenterFiltered || !isFinite(followCenterFiltered.lat) || !isFinite(followCenterFiltered.lng)) {
      followCenterFiltered = { lat: desired.lat, lng: desired.lng };
      followCenterTs = nowTs || Date.now();
      return followCenterFiltered;
    }

    const dtMs = Math.max(16, (nowTs || Date.now()) - (followCenterTs || (nowTs || Date.now())));
    followCenterTs = nowTs || Date.now();

    let sp = speedMps;
    if (!isFinite(sp)) sp = 0;

    // time constant (ms): smaller = faster follow, larger = smoother
    let tau = 950;
    if (sp < 0.7) tau = 1700;
    else if (sp < 2.5) tau = 1200;
    else if (sp < 7.0) tau = 900;
    else tau = 700;

    if (isFinite(accM)) {
      if (accM > 160) tau *= 1.8;
      else if (accM > 90) tau *= 1.45;
      else if (accM > 55) tau *= 1.20;
      else if (accM < 15) tau *= 0.85;
    }

    // catch-up when far away (e.g., after a tunnel / jitter)
    if (isFinite(dcMeters)) {
      if (dcMeters > 45) tau *= 0.35;
      else if (dcMeters > 20) tau *= 0.55;
      else if (dcMeters > 10) tau *= 0.80;
    }

    const a = clamp(dtMs / tau, 0.05, 0.65);
    followCenterFiltered.lat += (desired.lat - followCenterFiltered.lat) * a;
    followCenterFiltered.lng += (desired.lng - followCenterFiltered.lng) * a;
    return followCenterFiltered;
  } catch (_) {
    return desired;
  }
}
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
          // Gyakoribb, de kisebb lépésű követés = kevesebb "rántás"
          const minInterval = lowQ ? 850 : ((navMode === "heading") ? 260 : 360);
          if ((nowTs - lastMyLocCenterTs) >= minInterval) {
            const dt = Math.max(200, nowTs - (lastMyLocCenterTs || nowTs));
            lastMyLocCenterTs = nowTs;

            // EMA a kívánt centerre: ez csillapítja a bearing/offset és a GPS zaj okozta remegést
            const sm = smoothFollowCenter(desired, speed, acc, nowTs, dc);

            lastCenteredMyLocation = { lat: sm.lat, lng: sm.lng };

            // Pan animáció: a frissítési ütemhez igazítva, hogy folyékony legyen.
            const fast = (isFinite(speed) && speed >= 12);
            let dur = clamp(dt / 1000 * 0.95, 0.25, 0.80);
            if (fast) dur = 0.28;
            if (lowQ) dur = clamp(dt / 1000 * 0.85, 0.35, 0.95);

            try { map.stop(); } catch (_) {}
            map.panTo([sm.lat, sm.lng], {
              animate: (!lowQ),
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
    followCenterFiltered = { lat: desired.lat, lng: desired.lng };
    followCenterTs = Date.now();
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
    followCenterFiltered = { lat: desired.lat, lng: desired.lng };
    followCenterTs = Date.now();
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


