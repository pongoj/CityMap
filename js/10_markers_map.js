// Markerek modul (v5.51.13): popup, térképi rétegek, CRUD kapcsolódó segédek

const markerLayers = new Map();

function idText(id) {
  return "M-" + String(id).padStart(6, "0");
}

function popupHtml(m) {
  const isDeleted = !!m.deletedAt;
  return `
  <div class="cm-popup" style="min-width:240px">
    <div><b>Azonosítószám:</b> ${idText(m.id)}</div>
    <div><b>Cím:</b> ${escapeHtml(m.address)}</div>
    <div><b>Típus:</b> ${escapeHtml(m.typeLabel)}</div>
    <div><b>Állapot:</b> ${escapeHtml(m.statusLabel)}</div>
    <div><b>Megjegyzés:</b> ${m.notes ? escapeHtml(m.notes) : "-"}</div>

    <div style="margin-top:10px">
      <div class="cm-popup-btngrid" role="group" aria-label="Műveletek">
        <button data-move="${m.id}" ${isDeleted ? 'disabled title="A törölt objektum nem mozgatható"' : ''}>Mozgatás</button>
        <button class="btnPhotos" data-uuid="${m.uuid}" data-title="${idText(m.id)}">Fotók (<span id="pc-${m.uuid}">…</span>)</button>
        <button data-edit="${m.id}" ${isDeleted ? 'disabled title="A törölt objektum nem módosítható"' : ''}>Módosítás</button>
        <button data-del="${m.id}">Törlés</button>
      </div>
      ${isDeleted ? '<div class="cm-popup-deleted">TÖRÖLT</div>' : ''}
    </div>
  </div>`;
}


function wirePopupDelete(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(`button[data-del="${dbId}"]`);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      const ok = confirm(
        "Biztosan törlöd ezt a markert? (soft delete)\nA törölt marker később megjeleníthető a szűrés ablakban."
      );
      if (!ok) return;

      await DB.softDeleteMarker(dbId);
      map.removeLayer(marker);
      markerLayers.delete(dbId);

      if (activeMapFilterIds instanceof Set) activeMapFilterIds.delete(Number(dbId));
      updateShowAllButtonVisibility();
    });
  });
}

function wirePopupMove(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(`button[data-move="${dbId}"]`);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const m = await DB.getMarkerById(dbId);
        if (!m || m.deletedAt) {
          alert("A törölt marker nem mozgatható.");
          return;
        }
        // Mozgatás mód: a következő térképkattintás áthelyezi a markert.
        moveModeMarkerId = dbId;
        showHint("Mozgatás: válaszd ki az új helyet a térképen.");
        try { marker.closePopup(); } catch (_) {}
      } catch (err) {
        console.error("move from popup failed", err);
        alert("Nem sikerült betölteni a marker adatait.");
      }
    });
  });
}

function wirePopupEdit(marker, dbId) {
  marker.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(`button[data-edit="${dbId}"]`);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const m = await DB.getMarkerById(dbId);
        if (!m || m.deletedAt) {
          alert("A törölt marker nem módosítható.");
          return;
        }
        openEditModal(m);
      } catch (err) {
        console.error("open edit from popup failed", err);
        alert("Nem sikerült betölteni a marker adatait.");
      }
    });
  });
}

function wirePopupPhotos(marker, m) {
  marker.on("popupopen", async (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const btn = el.querySelector(".btnPhotos");
    const span = el.querySelector(`#pc-${CSS.escape(m.uuid)}`);

    try {
      const cnt = await DB.countPhotosByMarkerUuid(m.uuid);
      if (span) span.textContent = String(cnt);
      if (btn) {
        btn.disabled = cnt === 0;
        btn.title = cnt === 0 ? "Nincs hozzárendelt kép" : "Képek megtekintése";
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openPhotoGallery(m.uuid, btn.getAttribute("data-title") || idText(m.id));
        };
      }
    } catch (err) {
      console.error("photo count error", err);
      if (span) span.textContent = "0";
    }
  });
}

async function getMarker(id) {
  const all = await DB.getAllMarkersActive();
  return all.find(x => x.id === id) || null;
}

function addMarkerToMap(m) {  const mk = L.marker([m.lat, m.lng], { draggable: false, icon: iconForMarker(m, map.getZoom()) }).addTo(map);
mk.__data = m;
  mk.bindPopup(popupHtml(m));
  wirePopupDelete(mk, m.id);
  wirePopupEdit(mk, m.id);
  wirePopupMove(mk, m.id);
  wirePopupPhotos(mk, m);

  markerLayers.set(m.id, mk);

  // v5.15: ha aktív térképi szűrés van, az új marker csak akkor maradjon látható, ha benne van a szűrésben
  if (activeMapFilterIds instanceof Set) {
    if (!activeMapFilterIds.has(Number(m.id))) {
      map.removeLayer(mk);
    }
  }

  updateShowAllButtonVisibility();
}

function refreshAllMarkerIcons() {
  try {
    markerLayers.forEach((mk, id) => {
      const d = mk && mk.__data ? mk.__data : null;
      if (!d) return;
      mk.setIcon(iconForMarker(d, map.getZoom()));
    });
  } catch (e) {
    console.warn('refreshAllMarkerIcons failed', e);
  }
}


