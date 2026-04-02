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

function renderSettingsPlaceholderPage() {
  const container = document.getElementById("settingsExtra");
  if (!container) return;
  container.innerHTML = "";
}
