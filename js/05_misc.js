

async function checkForUpdateOnline() {
  if (!navigator.onLine) return;

  try {
    const r = await fetch("./js/version.js", { cache: "no-store" });
    const t = await r.text();
    const m = t.match(/const\s+APP_VERSION\s*=\s*"([^"]+)"/);
    if (m && m[1] !== APP_VERSION) {
      location.reload();
    }
  } catch (e) {}
}


function markerScaleForZoom(z) {
  if (z >= 18) return 1.0;
  if (z === 17) return 0.95;
  if (z === 16) return 0.85;
  if (z === 15) return 0.75;
  if (z === 14) return 0.65;
  return 0.6;
}

function resizedIconForMarker(data, zoom) {
  return iconForMarker(data, zoom);
}


function userIconForZoom(zoom) {
  const scale = markerScaleForZoom(zoom);
  const size = 28 * scale;
  return L.icon({
    iconUrl: "./icons/user.png",
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 0.9],
    popupAnchor: [0, -size / 2]
  });
}


function myLocArrowIconForZoomHeading(zoom, headingDeg) {
  const scale = markerScaleForZoom(zoom);
  const size = 38 * scale;

  // L.divIcon: az IMG forgatása inline style-lal történik (Leaflet alap, nincs plugin).
  const rot = (typeof headingDeg === "number" && isFinite(headingDeg)) ? headingDeg : 0;

  return L.divIcon({
    className: "my-loc-arrow-wrap",
    html:
      `<img class="my-loc-arrow" src="./icons/arrow.svg" ` +
      `style="width:${size}px;height:${size}px;transform:rotate(${rot}deg);transform-origin:50% 50%;" ` +
      `alt="irány">`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 0.9],
    popupAnchor: [0, -size / 2]
  });
}

function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = toDeg(Math.atan2(y, x));
  θ = (θ + 360) % 360;
  return θ;
}

// Két szög (fok) közti legkisebb eltérés (-180..+180)
function shortestAngleDelta(fromDeg, toDeg) {
  let d = ((toDeg - fromDeg + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

function offsetLatLng(lat, lng, bearing, meters) {
  // Nagyon kis távolságokra jó közelítés (nav kijelzéshez)
  const R = 6378137;
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;

  const δ = meters / R;
  const θ = toRad(bearing);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return [toDeg(φ2), toDeg(λ2)];
}



// ---------------------------
// Settings modal (v5.20.0)
// ---------------------------

function openSettingsModal() {
  const m = document.getElementById("settingsModal");
  if (!m) return;
  m.style.display = "flex";
  setSettingsPage("type");
}

function closeSettingsModal() {
  const m = document.getElementById("settingsModal");
  if (!m) return;
  m.style.display = "none";
}

function setSettingsPage(page) {
  const titleEl = document.getElementById("settingsTitle");
  const hintEl = document.getElementById("settingsHint");
  const contentEl = document.getElementById("settingsContent");
  const navItems = Array.from(document.querySelectorAll("#settingsModal .settings-nav-item"));

  navItems.forEach((b) => b.classList.toggle("active", b.dataset.page === page));

  if (!titleEl || !hintEl || !contentEl) return;

  if (page === "status") {
    titleEl.textContent = "Objektum állapota";
    hintEl.textContent = "Állapotok kezelése (helyi adatbázis / IndexedDB).";
    renderSettingsObjectStatusesPage();
  } else if (page === "users") {
    titleEl.textContent = "Felhasználó kezelés";
    hintEl.textContent = "Itt később a felhasználók kezelése (jogosultságok, admin, felvivő stb.) lesz elérhető.";
    renderSettingsPlaceholderPage();
  } else {
    titleEl.textContent = "Objektum típusa";
    hintEl.textContent = "Típusok kezelése (helyi adatbázis / IndexedDB).";
    renderSettingsObjectTypesPage();
  }
}

// ---------------------------
// Settings: Objektum típusa (v5.21)
// ---------------------------

// ---------------------------
// Excel-szerű színválasztó (v5.22.1)
// - 30 szín: 10 oszlop x 3 árnyalat
// - "További színek...": natív color picker
// ---------------------------


// ---------------------------
// "Excel-szerű" (saját) szín dialógus – natív picker helyett
// Cél: Edge laptopon is működjön megbízhatóan.
// ---------------------------


function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function rgbToHex(r, g, b) {
  const to2 = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  };
}

// ---------------------------
// v5.23.2: "Színek szerkesztése" – Excel/Windows jellegű, egyetlen ablak
// - nincs több szintű felugró
// - Edge laptopon is megbízható (nem natív picker)
// - Alapszínek + Egyéni színek (mentve localStorage-ba)
// ---------------------------

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s: s * 100, v: v * 100 };
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  };
}

