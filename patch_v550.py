import re, pathlib
root = pathlib.Path('/mnt/data/citymap549')

# --- index.html modifications ---
idx = root/'index.html'
text = idx.read_text(encoding='utf-8')

# replace selects with picker buttons + hidden inputs
text = re.sub(r"<select id=\"fType\"></select>",
              """<div class=\"pick-wrap\">\n            <button type=\"button\" class=\"pick-btn\" id=\"fTypeBtn\" aria-label=\"Típus választása\">\n              <span class=\"pick-btn-text\" id=\"fTypeBtnText\">Válassz...</span>\n              <span class=\"pick-caret\" aria-hidden=\"true\">▾</span>\n            </button>\n            <input type=\"hidden\" id=\"fType\" value=\"\" />\n          </div>""",
              text)
text = re.sub(r"<select id=\"fStatus\"></select>",
              """<div class=\"pick-wrap\">\n            <button type=\"button\" class=\"pick-btn\" id=\"fStatusBtn\" aria-label=\"Állapot választása\">\n              <span class=\"pick-btn-text\" id=\"fStatusBtnText\">Válassz...</span>\n              <span class=\"pick-caret\" aria-hidden=\"true\">▾</span>\n            </button>\n            <input type=\"hidden\" id=\"fStatus\" value=\"\" />\n          </div>""",
              text)

# add picker panel near end of body (before closing body)
if 'id="cmPickPanel"' not in text:
    text = text.replace('</body>', '  <div id="cmPickPanel" class="pick-panel" style="display:none"></div>\n</body>')

# add CSS once
css_marker = '/* CM_PICKER_STYLES */'
if css_marker not in text:
    # insert near end of <style>
    m = re.search(r"</style>", text)
    if not m:
        raise SystemExit('No </style> found')
    css = """

    /* CM_PICKER_STYLES */
    .pick-wrap{ position:relative; }
    .pick-btn{ width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px;
      padding:12px 14px; border:1px solid #d1d5db; border-radius:14px; background:#fff; cursor:pointer;
      font: 600 16px system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .pick-btn:disabled{ opacity:.6; cursor:not-allowed; }
    .pick-btn-text{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pick-caret{ opacity:.75; }

    .pick-panel{ position:fixed; z-index:5000; background:rgba(255,255,255,.98); border:1px solid rgba(0,0,0,.12);
      border-radius:14px; box-shadow:0 18px 40px rgba(0,0,0,.25); overflow:hidden; }
    .pick-panel .pick-head{ padding:10px 12px; border-bottom:1px solid rgba(0,0,0,.08); display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .pick-panel .pick-title{ font-weight:800; }
    .pick-panel .pick-close{ border:0; background:transparent; font-size:22px; line-height:1; cursor:pointer; padding:0 6px; }
    .pick-panel table{ border-collapse:collapse; width:100%; font-size:14px; }
    .pick-panel th, .pick-panel td{ padding:10px 12px; border-bottom:1px solid rgba(0,0,0,.06); text-align:left; vertical-align:top; }
    .pick-panel th{ font-size:12px; text-transform:uppercase; letter-spacing:.04em; opacity:.7; }
    .pick-panel tr{ cursor:pointer; }
    .pick-panel tr:hover{ background:rgba(0,0,0,.04); }
    .pick-panel tr[data-selected="1"]{ background:rgba(44,123,229,.10); }
    .pick-panel td.col-name{ font-weight:700; }
    .pick-panel td.col-int{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; opacity:.85; }
    .pick-panel td.col-desc{ opacity:.8; }

    @media (max-width:640px){
      .pick-panel{ left:10px !important; right:10px !important; width:auto !important; }
    }
"""
    text = text[:m.start()] + css + text[m.start():]

idx.write_text(text, encoding='utf-8')

# --- app.js modifications ---
app = root/'app.js'
a = app.read_text(encoding='utf-8')

# bump versions
a = re.sub(r'const APP_VERSION\s*=\s*"[^"]+";', 'const APP_VERSION = "5.50";', a)

# caches for pickers
insert_after = re.search(r"let _markerSvgUrlCache = new Map\(\);", a)
if insert_after:
    pos = insert_after.end()
    extra = "\n\n// v5.50: Típus/Állapot választó (szép, táblázatos lenyíló)\nlet _formTypes = [];\nlet _formStatuses = [];\n"
    if '_formTypes' not in a:
        a = a[:pos] + extra + a[pos:]

