const NAME = "travel-tracker-v1";
export function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(Error("Close other tracker windows and try again."));
  });
}
export async function read() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state");
    const r = tx.objectStore("state").get("data");
    r.onsuccess = () =>
      resolve(
        r.result ?? { revision: 0, trips: [], active: null, lastBackup: null },
      );
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function write(data, expected) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    const s = tx.objectStore("state");
    const get = s.get("data");
    let conflict = false;
    get.onsuccess = () => {
      if ((get.result?.revision ?? 0) !== expected) {
        conflict = true;
        tx.abort();
        return;
      }
      s.put({ ...data, revision: expected + 1 }, "data");
    };
    tx.oncomplete = () => {
      db.close();
      resolve({ ...data, revision: expected + 1 });
    };
    tx.onabort = () => {
      db.close();
      reject(
        Error(
          conflict
            ? "Another window changed your records. Reload before editing."
            : "Could not save. Your previous records are unchanged.",
        ),
      );
    };
    tx.onerror = () => {};
  });
}