const CUSTOM_COLORS_KEY = "citymap_custom_colors_v1";
function loadCustomColors() {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      const out = arr.map((x) => (typeof x === "string" ? x : "")).slice(0, 24);
      while (out.length < 24) out.push("");
      return out;
    }
  } catch {}
  return Array(24).fill("");
}
function saveCustomColors(arr) {
  try { localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(arr)); } catch {}
}

// Alapszínek: közel Excel/Win paletta hangulat (48 db)
const BASE_COLORS = [
  "#F87171","#EF4444","#7F1D1D","#FCA5A5","#F59E0B","#F97316","#9A3412","#FDBA74","#FDE047","#FACC15","#A16207","#FEF08A",
  "#86EFAC","#22C55E","#166534","#BBF7D0","#34D399","#14B8A6","#0F766E","#99F6E4","#22D3EE","#06B6D4","#0E7490","#A5F3FC",
  "#60A5FA","#3B82F6","#1D4ED8","#BFDBFE","#818CF8","#6366F1","#4338CA","#C7D2FE","#A78BFA","#8B5CF6","#6D28D9","#DDD6FE",
  "#F472B6","#EC4899","#BE185D","#FBCFE8","#FB7185","#E11D48","#9F1239","#FECDD3","#111827","#6B7280","#D1D5DB","#FFFFFF"
];

let _colorsEditorOverlay = null;