# Replace fillLookups implementation block: find function fillLookups() { ... } up to end of statusSel population.
# We'll replace content of fillLookups entirely for type/status controls.
pattern = re.compile(r"async function fillLookups\(\) \{.*?\n\}", re.S)
match = pattern.search(a)
if not match:
    raise SystemExit('fillLookups not found')

fill_new = '''async function fillLookups() {
  // v5.50: Felvitel/szerkesztés a Beállításokban tárolt típusok/állapotok alapján
  const types = await DB.getAllObjectTypes().catch(() => []) || [];
  const statuses = await DB.getAllObjectStatuses().catch(() => []) || [];

  _formTypes = types;
  _formStatuses = statuses;

  // cache a marker színekhez (typeId -> color)
  try { setTypeMetaCache(types); } catch (_) {}

  // alapértékek (nincs default kiválasztás)
  setPickerValue('type', null);
  setPickerValue('status', null);
}
'''
a = a[:match.start()] + fill_new + a[match.end():]

# add picker helpers near marker modal helpers: after setMarkerModalTitle maybe.
anchor = re.search(r"function setMarkerModalTitle\(mode\) \{.*?\n\}", a, re.S)
if not anchor:
    raise SystemExit('setMarkerModalTitle not found')
ins_pos = anchor.end()
if 'function openPickPanel' not in a:
    helpers = '''

// v5.50: szép, táblázatos választó Típus/Állapot mezőkhöz
function getLabelForType(id){
  const n = Number(id);
  const rec = _formTypes.find(x => Number(x.id) === n);
  return rec ? String(rec.type || '').trim() : '';
}
function getLabelForStatus(id){
  const n = Number(id);
  const rec = _formStatuses.find(x => Number(x.id) === n);
  return rec ? String(rec.status || '').trim() : '';
}

function setPickerValue(kind, id){
  const hid = document.getElementById(kind === 'type' ? 'fType' : 'fStatus');
  const txt = document.getElementById(kind === 'type' ? 'fTypeBtnText' : 'fStatusBtnText');
  if (!hid || !txt) return;
  if (!id) {
    hid.value = '';
    txt.textContent = 'Válassz...';
    return;
  }
  hid.value = String(id);
  txt.textContent = kind === 'type' ? getLabelForType(id) : getLabelForStatus(id);
}

function openPickPanel(kind, anchorBtn){
  const panel = document.getElementById('cmPickPanel');
  if (!panel || !anchorBtn) return;

  const data = (kind === 'type') ? (_formTypes || []) : (_formStatuses || []);
  const selectedId = String(document.getElementById(kind === 'type' ? 'fType' : 'fStatus')?.value || '');

  const title = kind === 'type' ? 'Típus választása' : 'Állapot választása';
  const nameKey = kind === 'type' ? 'type' : 'status';

  const rows = data.map(r => {
    const id = String(r.id);
    const name = String(r[nameKey] || '').trim();
    const internalId = String(r.internalId || '').trim();
    const desc = String(r.description || '').trim();
    const sel = (id && id === selectedId) ? ' data-selected="1"' : '';
    return `<tr data-id="${escapeHtml(id)}"${sel}>
      <td class="col-name">${escapeHtml(name)}</td>
      <td class="col-int">${escapeHtml(internalId)}</td>
      <td class="col-desc">${escapeHtml(desc)}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="pick-head">
      <div class="pick-title">${escapeHtml(title)}</div>
      <button type="button" class="pick-close" aria-label="Bezárás">×</button>
    </div>
    <table>
      <thead><tr><th>${kind==='type'?'Típus':'Állapot'}</th><th>Saját az.</th><th>Leírás</th></tr></thead>
      <tbody>${rows || ''}</tbody>
    </table>
  `;

  const rect = anchorBtn.getBoundingClientRect();
  const maxW = Math.min(760, window.innerWidth - 20);
  const width = Math.max(320, Math.min(maxW, rect.width * 1.25));
  panel.style.width = width + 'px';
  panel.style.left = Math.min(window.innerWidth - width - 10, Math.max(10, rect.left)) + 'px';
  panel.style.top = Math.min(window.innerHeight - 240, rect.bottom + 8) + 'px';
  panel.style.display = 'block';

  const close = () => { panel.style.display = 'none'; };
  panel.querySelector('.pick-close')?.addEventListener('click', (e) => { e.preventDefault(); close(); });

  const onDoc = (ev) => {
    if (!panel.contains(ev.target) && ev.target !== anchorBtn) {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('touchstart', onDoc, true);
      close();
    }
  };
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('touchstart', onDoc, true);

  panel.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      e.preventDefault();
      const id = tr.getAttribute('data-id');
      setPickerValue(kind, id);
      close();
    });
  });
}
'''
    a = a[:ins_pos] + helpers + a[ins_pos:]

