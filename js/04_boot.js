document.addEventListener("DOMContentLoaded", async () => {
  window.addEventListener("online", checkForUpdateOnline);
  updateAppVersionUI();
  registerSW();
  checkForUpdateOnline();

  // Induláskor ellenőrizzük, hogy engedélyezve van-e a helymeghatározás.
  // (Ez nem kér engedélyt automatikusan, csak tájékoztat.)
  await checkGeolocationPermissionOnStartup();

  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  // v5.51.7: a felső toolbar gombjainál a touch ne indítson térkép-drag-et.
  // (különben a követés kikapcsol, és úgy tűnik, hogy a nav mód "nem működik")
  try {
    const tb = document.querySelector('.toolbar');
    if (tb && window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(tb);
      L.DomEvent.disableScrollPropagation(tb);
    }
  } catch (_) {}

  // v5.42.2: iránytű indítás (ha elérhető)
  startCompassIfPossible();
  scheduleApplyNavBearing();


  // v5.40: ha a felhasználó kézzel mozgatja/zoomolja a térképet, kikapcsoljuk a GPS-követést.
  // A "Saját helyem" gomb visszakapcsolja.
  map.on("dragstart", () => { myLocFollowEnabled = false; try { updateMyLocFabVisibility(); } catch (_) {} });
  map.on("zoomstart", () => { myLocFollowEnabled = false; try { updateMyLocFabVisibility(); } catch (_) {} });
  map.on("moveend", () => updateMyLocFabVisibility());
  map.on("zoomend", () => updateMyLocFabVisibility());


  await DB.init();

  // DB migrations / safety cleanups (uuid backfill, invalid photo rows)
  await DB.backfillMarkerMeta();
  await DB.cleanInvalidPhotos();

  await fillLookups();
  // v5.50: Táblázatos Típus/Állapot választó
  const fTypeBtn = document.getElementById('fTypeBtn');
  if (fTypeBtn) fTypeBtn.addEventListener('click', (e) => { e.preventDefault(); if (!fTypeBtn.disabled) openPickPanel('type', fTypeBtn); });
  const fStatusBtn = document.getElementById('fStatusBtn');
  if (fStatusBtn) fStatusBtn.addEventListener('click', (e) => { e.preventDefault(); if (!fStatusBtn.disabled) openPickPanel('status', fStatusBtn); });


  document.getElementById("btnCancel").addEventListener("click", closeModal);
  document.getElementById("btnSave").addEventListener("click", saveMarker);

  // v5.11: fénykép hozzárendelése (kamera / tallózás)
  const btnAttachPhoto = document.getElementById("btnAttachPhoto");
  const photoInput = document.getElementById("photoInput");
  if (btnAttachPhoto && photoInput) {
    btnAttachPhoto.addEventListener("click", () => {
      if (!currentDraftUuid) {
        draftHasSaved = false;
        currentDraftUuid = genUuid();
      }
      photoInput.value = "";
      photoInput.click();
    });

    photoInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      for (const f of files) {
        try {
          await DB.addPhoto(currentDraftUuid, f);
        } catch (err) {
          console.error("Photo save failed", err);
        }
      }
      await updateAttachPhotoLabel();
    });
  }
  const btnMyLocFab = document.getElementById("btnMyLocFab");
if (btnMyLocFab) {
  btnMyLocFab.addEventListener("click", async () => {
    // Saját hely középre (Google Maps-szerű gomb)
    try { await requestCompassPermissionIfNeeded(); } catch (_) {}
    startCompassIfPossible();
    myLocFollowEnabled = true;

    const ok = await centerToMyLocation();
    if (!ok) {
      alert(
	        "Nem sikerült lekérni a pozíciót.\n\n" +
	        "Ellenőrizd, hogy engedélyezve van-e a helymeghatározás, és hogy van-e GPS/jel."
      );
    }
    updateMyLocFabVisibility();
  });
}


  

