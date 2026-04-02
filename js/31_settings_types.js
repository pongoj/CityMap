// Settings: Objektum típusa (v5.21)
// (moved out from former 05_misc.js)

let _objectTypesCache = [];
let _objectTypesUiWired = false;

function renderSettingsObjectTypesPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;

  container.innerHTML = `
    <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div class="small" style="color:#666;">Oszlopok: Azonosító, Belső azonosító, Típus, Leírás, Szín</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-save" id="btnAddObjectType" type="button">Új sor</button>
      </div>
    </div>

    <div class="settings-table-wrap" style="margin-top:10px;">
      <table class="sf-table" id="objectTypesTable" style="min-width:900px;">
        <thead>
          <tr>
            <th style="width:120px;">Azonosító</th>
            <th style="width:160px;">Belső azonosító</th>
            <th style="width:220px;">Típus *</th>
            <th style="width:260px;">Leírás</th>
            <th style="width:140px;">Szín</th>
          </tr>
        </thead>
        <tbody id="objectTypesTbody"></tbody>
      </table>
    </div>
  `;

  if (!_objectTypesUiWired) {
    _objectTypesUiWired = true;


    // delegált eseménykezelés (minden input/select)
    container.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      markRowDirty(tr);
    });
    container.addEventListener("change", async (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      // pl. rejtett szín input csak change eseményt kap
      markRowDirty(tr);
      await saveObjectTypeRow(tr);
    });
    container.addEventListener("blur", async (e) => {
      const tr = e.target.closest("tr[data-ot-id]");
      if (!tr) return;
      await saveObjectTypeRow(tr);
    }, true);
    container.addEventListener("click", async (e) => {
      // Új sor (delegált, mert a jobb oldal újrarenderelődik lapváltáskor)
      const addBtn = e.target.closest("#btnAddObjectType");
      if (addBtn) {
        await DB.init();
        const newRec = {
          internalId: "",
          type: "",
          description: "",
          color: "#22c55e",
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        const id = await DB.addObjectType(newRec);
        showHint("Új sor létrehozva.");
        await loadAndRenderObjectTypes({ focusId: id });
        return;
      }

      // Sor törlése
      const btn = e.target.closest("button[data-action='delete-ot']");
      if (btn) {
        const tr = btn.closest("tr[data-ot-id]");
        if (!tr) return;
        const id = Number(tr.dataset.otId);
        if (!Number.isFinite(id)) return;
        if (!confirm("Biztosan törlöd ezt a típust?")) return;
        await DB.deleteObjectType(id);
        showHint("Típus törölve.");
        await loadAndRenderObjectTypes();
        return;
      }

      // Szín gomb (v5.23.2): közvetlen, egyetlen "Színek szerkesztése" ablak
      const colorBtn = e.target.closest("button.color-btn");
      if (colorBtn) {
        const tr = colorBtn.closest("tr[data-ot-id]");
        if (!tr) return;
        const input = tr.querySelector("input[data-field='color']");
        if (!input) return;
        openColorsEditorDialog(String(input.value || "#22c55e"), (hex) => {
          input.value = hex;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          markRowDirty(tr);
        });
        return;
      }
    });
  }

  loadAndRenderObjectTypes();
}

function markRowDirty(tr) {
  tr.dataset.dirty = "1";
}

function readObjectTypeRow(tr) {
  const id = Number(tr.dataset.otId);
  const internalId = (tr.querySelector("input[data-field='internalId']")?.value || "").trim();
  const type = (tr.querySelector("input[data-field='type']")?.value || "").trim();
  const description = (tr.querySelector("input[data-field='description']")?.value || "").trim();
  const color = tr.querySelector("input[data-field='color']")?.value || "#22c55e";
  return { id, internalId, type, description, color };
}

function validateObjectType(rec) {
  if (rec.internalId && rec.internalId.length > 10) return "A 'Belső azonosító' max 10 karakter.";
  if (!rec.type) return "A 'Típus' mező kötelező.";
  if (rec.type.length > 30) return "A 'Típus' max 30 karakter.";
  if (rec.description && rec.description.length > 50) return "A 'Leírás' max 50 karakter.";
  return null;
}

async function saveObjectTypeRow(tr) {
  const isDirty = tr.dataset.dirty === "1";
  if (!isDirty) return;

  const rec = readObjectTypeRow(tr);
  const err = validateObjectType(rec);
  if (err) {
    showHint(err);
    return;
  }

  await DB.init();
  await DB.updateObjectType(rec.id, {
    internalId: rec.internalId,
    type: rec.type,
    description: rec.description,
    color: rec.color,
    updatedAt: Date.now()
  });
  tr.dataset.dirty = "0";
  // v5.50: színváltozás azonnal hasson a markerekre
  try { _objectTypesCache = await DB.getAllObjectTypes(); setTypeMetaCache(_objectTypesCache); } catch (_) {}
  refreshAllMarkerIcons();
}

async function loadAndRenderObjectTypes(opts = {}) {
  await DB.init();
  _objectTypesCache = await DB.getAllObjectTypes();
  try { setTypeMetaCache(_objectTypesCache); } catch (_) {}
  refreshAllMarkerIcons();
  renderObjectTypesTable();
  if (opts.focusId) {
    const row = document.querySelector(`#objectTypesTbody tr[data-ot-id='${opts.focusId}'] input[data-field='type']`);
    if (row) row.focus();
  }
}

function renderObjectTypesTable() {
  const tb = document.getElementById("objectTypesTbody");
  if (!tb) return;
  tb.innerHTML = "";

  _objectTypesCache.forEach((rec) => {
    const tr = document.createElement("tr");
    tr.dataset.otId = rec.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${escapeHtml(rec.id)}</span>
          <button class="btn btn-ghost" type="button" data-action="delete-ot" style="padding:4px 8px;">🗑</button>
        </div>
      </td>
      <td><input data-field="internalId" type="text" maxlength="10" value="${escapeHtml(rec.internalId || "")}" style="width:100%;"/></td>
      <td><input data-field="type" type="text" maxlength="30" value="${escapeHtml(rec.type || "")}" style="width:100%;" placeholder="pl. Pad"/></td>
      <td><input data-field="description" type="text" maxlength="50" value="${escapeHtml(rec.description || "")}" style="width:100%;"/></td>
      <td>
        <div class="color-cell">
          <button type="button" class="color-btn" title="Szín kiválasztása">
            <span class="color-dot" style="background:${escapeHtml(String(rec.color || "#22c55e"))}"></span>
            <span class="color-hex">${escapeHtml(String(rec.color || "#22c55e"))}</span>
          </button>
          <input data-field="color" type="hidden" value="${escapeHtml(String(rec.color || "#22c55e"))}" />
        </div>
      </td>
    `;
    tb.appendChild(tr);

    // Szín UI frissítése (rejtett input -> gombon a dot + HEX)
    const colorInput = tr.querySelector("input[data-field='color']");
    const dot = tr.querySelector(".color-dot");
    const hexLabel = tr.querySelector(".color-hex");
    if (colorInput && dot && hexLabel) {
      const apply = () => {
        const v = String(colorInput.value || "#22c55e").trim();
        dot.style.background = v;
        hexLabel.textContent = v;
      };
      apply();
      colorInput.addEventListener("change", apply);
    }
  });
}
