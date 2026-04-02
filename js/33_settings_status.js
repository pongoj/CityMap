// Settings: Objektum állapota (v5.47)
// (moved out from former 05_misc.js)

let _objectStatusesCache = [];
let _objectStatusesUiWired = false;

function renderSettingsObjectStatusesPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;

  container.innerHTML = `
    <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div class="small" style="color:#666;">Oszlopok: Azonosító, Belső azonosító, Állapot, Leírás</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-save" id="btnAddObjectStatus" type="button">Új sor</button>
      </div>
    </div>

    <div class="settings-table-wrap" style="margin-top:10px;">
      <table class="sf-table" id="objectStatusesTable" style="min-width:760px;">
        <thead>
          <tr>
            <th style="width:120px;">Azonosító</th>
            <th style="width:160px;">Belső azonosító</th>
            <th style="width:240px;">Állapot *</th>
            <th style="width:300px;">Leírás</th>
          </tr>
        </thead>
        <tbody id="objectStatusesTbody"></tbody>
      </table>
    </div>
  `;

  if (!_objectStatusesUiWired) {
    _objectStatusesUiWired = true;

    // delegált input
    container.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-os-id]");
      if (!tr) return;
      markRowDirty(tr);
    });

    // mentés blur-re
    container.addEventListener(
      "blur",
      async (e) => {
        const tr = e.target.closest("tr[data-os-id]");
        if (!tr) return;
        await saveObjectStatusRow(tr);
      },
      true
    );

    container.addEventListener("click", async (e) => {
      // Új sor
      const addBtn = e.target.closest("#btnAddObjectStatus");
      if (addBtn) {
        await DB.init();
        const newRec = {
          internalId: "",
          status: "",
          description: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const id = await DB.addObjectStatus(newRec);
        showHint("Új sor létrehozva.");
        await loadAndRenderObjectStatuses({ focusId: id });
        return;
      }

      // Törlés
      const btn = e.target.closest("button[data-action='delete-os']");
      if (btn) {
        const tr = btn.closest("tr[data-os-id]");
        if (!tr) return;
        const id = Number(tr.dataset.osId);
        if (!Number.isFinite(id)) return;
        if (!confirm("Biztosan törlöd ezt az állapotot?")) return;
        await DB.deleteObjectStatus(id);
        showHint("Állapot törölve.");
        await loadAndRenderObjectStatuses();
        return;
      }
    });
  }

  loadAndRenderObjectStatuses();
}

function readObjectStatusRow(tr) {
  const id = Number(tr.dataset.osId);
  const internalId = (tr.querySelector("input[data-field='internalId']")?.value || "").trim();
  const status = (tr.querySelector("input[data-field='status']")?.value || "").trim();
  const description = (tr.querySelector("input[data-field='description']")?.value || "").trim();
  return { id, internalId, status, description };
}

function validateObjectStatus(rec) {
  if (rec.internalId && rec.internalId.length > 10) return "A 'Belső azonosító' max 10 karakter.";
  if (!rec.status) return "Az 'Állapot' mező kötelező.";
  if (rec.status.length > 30) return "Az 'Állapot' max 30 karakter.";
  if (rec.description && rec.description.length > 50) return "A 'Leírás' max 50 karakter.";
  return null;
}

async function saveObjectStatusRow(tr) {
  const isDirty = tr.dataset.dirty === "1";
  if (!isDirty) return;

  const rec = readObjectStatusRow(tr);
  const err = validateObjectStatus(rec);
  if (err) {
    showHint(err);
    return;
  }

  await DB.init();
  await DB.updateObjectStatus(rec.id, {
    internalId: rec.internalId,
    status: rec.status,
    description: rec.description,
    updatedAt: Date.now(),
  });
  tr.dataset.dirty = "0";
  // v5.50: színváltozás azonnal hasson a markerekre
  try { _objectTypesCache = await DB.getAllObjectTypes(); setTypeMetaCache(_objectTypesCache); } catch (_) {}
  refreshAllMarkerIcons();
}

async function loadAndRenderObjectStatuses(opts = {}) {
  await DB.init();
  _objectStatusesCache = await DB.getAllObjectStatuses();
  renderObjectStatusesTable();
  if (opts.focusId) {
    const el = document.querySelector(
      `#objectStatusesTbody tr[data-os-id='${opts.focusId}'] input[data-field='status']`
    );
    if (el) el.focus();
  }
}

function renderObjectStatusesTable() {
  const tb = document.getElementById("objectStatusesTbody");
  if (!tb) return;
  tb.innerHTML = "";

  _objectStatusesCache.forEach((rec) => {
    const tr = document.createElement("tr");
    tr.dataset.osId = rec.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${escapeHtml(rec.id)}</span>
          <button class="btn btn-ghost" type="button" data-action="delete-os" style="padding:4px 8px;">🗑</button>
        </div>
      </td>
      <td><input data-field="internalId" type="text" maxlength="10" value="${escapeHtml(rec.internalId || "")}" style="width:100%;"/></td>
      <td><input data-field="status" type="text" maxlength="30" value="${escapeHtml(rec.status || "")}" style="width:100%;" placeholder="pl. Új"/></td>
      <td><input data-field="description" type="text" maxlength="50" value="${escapeHtml(rec.description || "")}" style="width:100%;"/></td>
    `;
    tb.appendChild(tr);
  });
}
async function refreshFilterData() {
  _allMarkersCache = filterShowDeleted
    ? await DB.getAllMarkers()
    : await DB.getAllMarkersActive();
  await fillFilterCombos();
  applyFilter();
}

