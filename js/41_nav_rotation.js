// Map rotation wrapper + north indicator + rotated click mapping
// (from former 02_location_nav.js)

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
