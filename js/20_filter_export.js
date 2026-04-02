// Szűrés + táblázat + Excel export modul (v5.51.13)

/* ===== Filter modal (v5.3) ===== */
let _allMarkersCache = [];
let _lastFilterList = [];

function openFilterModal() {
  photoCountCache.clear();
  const fm = document.getElementById("filterModal");
  if (fm) {
    const mc = fm.querySelector(".modal-content");
    if (mc) { mc.style.transition = ""; mc.style.transform = ""; mc.style.willChange = ""; }
    fm.style.display = "flex";
  }
  document.documentElement.classList.add("filter-modal-open");
  document.body.classList.add("filter-modal-open");
  initFilterDragClose();
  document.getElementById("sfAddress").value = "";

  // újranyitáskor alapból töröljük a kijelöléseket (később átállítható, ha kell)
  selectedFilterMarkerIds = new Set();
  const showBtn = document.getElementById("filterShowBtn");
  if (showBtn) showBtn.disabled = true;
  refreshFilterData().catch(console.error);

  const showDelBtn = document.getElementById("filterShowDeletedBtn");
  if (showDelBtn) {
    updateShowDeletedBtn(showDelBtn);
  }
}

function closeFilterModal() {
  const fm = document.getElementById("filterModal");
  if (fm) {
    const mc = fm.querySelector(".modal-content");
    if (mc) { mc.style.transition = ""; mc.style.transform = ""; mc.style.willChange = ""; }
    fm.style.display = "none";
  }
  document.documentElement.classList.remove("filter-modal-open");
  document.body.classList.remove("filter-modal-open");
  selectedFilterMarkerIds = new Set();
  const showBtn = document.getElementById("filterShowBtn");
  if (showBtn) showBtn.disabled = true;
}