# Update setMarkerModalControlsDisabled to disable buttons not hidden inputs
# Replace references to fType select disable
a = re.sub(r"const type = document.getElementById\(\"fType\"\);\n\s*if \(type\) type\.disabled = !!addressLocked;",
           "const typeBtn = document.getElementById(\"fTypeBtn\");\n  if (typeBtn) typeBtn.disabled = !!addressLocked;",
           a)

# Update openEditModal type/status selection blocks to use setPickerValue and disable type button
# We'll do a simpler replacement: after obtaining typeSel etc, we'll set picker values.
# Replace lines selecting typeSel and statusSel blocks with new code using marker.typeId/statusId

a = re.sub(r"// Típus \(nem módosítható\)[\s\S]*?// Állapot \+ megjegyzés \(módosítható\)",
           "// Típus (nem módosítható)\n  setPickerValue('type', marker.typeId || null);\n  const typeBtn = document.getElementById('fTypeBtn');\n  if (typeBtn) typeBtn.disabled = true;\n\n  // Állapot + megjegyzés (módosítható)\n  setPickerValue('status', marker.statusId || null);\n  const statusBtn = document.getElementById('fStatusBtn');\n  if (statusBtn) statusBtn.disabled = false;\n",
           a)

# For add mode, when opening modal elsewhere, typeBtn should enabled. Find openAddModal? search markerModalMode='add'. We'll patch after markerModalMode='add' set.
# We'll insert enabling buttons and resetting values.

a = re.sub(r"markerModalMode = \"add\";", "markerModalMode = \"add\";\n  const tb = document.getElementById('fTypeBtn'); if (tb) tb.disabled = false;\n  const sb = document.getElementById('fStatusBtn'); if (sb) sb.disabled = false;\n  setPickerValue('type', null);\n  setPickerValue('status', null);", a)

# Wire picker button clicks once in DOMContentLoaded: add listeners after fillLookups call perhaps.
# find in DOMContentLoaded after await fillLookups(); insert wiring if not present

dc = re.search(r"await fillLookups\(\);", a)
if dc and 'fTypeBtn' not in a[dc.start()-200:dc.start()+200]:
    insert = "\n  // v5.50: Táblázatos Típus/Állapot választó\n  const fTypeBtn = document.getElementById('fTypeBtn');\n  if (fTypeBtn) fTypeBtn.addEventListener('click', (e) => { e.preventDefault(); if (!fTypeBtn.disabled) openPickPanel('type', fTypeBtn); });\n  const fStatusBtn = document.getElementById('fStatusBtn');\n  if (fStatusBtn) fStatusBtn.addEventListener('click', (e) => { e.preventDefault(); if (!fStatusBtn.disabled) openPickPanel('status', fStatusBtn); });\n"
    a = a[:dc.end()] + insert + a[dc.end():]

# Update saveMarker and edit save to use hidden input values and label lookup
# In saveMarker edit mode: statusSel is select; replace with hidden fStatus

a = re.sub(r"const statusSel = document.getElementById\(\"fStatus\"\);\n\s*const notes = document.getElementById\(\"fNotes\"\)\.value\.trim\(\);\n\s*const statusId = statusSel \? Number\(statusSel\.value\) : null;\n\s*const statusLabel = statusSel \? \(statusSel\.options\[statusSel\.selectedIndex\]\?\.textContent \|\| \"\"\) : \"\";\n\s*const statusInternalId = statusSel \? \(statusSel\.options\[statusSel\.selectedIndex\]\?\.dataset\?\.internalId \|\| \"\"\) : \"\";",
           "const notes = document.getElementById(\"fNotes\").value.trim();\n    const statusId = Number(document.getElementById(\"fStatus\")?.value || NaN);\n    const sRec = _formStatuses.find(x => Number(x.id) === statusId) || null;\n    const statusLabel = sRec ? String(sRec.status || '').trim() : '';\n    const statusInternalId = sRec ? String(sRec.internalId || '').trim() : '';",
           a)

