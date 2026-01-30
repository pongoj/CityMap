const DB_NAME = "citymap-db";
const DB_VERSION = 1;

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

  _store(name, mode) {
    const tx = this._db.transaction(name, mode);
    return tx.objectStore(name);
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
