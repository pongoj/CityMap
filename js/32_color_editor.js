// Color editor / palette (Excel-like)
// (moved out from former 05_misc.js)

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