// v5.41: Navigáció mód váltó gomb (észak felül / haladási irány – kompromisszumos "lite")
const navBtn = document.getElementById("btnNavMode");
if (navBtn) {
  const syncNavBtn = () => {
    const isLite = (navMode === "heading");
    navBtn.classList.toggle("nav-heading", isLite);
    navBtn.title = isLite ? "Navigáció: haladási irány" : "Navigáció: észak felül";
    navBtn.setAttribute("aria-label", navBtn.title);
  };
  syncNavBtn();

  // v5.51.7: mobilon a gombnyomás ne indítson térkép-drag-et (különben a követés kikapcsol).
  try {
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(navBtn);
      L.DomEvent.disableScrollPropagation(navBtn);
    }
  } catch (_) {}
  ["touchstart","pointerdown","mousedown"].forEach((ev) => {
    try { navBtn.addEventListener(ev, (e) => { try { e.stopPropagation(); } catch (_) {} }, { passive: true }); } catch (_) {}
  });


  navBtn.addEventListener("click", async () => {
    navMode = (navMode === "heading") ? "north" : "heading";
    try { localStorage.setItem("citymap_nav_mode", navMode); } catch (_) {}
    syncNavBtn();

    // v5.51.7: lite módra váltáskor rövid ideig "force" az eltolás, hogy azonnal látszódjon.
    navForceUntilTs = (navMode === "heading") ? (Date.now() + 4000) : 0;

    // Mindkét mód váltáskor: követés bekapcsol és saját hely középre
    myLocFollowEnabled = true;

    // Iránytű indítása (Androidon általában prompt nélkül működik)
    try { await requestCompassPermissionIfNeeded(); } catch (_) {}
    startCompassIfPossible();

    // Mindig középre rakjuk a saját helyet gombnyomásra (mindkét módban)
    try {
      await centerToMyLocation();
    } catch (_) {}

    // Azonnali vizuális váltás: ha van friss pozíciónk, a kiválasztott mód szerint
    // állítsuk be a követés cél-centerét (lite módban előretolás).
    try {
      if (map && lastMyLocation) {
        const sp = (typeof lastSpeedMps === "number" && isFinite(lastSpeedMps)) ? lastSpeedMps : NaN;
        const accM = (lastRawMyLocation && typeof lastRawMyLocation.acc === "number") ? lastRawMyLocation.acc : 999999;
        const desired = desiredFollowCenter(lastMyLocation.lat, lastMyLocation.lng, sp, accM);
        lastMyLocCenterTs = Date.now();
        map.panTo([desired.lat, desired.lng], {
          animate: true,
          duration: GPS_CENTER_ANIM_S,
          easeLinearity: 0.25,
        });
      }
    } catch (_) {}


    // Forgatás/irány alkalmazása a kiválasztott navigáció mód szerint
    scheduleApplyNavBearing();

    // frissítsük az alsó "Középre" gomb láthatóságát is
    try { updateMyLocFabVisibility(); } catch (_) {}
  });
}

  document.getElementById("btnClear").addEventListener("click", async () => {
    if (!confirm("Biztosan törlöd az összes markert?")) return;
    await DB.clearMarkers();
    for (const mk of markerLayers.values()) map.removeLayer(mk);
    markerLayers.clear();
    activeMapFilterIds = null;
    updateShowAllButtonVisibility();
  });
  map.on("click", async (e) => {
    // Ha marker mozgatás mód aktív, akkor a kattintás az új pozíció
    if (moveModeMarkerId) {
      const ll = rotatedClickLatLng(e);
      const id = moveModeMarkerId;
      moveModeMarkerId = null;
      try {
        await DB.updateMarker(id, { lat: ll.lat, lng: ll.lng, updatedAt: Date.now() });
        const mk = markerLayers.get(id);
        if (mk) {
          mk.setLatLng([ll.lat, ll.lng]);
          const updated = await getMarker(id);
          if (updated) {
            mk.__data = updated;
            mk.setIcon(resizedIconForMarker(updated, map.getZoom()));
            mk.setPopupContent(popupHtml(updated));
          }
        }
        showHint("Objektum áthelyezve.");
      } catch (err) {
        console.error("move marker failed", err);
        alert("Nem sikerült áthelyezni az objektumot.");
      }
      return;
    }
  });


  // v5.44: Új objektum felvitele csak hosszú nyomásra (mobilon is)
  (function setupLongPressAddObject(){
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

      try { if (ev.preventDefault) ev.preventDefault(); } catch(_){}
      try { if (ev.stopPropagation) ev.stopPropagation(); } catch(_){}

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
        try { e.preventDefault(); } catch(_){}
      }
    }, {passive:false});

    // Suppress synthetic click right after longpress
    map.on('click', (e) => {
      if (Date.now() < suppressClickUntil) {
        try { e.originalEvent && e.originalEvent.preventDefault && e.originalEvent.preventDefault(); } catch(_){}
        return;
      }
    });
  })();
  const ok = await centerToMyLocation();
  if (!ok) map.setView([47.4979, 19.0402], 15);

  await loadMarkers();
  
  map.on("zoomend", () => {
  const z = map.getZoom();
  markerLayers.forEach((mk, id) => {
    const data = mk.__data;
    if (!data) return;
    mk.setIcon(resizedIconForMarker(data, z));
  });
});

  document.getElementById("btnFilter").addEventListener("click", () => {
    // Ha épp térképi megjelenítés-szűrés aktív (csak kijelöltek / táblázat tartalma),
    // akkor a Szűrés gomb úgy viselkedjen, mintha "Összes megjelenítése" történt volna.
    if (isMapFiltered()) showAllMarkersAndFit();
    openFilterModal();
  });
  document.getElementById("btnFilterClose").addEventListener("click", closeFilterModal);
  initFilterDragClose();

  const btnSettings = document.getElementById("btnSettings");
  if (btnSettings) btnSettings.addEventListener("click", openSettingsModal);
  const btnSettingsClose = document.getElementById("btnSettingsClose");
  if (btnSettingsClose) btnSettingsClose.addEventListener("click", closeSettingsModal);

  // oldalsó menü kattintás
  document.querySelectorAll("#settingsModal .settings-nav-item").forEach((b) => {
    b.addEventListener("click", () => setSettingsPage(b.dataset.page));
  });

  // overlay kattintás: csak ha a háttérre kattint (nem a tartalomra)
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  const btnShowAll = document.getElementById("btnShowAll");
  if (btnShowAll) {
    btnShowAll.addEventListener("click", () => {
      showAllMarkersAndFit();
      showHint("Összes marker megjelenítve.");
    });
  }

    const showBtn = document.getElementById("filterShowBtn");
  if (showBtn) {
    showBtn.disabled = true;
    showBtn.addEventListener("click", () => {
      // v5.15: Megjelenítés
      // - ha van kijelölés: csak a kijelölt (nem törölt) markerek maradjanak a térképen
      // - ha nincs kijelölés: a táblázat aktuális (szűrt) tartalma alapján

      const selectedIds = Array.from(selectedFilterMarkerIds)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));

      let idsToShow = [];
      if (selectedIds.length > 0) {
        // törölt elemeket ne próbáljuk megjeleníteni (amúgy sincsenek a térképen)
        const deletedInSelection = new Set(
          Array.from(document.querySelectorAll('#sfList tr.row-selected.row-deleted'))
            .map((tr) => Number(tr.dataset.markerId))
            .filter((x) => Number.isFinite(x))
        );
        idsToShow = selectedIds.filter((id) => !deletedInSelection.has(id));

        // Ha csak törölt elemek vannak kijelölve, akkor ne zárjuk be az ablakot
        if (idsToShow.length === 0) {
          showHint("Nem lehet megjeleníteni a törölt markereket.");
          return;
        }

        if (deletedInSelection.size > 0) {
          showHint("A törölt markereket nem lehet megjeleníteni – kihagyva.");
        }
      } else {
        idsToShow = getIdsFromCurrentFilterTable({ includeDeleted: false });
        if (idsToShow.length === 0) {
          showHint("Nincs megjeleníthető (nem törölt) marker a listában.");
          return;
        }
      }

      applyMapMarkerVisibility(idsToShow);
      // A térkép legyen úgy méretezve, hogy az összes megjelenített marker látszódjon
      fitMapToMarkersByIds(idsToShow);
      closeFilterModal();
    });
  }

  const clearBtn = document.getElementById("filterClearSelectionBtn");
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.addEventListener("click", clearAllFilterSelections);
  }

  const clearIconBtn = document.getElementById("filterClearSelectionIconBtn");
  if (clearIconBtn) {
    clearIconBtn.addEventListener("click", (e) => { e.preventDefault(); clearAllFilterSelections(); });
  }
  const editBtn = document.getElementById("filterEditBtn");
  if (editBtn) {
    editBtn.disabled = true;
    editBtn.addEventListener("click", async () => {
      const rows = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
      if (rows.length !== 1) return;

      const tr = rows[0];
      if (tr.classList.contains('row-deleted')) return;

      const id = Number(tr.dataset.markerId);
      if (!Number.isFinite(id)) return;

      try {
        const m = await DB.getMarkerById(id);
        if (!m || m.deletedAt) {
          showHint("A törölt marker nem módosítható.");
          return;
        }
        closeFilterModal();
        openEditModal(m);
      } catch (err) {
        console.error("filter edit open failed", err);
        alert("Nem sikerült betölteni a marker adatait.");
      }
    });
  }

  const deleteBtn = document.getElementById("filterDeleteSelectedBtn");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.addEventListener("click", async () => {
      const ids = Array.from(selectedFilterMarkerIds)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));

      if (ids.length === 0) {
        alert("Nincs kijelölt sor.");
        return;
      }

      const count = ids.length;
      const ok = confirm(
        `Biztosan törlöd (soft delete) a kijelölt ${count} db marker(eke)t? A töröltek később megjeleníthetők.`
      );
      if (!ok) return;

      try {
        // Törlés az adatbázisból (soft delete) + eltávolítás a térképről
        for (const id of ids) {
          await DB.softDeleteMarker(id);

          const leafletMarker = markerLayers.get(id);
          if (leafletMarker) {
            map.removeLayer(leafletMarker);
            markerLayers.delete(id);
          }

          if (activeMapFilterIds instanceof Set) activeMapFilterIds.delete(Number(id));
        }

        updateShowAllButtonVisibility();

        // UI frissítés: cache frissítés + kiválasztások törlése + táblázat újraszűrése
        // (különben törlés után a táblázatban még látszódhatnak sorok a cache miatt)
        _allMarkersCache = filterShowDeleted ? await DB.getAllMarkers() : await DB.getAllMarkersActive();
        selectedFilterMarkerIds.clear();
        updateFilterShowButtonState();
        applyFilter();
      } catch (e) {
        console.error(e);
        alert("Hiba történt a törlés közben.");
      }
    });
  }
  const showDeletedBtn = document.getElementById("filterShowDeletedBtn");
  if (showDeletedBtn) {
    showDeletedBtn.addEventListener("click", async () => {
      filterShowDeleted = !filterShowDeleted;
      updateShowDeletedBtn(showDeletedBtn);
      clearAllFilterSelections();
      await refreshFilterData();
    });
  }

  const excelBtn = document.getElementById("filterExcelBtn");
  if (excelBtn) {
    excelBtn.disabled = false;
    excelBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      exportFilterTableToExcel();
    });
  }

  document.getElementById("sfAddress").addEventListener("input", applyFilter);
  document.getElementById("sfType").addEventListener("change", applyFilter);
  document.getElementById("sfStatus").addEventListener("change", applyFilter);
  const sfNotesEl = document.getElementById("sfNotes");
  if (sfNotesEl) sfNotesEl.addEventListener("input", applyFilter);

  // v5.31: Szűrők az oszlopfejlécben (felugró input/select)
  const popIds = ["sfAddressPop", "sfTypePop", "sfStatusPop", "sfNotesPop"];
  function closeHeaderFilterPops() {
    popIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("open");
    });
  }

  function togglePop(popId, focusElId) {
    const pop = document.getElementById(popId);
    if (!pop) return;
    const willOpen = !pop.classList.contains("open");
    closeHeaderFilterPops();
    if (willOpen) {
      pop.classList.add("open");
      const f = document.getElementById(focusElId);
      if (f && typeof f.focus === "function") setTimeout(() => f.focus(), 0);
    }
  }

  const bAddr = document.getElementById("sfAddressFilterBtn");
  if (bAddr) bAddr.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfAddressPop", "sfAddress"); });
  const bType = document.getElementById("sfTypeFilterBtn");
  if (bType) bType.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfTypePop", "sfType"); });
  const bStatus = document.getElementById("sfStatusFilterBtn");
  if (bStatus) bStatus.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfStatusPop", "sfStatus"); });
  const bNotes = document.getElementById("sfNotesFilterBtn");
  if (bNotes) bNotes.addEventListener("click", (e) => { e.stopPropagation(); togglePop("sfNotesPop", "sfNotes"); });

  popIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", (e) => e.stopPropagation());
  });

  document.addEventListener("click", closeHeaderFilterPops);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeHeaderFilterPops();
  });

  // Modal bezáráskor is zárjuk a felugrókat
  const btnFilterClose = document.getElementById("btnFilterClose");
  if (btnFilterClose) btnFilterClose.addEventListener("click", closeHeaderFilterPops);

  const sfClearBtn = document.getElementById("sfClearAllFiltersBtn");
  if (sfClearBtn) sfClearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const a = document.getElementById("sfAddress");
    const t = document.getElementById("sfType");
    const s = document.getElementById("sfStatus");
    const n = document.getElementById("sfNotes");
    if (a) a.value = "";
    if (t) t.value = "";
    if (s) s.value = "";
    if (n) n.value = "";
    closeHeaderFilterPops();
    applyFilter();
  });

});
