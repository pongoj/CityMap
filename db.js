const DB_NAME = "citymap-db";
// v5.11: photos stored locally (IndexedDB) and linked to marker uuid
const DB_VERSION = 3;

const DB = {
  _db: null,

  async init() {
    if (this._db) return;

    await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Markerek
        if (!db.objectStoreNames.contains("markers")) {
          const s = db.createObjectStore("markers", { keyPath: "id", autoIncrement: true });
          s.createIndex("by_type", "type", { unique: false });
          s.createIndex("by_status", "status", { unique: false });
          s.createIndex("by_uuid", "uuid", { unique: true });
          s.createIndex("by_deletedAt", "deletedAt", { unique: false });
        } else {
          const s = e.target.transaction.objectStore("markers");
          if (!s.indexNames.contains("by_uuid")) s.createIndex("by_uuid", "uuid", { unique: true });
          if (!s.indexNames.contains("by_deletedAt")) s.createIndex("by_deletedAt", "deletedAt", { unique: false });
        }

        // Fényképek (marker uuid-hoz rendelve)
        if (!db.objectStoreNames.contains("photos")) {
          const p = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
          p.createIndex("by_markerUuid", "markerUuid", { unique: false });
          p.createIndex("by_createdAt", "createdAt", { unique: false });
        }
// Combo értékek (később admin felületről bővíthető)
        if (!db.objectStoreNames.contains("lookups")) {
          db.createObjectStore("lookups", { keyPath: "key" });
        }

        // Felhasználók (később)
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "username" });
        }
      };

      req.onsuccess = () => { this._db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });

    // alap listák (ha nincs)
    const types = await this.getLookup("markerTypes");
    if (!types) {
      await this.setLookup("markerTypes", [
        { code: "PAD", label: "Pad" },
        { code: "ZEBRA", label: "Zebra" },
        { code: "TABLA", label: "Tábla" }
      ]);
    }

    const status = await this.getLookup("markerStatus");
    if (!status) {
      await this.setLookup("markerStatus", [
        { code: "UJ", label: "Új" },
        { code: "FELUJITOTT", label: "Felújított" },
        { code: "NORMAL", label: "Normál" },
        { code: "ROSSZ", label: "Rossz" },
        { code: "BALESET", label: "Balesetveszélyes" }
      ]);
    }
  },

  async backfillMarkerMeta() {
    const all = await this.getAllMarkers();
    const now = Date.now();
    for (const m of all) {
      let changed = false;
      const patch = {};
      if (!m.uuid) { patch.uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(now) + "-" + String(Math.random()).replace(".", "")); changed = true; }
      if (!m.createdAt) { patch.createdAt = now; changed = true; }
      if (!m.updatedAt) { patch.updatedAt = m.createdAt || now; changed = true; }
      if (typeof m.deletedAt === "undefined") { patch.deletedAt = null; changed = true; }
      if (changed) await this.updateMarker(m.id, patch);
    }
  },


  _store(name, mode) {
    const tx = this._db.transaction(name, mode);
    return tx.objectStore(name);
  },

  addPhoto(markerUuid, file) {
    return new Promise((resolve, reject) => {
      const s = this._store("photos", "readwrite");
      const rec = {
        markerUuid,
        createdAt: Date.now(),
        name: file?.name || "photo.jpg",
        type: file?.type || "image/jpeg",
        blob: file
      };
      const r = s.add(rec);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  countPhotosByMarkerUuid(markerUuid) {
    return new Promise((resolve, reject) => {
      const s = this._store("photos", "readonly");
      const idx = s.index("by_markerUuid");
      const r = idx.count(markerUuid);
      r.onsuccess = () => resolve(r.result || 0);
      r.onerror = () => reject(r.error);
    });
  },

  deletePhotosByMarkerUuid(markerUuid) {
    return new Promise((resolve, reject) => {
      const s = this._store("photos", "readwrite");
      const idx = s.index("by_markerUuid");
      const req = idx.openCursor(IDBKeyRange.only(markerUuid));
      req.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) return resolve(true);
        s.delete(cur.primaryKey);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  getPhotosByMarkerUuid(markerUuid) {
    return new Promise((resolve, reject) => {
      const s = this._store("photos", "readonly");
      const idx = s.index("by_markerUuid");
      const out = [];
      const req = idx.openCursor(IDBKeyRange.only(markerUuid));
      req.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) return resolve(out);
        out.push({ id: cur.primaryKey, ...cur.value });
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  deletePhotoById(photoId) {
    return new Promise((resolve, reject) => {
      const s = this._store("photos", "readwrite");
      const r = s.delete(photoId);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  addMarker(marker) {
    return new Promise((resolve, reject) => {
      const s = this._store("markers", "readwrite");
      const r = s.add(marker);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  updateMarker(id, patch) {
    return new Promise((resolve, reject) => {
      const s = this._store("markers", "readwrite");
      const g = s.get(id);
      g.onsuccess = () => {
        const cur = g.result;
        if (!cur) return resolve(false);
        const put = s.put({ ...cur, ...patch });
        put.onsuccess = () => resolve(true);
        put.onerror = () => reject(put.error);
      };
      g.onerror = () => reject(g.error);
    });
  },

  deleteMarker(id) {
    return new Promise((resolve, reject) => {
      const s = this._store("markers", "readwrite");
      const r = s.delete(id);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  clearMarkers() {
    return new Promise((resolve, reject) => {
      const s = this._store("markers", "readwrite");
      const r = s.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  getAllMarkers() {
    return new Promise((resolve, reject) => {
      const s = this._store("markers", "readonly");
      const r = s.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  // Csak az aktív (nem törölt) markerek
  getAllMarkersActive() {
    return this.getAllMarkers().then(list => (list || []).filter(m => !m.deletedAt));
  },

  // Soft delete (online sync-hoz barátságosabb)
  softDeleteMarker(id) {
    return new Promise((resolve, reject) => {
      const s = this._store("markers", "readwrite");
      const g = s.get(id);
      g.onsuccess = () => {
        const cur = g.result;
        if (!cur) return resolve(false);
        const now = Date.now();
        const put = s.put({ ...cur, deletedAt: now, updatedAt: now });
        put.onsuccess = () => resolve(true);
        put.onerror = () => reject(put.error);
      };
      g.onerror = () => reject(g.error);
    });
  },


  getLookup(key) {
    return new Promise((resolve, reject) => {
      const s = this._store("lookups", "readonly");
      const r = s.get(key);
      r.onsuccess = () => resolve(r.result ? r.result.values : null);
      r.onerror = () => reject(r.error);
    });
  },

  setLookup(key, values) {
    return new Promise((resolve, reject) => {
      const s = this._store("lookups", "readwrite");
      const r = s.put({ key, values });
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }
};