function openColorsEditorDialog(startHex, onOk) {
  const initial = /^#([0-9a-fA-F]{6})$/.test(String(startHex || "")) ? String(startHex).toUpperCase() : "#3B82F6";
  const rgb0 = hexToRgb(initial);
  const hsv0 = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);

  let hue = hsv0.h;  // 0..360
  let sat = hsv0.s;  // 0..100
  let val = hsv0.v;  // 0..100
  let currentHex = initial;

  // overlay újraépítése
  if (_colorsEditorOverlay) _colorsEditorOverlay.remove();
  const overlay = document.createElement("div");
  overlay.className = "colors-editor-overlay";
  overlay.innerHTML = `
    <div class="colors-editor colors-editor-compact" role="dialog" aria-modal="true">
      <div class="colors-editor-titlebar">
        <div class="colors-editor-title">Színek szerkesztése</div>
        <button type="button" class="colors-editor-x" aria-label="Bezár">×</button>
      </div>

      <div class="colors-editor-main">
        <div class="ce-left">
          <div class="ce-picker">
            <div class="ce-sv" aria-label="Szín kiválasztása" tabindex="0">
              <div class="ce-sv-white"></div>
              <div class="ce-sv-black"></div>
              <div class="ce-sv-cursor" aria-hidden="true"></div>
            </div>
            <div class="ce-bars">
              <div class="ce-bar ce-hue" aria-label="Árnyalat" tabindex="0">
                <div class="ce-bar-cursor" data-bar="hue"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="ce-right">
          <label class="small" style="color:#6b7280; font-weight:800;">Kód (HEX)</label>
          <input class="ce-hex" type="text" value="${initial}" />

          <div class="ce-preview" style="margin-top:14px;">
            <div class="ce-preview-box">
              <div class="ce-preview-swatch" data-kind="new"></div>
              <div>
                <div class="ce-preview-label">Új</div>
                <div class="ce-preview-hex" data-kind="new"></div>
              </div>
            </div>
            <div class="ce-preview-box">
              <div class="ce-preview-swatch" data-kind="old"></div>
              <div>
                <div class="ce-preview-label">Jelenlegi</div>
                <div class="ce-preview-hex" data-kind="old"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="colors-editor-bottom">
        <div class="ce-section">
          <div class="ce-section-title">Alapszínek</div>
          <div class="ce-base"></div>
        </div>
      </div>

      <div class="colors-editor-actions">
        <button type="button" class="btn btn-primary ce-ok">OK</button>
        <button type="button" class="btn ce-cancel">Mégse</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _colorsEditorOverlay = overlay;

  const btnX = overlay.querySelector(".colors-editor-x");
  const btnOk = overlay.querySelector(".ce-ok");
  const btnCancel = overlay.querySelector(".ce-cancel");
  const sv = overlay.querySelector(".ce-sv");
  const svCursor = overlay.querySelector(".ce-sv-cursor");
  const hueBar = overlay.querySelector(".ce-hue");
  const hueCursor = overlay.querySelector(".ce-bar-cursor[data-bar='hue']");
  const hexInput = overlay.querySelector(".ce-hex");
  const prevNewSw = overlay.querySelector(".ce-preview-swatch[data-kind='new']");
  const prevOldSw = overlay.querySelector(".ce-preview-swatch[data-kind='old']");
  const prevNewHex = overlay.querySelector(".ce-preview-hex[data-kind='new']");
  const prevOldHex = overlay.querySelector(".ce-preview-hex[data-kind='old']");
  const baseWrap = overlay.querySelector(".ce-base");

  function setFromHsv() {
    const rgb = hsvToRgb(hue, sat, val);
    currentHex = rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase();
    hexInput.value = currentHex;
    updateUi();
  }

  function setFromHex(hex) {
    const v = String(hex || "").trim();
    if (!/^#([0-9a-fA-F]{6})$/.test(v)) return;
    const rgb = hexToRgb(v);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    hue = hsv.h; sat = hsv.s; val = hsv.v;
    currentHex = v.toUpperCase();
    hexInput.value = currentHex;
    updateUi();
  }

  function updateUi() {
    // SV háttér: hue alapján
    const hueRgb = hsvToRgb(hue, 100, 100);
    const hueHex = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
    sv.style.background = hueHex;

    // SV cursor
    const svRect = sv.getBoundingClientRect();
    const x = clamp((sat / 100) * svRect.width, 0, svRect.width);
    const y = clamp(((100 - val) / 100) * svRect.height, 0, svRect.height);
    svCursor.style.left = `${x}px`;
    svCursor.style.top = `${y}px`;

    // hue cursor
    const hb = hueBar.getBoundingClientRect();
    hueCursor.style.top = `${clamp((hue / 360) * hb.height, 0, hb.height)}px`;

    // preview
    prevNewSw.style.background = currentHex;
    prevNewHex.textContent = currentHex;
  }

  function initPreview() {
    prevOldSw.style.background = initial;
    prevOldHex.textContent = initial;
    prevNewSw.style.background = currentHex;
    prevNewHex.textContent = currentHex;
  }

  function renderBaseColors() {
    baseWrap.innerHTML = "";
    BASE_COLORS.forEach((hex) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ce-swatch";
      b.style.background = hex;
      b.title = hex;
      b.addEventListener("click", () => setFromHex(hex));
      baseWrap.appendChild(b);
    });
  }

  function close() {
    overlay.remove();
    if (_colorsEditorOverlay === overlay) _colorsEditorOverlay = null;
  }

  function commit() {
    onOk(currentHex);
    close();
  }

  // Interakciók: SV
  function handleSv(e) {
    const r = sv.getBoundingClientRect();
    const cx = clamp(e.clientX - r.left, 0, r.width);
    const cy = clamp(e.clientY - r.top, 0, r.height);
    sat = (cx / r.width) * 100;
    val = 100 - (cy / r.height) * 100;
    setFromHsv();
  }
  sv.addEventListener("pointerdown", (e) => {
    sv.setPointerCapture(e.pointerId);
    handleSv(e);
    const move = (ev) => handleSv(ev);
    const up = (ev) => {
      try { sv.releasePointerCapture(ev.pointerId); } catch {}
      sv.removeEventListener("pointermove", move);
      sv.removeEventListener("pointerup", up);
      sv.removeEventListener("pointercancel", up);
    };
    sv.addEventListener("pointermove", move);
    sv.addEventListener("pointerup", up);
    sv.addEventListener("pointercancel", up);
  });

  // Hue bar
  function handleHue(e) {
    const r = hueBar.getBoundingClientRect();
    const cy = clamp(e.clientY - r.top, 0, r.height);
    hue = (cy / r.height) * 360;
    setFromHsv();
  }
  hueBar.addEventListener("pointerdown", (e) => {
    hueBar.setPointerCapture(e.pointerId);
    handleHue(e);
    const move = (ev) => handleHue(ev);
    const up = (ev) => {
      try { hueBar.releasePointerCapture(ev.pointerId); } catch {}
      hueBar.removeEventListener("pointermove", move);
      hueBar.removeEventListener("pointerup", up);
      hueBar.removeEventListener("pointercancel", up);
    };
    hueBar.addEventListener("pointermove", move);
    hueBar.addEventListener("pointerup", up);
    hueBar.addEventListener("pointercancel", up);
  });

  // HEX input
  hexInput.addEventListener("change", () => setFromHex(hexInput.value));

  // Gombok
  btnX.addEventListener("click", close);
  btnCancel.addEventListener("click", close);
  btnOk.addEventListener("click", commit);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const esc = (e) => {
    if (!_colorsEditorOverlay) return;
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  };
  document.addEventListener("keydown", esc);

  // init
  renderBaseColors();
  initPreview();
  updateUi();

  setTimeout(() => hexInput.focus(), 0);
}



let _objectTypesCache = [];
let _objectTypesUiWired = false;

function renderSettingsPlaceholderPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;
  container.innerHTML = "";
}

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



// ---------------------------
// Settings: Objektum állapota (v5.47)
// - mezők: Azonosító (auto), Belső azonosító, Állapot*, Leírás
// - felvitel/törlés logika: mint a típusoknál
// ---------------------------

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

