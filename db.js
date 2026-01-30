const DB_NAME = "citymap-db";
const DB_VERSION = 1;

let db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("markers")) {
        const store = db.createObjectStore("markers", { keyPath: "id" });
        store.createIndex("by_type", "type", { unique: false });
        store.createIndex("by_status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("lookups")) {
        db.createObjectStore("lookups", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "username" });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}