// Mobilon: a szűrés ablak tetején lévő "fogantyú" lehúzásával bezárás
let _filterDragCloseInited = false;
function initFilterDragClose() {
  if (_filterDragCloseInited) return;
  const handle = document.getElementById("filterDragHandle");
  const modal = document.getElementById("filterModal");
  const modalContent = modal ? modal.querySelector(".modal-content") : null;
  if (!handle || !modal || !modalContent) return;

  _filterDragCloseInited = true;

  let startY = 0;
  let currentDY = 0;
  let dragging = false;

  const THRESHOLD_PX = 110;
  const MAX_TRANSLATE_PX = 260;

  const isMobile = () => window.matchMedia && window.matchMedia("(max-width: 640px)").matches;

  const resetTransform = () => {
    modalContent.style.transition = "";
    modalContent.style.transform = "";
  };

  handle.addEventListener("pointerdown", (e) => {
    if (!isMobile()) return;
    if (modal.style.display !== "flex") return;

    dragging = true;
    startY = e.clientY;
    currentDY = 0;

    modalContent.style.transition = "none";
    modalContent.style.willChange = "transform";

    try { handle.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = Math.max(0, e.clientY - startY);
    currentDY = dy;
    modalContent.style.transform = `translateY(${Math.min(dy, MAX_TRANSLATE_PX)}px)`;
    e.preventDefault();
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;

    modalContent.style.transition = "transform 160ms ease";
    modalContent.style.willChange = "";

    if (currentDY >= THRESHOLD_PX) {
      modalContent.style.transform = `translateY(${MAX_TRANSLATE_PX}px)`;
      setTimeout(() => {
        resetTransform();
        closeFilterModal();
      }, 170);
    } else {
      modalContent.style.transform = "translateY(0px)";
      setTimeout(() => resetTransform(), 180);
    }
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  // Biztonság: ha bezárjuk más módon (ESC, overlay click), ne maradjon transform
  window.addEventListener("resize", () => {
    if (!isMobile()) resetTransform();
  });
}


async function fillFilterCombos() {
  // v5.48: szűrés a Beállításokban tárolt típusok/állapotok alapján
  let types = await DB.getAllObjectTypes().catch(() => []) || [];
  let statuses = await DB.getAllObjectStatuses().catch(() => []) || [];
  if (!types || types.length === 0) {
    const base = await DB.getLookup("markerTypes") || [];
    types = base.map((x, i) => ({ id: i + 1, internalId: x.code, type: x.label }));
  }
  if (!statuses || statuses.length === 0) {
    const base = await DB.getLookup("markerStatus") || [];
    statuses = base.map((x, i) => ({ id: i + 1, internalId: x.code, status: x.label }));
  }

  const t = document.getElementById("sfType");
  const s = document.getElementById("sfStatus");
    const n = document.getElementById("sfNotes");

  t.innerHTML = '<option value="">Összes</option>';
  types.forEach(x => {
    const o = document.createElement("option");
    o.value = String(x.id);
    o.textContent = String(x.type || "");
    o.dataset.internalId = String(x.internalId || "");
    t.appendChild(o);
  });

  s.innerHTML = '<option value="">Összes</option>';
  statuses.forEach(x => {
    const o = document.createElement("option");
    o.value = String(x.id);
    o.textContent = String(x.status || "");
    o.dataset.internalId = String(x.internalId || "");
    s.appendChild(o);
  });
}

function updateFilterShowButtonState() {
  // 5.8: a kijelöléshez kötött gombok állapotának frissítése
  const hasSelection = selectedFilterMarkerIds.size > 0;

  const tableHasRows = document.querySelectorAll('#sfList tr').length > 0;

  const showBtn = document.getElementById("filterShowBtn");
const clearBtn = document.getElementById("filterClearSelectionBtn");
  const deleteBtn = document.getElementById("filterDeleteSelectedBtn");
const editBtn = document.getElementById("filterEditBtn");

  // v5.15: Megjelenítés akkor is működjön, ha nincs kijelölés (ilyenkor a táblázat aktuális sorai alapján)
  if (showBtn) showBtn.disabled = !tableHasRows;
  if (clearBtn) clearBtn.disabled = !hasSelection;
  if (deleteBtn) deleteBtn.disabled = !hasSelection;

  // v5.19: Objektum módosítása gomb: pontosan 1 sor kijelölve ÉS nem törölt
  if (editBtn) {
    const selectedRows = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
    if (selectedRows.length !== 1) {
      editBtn.disabled = true;
    } else {
      const tr = selectedRows[0];
      editBtn.disabled = tr.classList.contains('row-deleted');
    }
  }

  
  // v5.29: overlay szerkesztés ikon megjelenítése csak akkor, ha pontosan 1 (nem törölt) sor kijelölt
  const selectedRowsForOverlay = Array.from(document.querySelectorAll('#sfList tr.row-selected'));
  document.querySelectorAll('#sfList .sf-edit-overlay-btn').forEach((b) => (b.style.display = 'none'));
  if (selectedRowsForOverlay.length === 1) {
    const tr = selectedRowsForOverlay[0];
    if (!tr.classList.contains('row-deleted')) {
      const b = tr.querySelector('.sf-edit-overlay-btn');
      if (b) b.style.display = 'flex';
    }
  }
}

function getIdsFromCurrentFilterTable({ includeDeleted = false } = {}) {
  const ids = [];
  document.querySelectorAll('#sfList tr').forEach((tr) => {
    const idStr = tr.dataset.markerId;
    if (!idStr) return;
    if (!includeDeleted && tr.classList.contains('row-deleted')) return;
    const id = Number(idStr);
    if (Number.isFinite(id)) ids.push(id);
  });
  return ids;
}

function applyMapMarkerVisibility(idsToShow) {
  const want = new Set((idsToShow || []).map((x) => Number(x)).filter((x) => Number.isFinite(x)));
  activeMapFilterIds = want.size > 0 ? want : new Set();

  // Minden aktív (térképen létező) markerből csak a kért id-k maradjanak láthatók
  for (const [id, mk] of markerLayers.entries()) {
    const shouldBeVisible = want.has(Number(id));
    const isVisibleNow = map && mk ? map.hasLayer(mk) : false;

    if (shouldBeVisible && !isVisibleNow) {
      mk.addTo(map);
    } else if (!shouldBeVisible && isVisibleNow) {
      map.removeLayer(mk);
    }
  }

  updateShowAllButtonVisibility();
}

// A térkép igazítása a megjelenített markerekhez (szűrés után)
function fitMapToMarkersByIds(idsToShow) {
  if (!map) return;
  const ids = (idsToShow || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (ids.length === 0) return;

  const latlngs = [];
  for (const id of ids) {
    const mk = markerLayers.get(Number(id));
    if (!mk) continue;
    if (typeof mk.getLatLng === "function") {
      latlngs.push(mk.getLatLng());
    }
  }

  if (latlngs.length === 0) return;

  if (latlngs.length === 1) {
    const targetZoom = Math.max(map.getZoom(), 18);
    map.setView(latlngs[0], targetZoom, { animate: true });
    return;
  }

  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18, animate: true });
}

function toggleFilterRowSelection(markerId, trEl) {
  const id = Number(markerId);
  if (!Number.isFinite(id)) return;

  const cb = trEl ? trEl.querySelector('input.row-select') : null;

  if (selectedFilterMarkerIds.has(id)) {
    selectedFilterMarkerIds.delete(id);
    if (trEl) trEl.classList.remove("row-selected");
    if (cb) cb.checked = false;
  } else {
    selectedFilterMarkerIds.add(id);
    if (trEl) trEl.classList.add("row-selected");
    if (cb) cb.checked = true;
  }
  updateFilterShowButtonState();
}

function selectOnlyFilterRow(markerId, trEl) {
  const id = Number(markerId);
  if (!Number.isFinite(id)) return;

  // v5.30.3: ha már pontosan ez az egy van kijelölve és újra rákattintunk,
  // akkor vegyük vissza a kijelölést (toggle off).
  if (selectedFilterMarkerIds.size === 1 && selectedFilterMarkerIds.has(id)) {
    clearAllFilterSelections();
    return;
  }

selectedFilterMarkerIds.clear();
  document.querySelectorAll('#sfList tr.row-selected').forEach(tr => tr.classList.remove('row-selected'));
  document.querySelectorAll('#sfList input.row-select').forEach(cb => cb.checked = false);

  selectedFilterMarkerIds.add(id);
  if (trEl) {
    trEl.classList.add('row-selected');
    const cb = trEl.querySelector('input.row-select');
    if (cb) cb.checked = true;
  }

  updateFilterShowButtonState();
}

function clearAllFilterSelections() {
  selectedFilterMarkerIds.clear();
  document.querySelectorAll('#sfList tr.row-selected').forEach(tr => tr.classList.remove('row-selected'));
  document.querySelectorAll('#sfList input.row-select').forEach(cb => cb.checked = false);
  updateFilterShowButtonState();
}


function formatGps(m) {
  if (!m) return "";
  const lat = Number(m.lat);
  const lng = Number(m.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return lat.toFixed(6) + ", " + lng.toFixed(6);
}

function renderFilterList(list) {
const tb = document.getElementById("sfList");
  tb.innerHTML = "";
  _lastFilterList = Array.isArray(list) ? list.slice() : [];
  list.forEach(m => {
    const tr = document.createElement("tr");
    tr.dataset.markerId = String(m.id);
	tr.dataset.markerUuid = String(m.uuid || "");
	    if (selectedFilterMarkerIds.has(m.id)) {
	      tr.classList.add("row-selected");
	    }
	    // Soft delete: törölt sorok vizuális jelölése
	    if (m.deletedAt || m.deleted) {
	      tr.classList.add("row-deleted");
	    }
    tr.innerHTML = `
      <td style="text-align:center;"><input class="row-select" type="checkbox" ${selectedFilterMarkerIds.has(m.id) ? 'checked' : ''}></td>
      <td class="sf-photo-cell">
        <button class="sf-photo-btn" type="button" title="Fotók" aria-label="Fotók" disabled>
          <svg class="ico" aria-hidden="true"><use href="#i-camera"></use></svg>
        </button>
      </td>
      <td>${escapeHtml(m.address)}</td>
      <td>${escapeHtml(m.typeLabel)}</td>
      <td>${escapeHtml(m.statusLabel)}</td>
      <td>${escapeHtml(m.notes || "")}</td>
      <td class="sf-gps-cell">${escapeHtml(formatGps(m))}</td>
      <td class="sf-id-cell">
        <span class="sf-id-text">${idText(m.id)}</span>
        <button class="sf-edit-overlay-btn" type="button" title="Objektum módosítása" aria-label="Objektum módosítása">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-edit"></use></svg>
        </button>
      </td>
`;

	    // Checkbox: többszörös kijelölés (nem törli a többit)
	    const cb = tr.querySelector('input.row-select');
	    if (cb) {
	      cb.addEventListener('click', (ev) => ev.stopPropagation());
	      cb.addEventListener('change', (ev) => {
	        ev.stopPropagation();
	        const markerId = tr.dataset.markerId;
	        if (!markerId) return;
	        toggleFilterRowSelection(markerId, tr);
	      });
	
	    // v5.29: overlay "Objektum módosítása" ikon az ID mezőn (csak 1 kijelölésnél fog látszani)
	    const overlayEditBtn = tr.querySelector('.sf-edit-overlay-btn');
	    if (overlayEditBtn) {
	      overlayEditBtn.addEventListener('click', async (ev) => {
	        ev.stopPropagation();
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
	    

        // v5.30: fotó ikon oszlop (a bal oldali "Fotók" gomb kiváltása)
        const photoBtn = tr.querySelector('.sf-photo-btn');
        const uuid = String(tr.dataset.markerUuid || "");
        if (photoBtn) {
          // kattintás: galéria megnyitása az adott markerhez (kijelölést nem módosít)
          photoBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const id = Number(tr.dataset.markerId);
            if (!Number.isFinite(id)) return;
            try {
              const marker = await DB.getMarkerById(id);
              if (!marker) return;
              // ugyanazt a galéria megnyitót használjuk, mint eddig a "Fotók" gomb
              openPhotoGalleryForMarker(marker);
            } catch (e) {
              console.error("openPhotoGalleryForMarker failed", e);
              alert("Nem sikerült megnyitni a fotókat.");
            }
          });

          // engedélyezés/halványítás fotószám alapján
          getPhotoCountCached(uuid).then((cnt) => {
            const has = Number(cnt) > 0;
            photoBtn.disabled = !has;
          });
        }
}

    }

	    // 1 kattintás: kijelölés (több sor is lehet)
	    tr.addEventListener("click", (ev) => {
	      ev.stopPropagation();
	      const markerId = tr.dataset.markerId;
	      if (!markerId) return;
	      selectOnlyFilterRow(markerId, tr);
	    });

	    // dupla kattintás: ugrás a markerre + ablak bezárása
	    tr.addEventListener("dblclick", (ev) => {
	      ev.stopPropagation();
	      // Törölt elemre ne ugorjunk / ne zárjuk be a szűrés ablakot
	      const markerId = tr.dataset.markerId;
	      if (markerId) {
	        // biztos kijelölés a duplakattnál is (egykijelölés)
	      selectOnlyFilterRow(markerId, tr);
	      }
	      // ha törölt (soft delete), akkor ne zárjuk be a modalt
	      if (tr.classList.contains("row-deleted")) return;
	      const id = Number(tr.dataset.markerId);
	      const mk = markerLayers.get(id);
	      if (mk) {
	        const ll = mk.getLatLng();
	        map.setView(ll, Math.max(map.getZoom(), 18));
	        mk.openPopup();
	        closeFilterModal();
	      }
	    });
    tb.appendChild(tr);
  });
	  updateFilterShowButtonState();
}


function updateHeaderFilterIndicators() {
  const aVal = (document.getElementById("sfAddress")?.value || "").trim();
  const tVal = (document.getElementById("sfType")?.value || "").trim();
  const sVal = (document.getElementById("sfStatus")?.value || "").trim();
  const nVal = (document.getElementById("sfNotes")?.value || "").trim();

  const addrTh = document.getElementById("sfAddressTh");
  const typeTh = document.getElementById("sfTypeTh");
  const statusTh = document.getElementById("sfStatusTh");
  const notesTh = document.getElementById("sfNotesTh");

  if (addrTh) addrTh.classList.toggle("active", aVal.length > 0);
  if (typeTh) typeTh.classList.toggle("active", tVal.length > 0);
  if (statusTh) statusTh.classList.toggle("active", sVal.length > 0);
  if (notesTh) notesTh.classList.toggle("active", nVal.length > 0);
}

// ---------------------------
// Excel export (Filter table)
// ---------------------------
function csvEscape(val, delim) {
  const s = (val === null || val === undefined) ? "" : String(val);
  const needs = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delim);
  if (!needs) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildFilterCsv(rows) {
  const delim = ';'; // HU locale friendly (Excel)
  const header = ["Cím", "Típus", "Állapot", "Megjegyzés", "GPS", "ID", "Törölt"];
  const lines = [];
  lines.push(header.map(h => csvEscape(h, delim)).join(delim));

  (rows || []).forEach((m) => {
    const deleted = (m && (m.deletedAt || m.deleted)) ? "IGEN" : "";
    const gps = formatGps(m);
    const line = [
      m?.address || "",
      m?.typeLabel || "",
      m?.statusLabel || "",
      m?.notes || "",
      gps || "",
      idText(m?.id),
      deleted
    ];
    lines.push(line.map(v => csvEscape(v, delim)).join(delim));
  });

  // UTF-8 BOM, so Excel reads accents correctly
  return '\ufeff' + lines.join('\r\n');
}

async function exportFilterTableToExcel() {
  try {
    const rows = Array.isArray(_lastFilterList) ? _lastFilterList : [];
    const csv = buildFilterCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

    const fn = `CityMap_export_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;

    // Prefer Save As dialog if available (Chromium)
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fn,
        types: [{ description: "CSV (Excel)", accept: { "text/csv": [".csv"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    // Fallback: normal download (browser will ask location depending on settings)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    // User cancelled the save dialog -> do nothing
    if (err && (err.name === "AbortError" || String(err.message || "").toLowerCase().includes("abort"))) {
      return;
    }
    console.error("Excel export failed", err);
    alert("Nem sikerült exportálni a táblázatot.");
  }
}

function applyFilter() {
  const a = (document.getElementById("sfAddress")?.value || "").trim().toLowerCase();
  const n = (document.getElementById("sfNotes")?.value || "").trim().toLowerCase();

  const typeSel = document.getElementById("sfType");
  const statusSel = document.getElementById("sfStatus");

  const tId = Number((typeSel?.value || "").trim());
  const sId = Number((statusSel?.value || "").trim());
  const hasType = Number.isFinite(tId) && tId > 0;
  const hasStatus = Number.isFinite(sId) && sId > 0;
  const tInternal = (hasType && typeSel && typeSel.selectedIndex >= 0)
    ? (typeSel.options[typeSel.selectedIndex]?.dataset?.internalId || "")
    : "";
  const sInternal = (hasStatus && statusSel && statusSel.selectedIndex >= 0)
    ? (statusSel.options[statusSel.selectedIndex]?.dataset?.internalId || "")
    : "";

  const res = (_allMarkersCache || []).filter((m) => {
    const addr = String(m?.address || "").toLowerCase();

    const typeOk = !hasType || (Number(m?.typeId) === tId) || (!!tInternal && (String(m?.typeInternalId || m?.type || "") === String(tInternal)));
    const statusOk = !hasStatus || (Number(m?.statusId) === sId) || (!!sInternal && (String(m?.statusInternalId || m?.status || "") === String(sInternal)));

    const addrOk = !a || addr.includes(a);
    const notes = String(m?.notes || "").toLowerCase();
    const notesOk = !n || notes.includes(n);

    return addrOk && typeOk && statusOk && notesOk;
  });

  updateHeaderFilterIndicators();
  renderFilterList(res);
}
