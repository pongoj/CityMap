// v5.44: Új objektum felvitele csak hosszú nyomásra (mobilon is)
// (moved out from boot)

function setupLongPressAddObject() {
  if (!map) return;
  const container = map.getContainer();
  const LONGPRESS_MS = 550;
  const MOVE_TOL_PX = 12;

  let timer = null;
  let startPt = null;
  let startEvt = null;
  let activePointerId = null;
  let suppressClickUntil = 0;

  function clear(){
    if (timer) { clearTimeout(timer); timer = null; }
    startPt = null;
    startEvt = null;
    activePointerId = null;
  }

  function getPrimaryEvent(ev){
    // TouchEvent -> Touch point; Pointer/Mouse -> itself
    if (ev.touches && ev.touches[0]) return ev.touches[0];
    if (ev.changedTouches && ev.changedTouches[0]) return ev.changedTouches[0];
    return ev;
  }

  function getPoint(ev){
    const e = getPrimaryEvent(ev);
    const x = typeof e.clientX === 'number' ? e.clientX : 0;
    const y = typeof e.clientY === 'number' ? e.clientY : 0;
    return {x,y};
  }

  function eventToLatLng(ev){
    const e = getPrimaryEvent(ev);
    const cp = map.mouseEventToContainerPoint(e); // needs clientX/Y
    return map.containerPointToLatLng(cp);
  }

  function trigger(ev){
    if (!ev) return;
    // Mozgatás módban a sima kattintás kezeli, longpress ne zavarjon be
    if (moveModeMarkerId) return;

    suppressClickUntil = Date.now() + 800;

    try { if (ev.preventDefault) ev.preventDefault(); } catch(_){ }
    try { if (ev.stopPropagation) ev.stopPropagation(); } catch(_){ }

    const latlngRaw = eventToLatLng(ev);
    const ll = rotatedClickLatLng({ latlng: latlngRaw, originalEvent: ev });
    openModal(ll);
  }

  function onDown(ev){
    // Csak bal gomb / touch / pointer
    if (ev.type === 'mousedown' && ev.button !== 0) return;
    if (ev.type === 'pointerdown') activePointerId = ev.pointerId;

    startPt = getPoint(ev);
    startEvt = ev;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      trigger(startEvt);
      clear();
    }, LONGPRESS_MS);
  }

  function onMove(ev){
    if (!startPt || !timer) return;
    if (ev.type === 'pointermove' && activePointerId !== null && ev.pointerId !== activePointerId) return;

    const p = getPoint(ev);
    const dx = p.x - startPt.x;
    const dy = p.y - startPt.y;
    if ((dx*dx + dy*dy) > (MOVE_TOL_PX*MOVE_TOL_PX)) clear();
  }

  function onUp(ev){
    if (ev && ev.type === 'pointerup' && activePointerId !== null && ev.pointerId !== activePointerId) return;
    clear();
  }

  // Pointer events (Android/modern browsers)
  container.addEventListener('pointerdown', onDown, {passive:false});
  container.addEventListener('pointermove', onMove, {passive:true});
  container.addEventListener('pointerup', onUp, {passive:true});
  container.addEventListener('pointercancel', onUp, {passive:true});

  // Fallback
  container.addEventListener('mousedown', onDown, {passive:true});
  container.addEventListener('mousemove', onMove, {passive:true});
  container.addEventListener('mouseup', onUp, {passive:true});
  container.addEventListener('mouseleave', onUp, {passive:true});

  // Touch fallback (iOS/older)
  container.addEventListener('touchstart', onDown, {passive:false});
  container.addEventListener('touchmove', onMove, {passive:true});
  container.addEventListener('touchend', onUp, {passive:true});
  container.addEventListener('touchcancel', onUp, {passive:true});

  // Prevent long-press context menu on mobile
  container.addEventListener('contextmenu', (e) => {
    if (timer || startPt) {
      try { e.preventDefault(); } catch(_){ }
    }
  }, {passive:false});

  // Suppress synthetic click right after longpress
  map.on('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      try { e.originalEvent && e.originalEvent.preventDefault && e.originalEvent.preventDefault(); } catch(_){ }
      return;
    }
  });
}