# Add mode: replace typeSel/statusSel option reading

a = re.sub(r"const typeSel = document.getElementById\(\"fType\"\);\n\s*const statusSel = document.getElementById\(\"fStatus\"\);\n\n\s*const uuid = currentDraftUuid \|\| genUuid\(\);\n\s*const typeId = Number\(typeSel\?\.value\);\n\s*const statusId = Number\(statusSel\?\.value\);",
           "const uuid = currentDraftUuid || genUuid();\n  const typeId = Number(document.getElementById(\"fType\")?.value || NaN);\n  const statusId = Number(document.getElementById(\"fStatus\")?.value || NaN);",
           a)

# Replace typeOpt/statusOpt and labels/internal

a = re.sub(r"const typeOpt[\s\S]*?const marker = \{",
           "const tRec = _formTypes.find(x => Number(x.id) === typeId) || null;\n  const sRec = _formStatuses.find(x => Number(x.id) === statusId) || null;\n  const typeInternalId = tRec ? String(tRec.internalId || '').trim() : '';\n  const statusInternalId = sRec ? String(sRec.internalId || '').trim() : '';\n  const typeLabel = tRec ? String(tRec.type || '').trim() : '';\n  const statusLabel = sRec ? String(sRec.status || '').trim() : '';\n  const marker = {",
           a)

# Update marker fields using typeLabel/statusLabel already variables; update assignments

a = a.replace("typeLabel: String(typeOpt?.textContent || \"\"),", "typeLabel: String(typeLabel || ''),")
a = a.replace("statusLabel: String(statusOpt?.textContent || \"\"),", "statusLabel: String(statusLabel || ''),")

# Ensure type/status hidden inputs reset on closeModal perhaps already.

# Refresh marker icons when object type color changes: in saveObjectTypeRow after update
if 'refreshAllMarkerIcons' not in a:
    # define function near markerLayers map maybe after addMarkerToMap
    ins = re.search(r"function addMarkerToMap\(m\) \{", a)
    if ins:
        # insert after addMarkerToMap definition end? We'll insert function after line markerLayers.set
        pass

# Add refreshAllMarkerIcons function after addMarkerToMap block end (after updateShowAllButtonVisibility();})
if 'function refreshAllMarkerIcons' not in a:
    m = re.search(r"function addMarkerToMap\(m\)[\s\S]*?\n\}", a)
    if m:
        end = m.end()
        fn = "\n\nfunction refreshAllMarkerIcons() {\n  try {\n    markerLayers.forEach((mk, id) => {\n      const d = mk && mk.__data ? mk.__data : null;\n      if (!d) return;\n      mk.setIcon(iconForMarker(d, map.getZoom()));\n    });\n  } catch (e) {\n    console.warn('refreshAllMarkerIcons failed', e);\n  }\n}\n"
        a = a[:end] + fn + a[end:]

# In loadAndRenderObjectTypes after fetching cache, update meta cache and refresh icons
# Find line _objectTypesCache = await DB.getAllObjectTypes(); add setTypeMetaCache+refresh.
a = a.replace("_objectTypesCache = await DB.getAllObjectTypes();", "_objectTypesCache = await DB.getAllObjectTypes();\n  try { setTypeMetaCache(_objectTypesCache); } catch (_) {}\n  refreshAllMarkerIcons();")

# In saveObjectTypeRow after update, reload caches and refresh icons by calling loadAndRenderObjectTypes? but that re-renders table.
# We'll add small reload after update call by reading all and update caches and refresh.
a = a.replace("tr.dataset.dirty = \"0\";", "tr.dataset.dirty = \"0\";\n  // v5.50: színváltozás azonnal hasson a markerekre\n  try { _objectTypesCache = await DB.getAllObjectTypes(); setTypeMetaCache(_objectTypesCache); } catch (_) {}\n  refreshAllMarkerIcons();")

app.write_text(a, encoding='utf-8')

# --- service-worker.js bump cache version ---
sw = root/'service-worker.js'
swtext = sw.read_text(encoding='utf-8')
swtext = re.sub(r"const CACHE_VERSION\s*=\s*\"v[^\"]+\";", 'const CACHE_VERSION = "v5.50";', swtext)
sw.write_text(swtext, encoding='utf-8')

print('patched')
