// v5.31: Szűrők az oszlopfejlécben (felugró input/select)
// (moved out from boot)

const SF_POP_IDS = ["sfAddressPop", "sfTypePop", "sfStatusPop", "sfNotesPop"];

function closeHeaderFilterPops() {
  SF_POP_IDS.forEach((id) => {
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
