export function notebookName(search = globalThis.location?.search || "") {
 const id=new URLSearchParams(search).get("notebook");
 return /^recovery-[0-9a-f-]{36}$/.test(id || "") ? "travel-tracker-v1-"+id : "travel-tracker-v1";
}
const NAME = "roam-iphone-test-" + notebookName();
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
    let conflict = false, incompatible = false;
    get.onsuccess = () => {
      if ((get.result?.revision ?? 0) !== expected) {
        conflict = true;
        tx.abort();
        return;
      }
      if((get.result?.schemaVersion>=3)&&((data.schemaVersion||0)<get.result.schemaVersion)){incompatible=true;tx.abort();return;}
      const put=()=>s.put({ ...data, revision: expected + 1 }, "data");
      if(get.result?.schemaVersion===3&&data.schemaVersion===4){
        const recovery=s.get('pre-coordination-v3');recovery.onsuccess=()=>{if(!recovery.result)s.put(get.result,'pre-coordination-v3');put();};
      }else if(get.result?.schemaVersion===2&&data.schemaVersion===3){
        const recovery=s.get('pre-fixed-v2');recovery.onsuccess=()=>{if(!recovery.result)s.put(get.result,'pre-fixed-v2');put();};
      }else{
        if(get.result&&get.result.schemaVersion===undefined&&data.schemaVersion===2)s.put(get.result,'pre-accounting-v1');
        put();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve({ ...data, revision: expected + 1 });
    };
    tx.onabort = () => {
      db.close();
      reject(
        Error(
          incompatible ? "A fixed-budget notebook cannot be overwritten by an older app. Export or open a separate recovery notebook." : conflict
            ? "Another window changed your records. Reload before editing."
            : "Could not save. Your previous records are unchanged.",
        ),
      );
    };
    tx.onerror = () => {};
  });
}

export async function readLegacyRecovery() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state");
    const r = tx.objectStore("state").get("pre-accounting-v1");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}

export async function readFixedRecovery(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('state'),r=tx.objectStore('state').get('pre-fixed-v2');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
export async function readCoordinationRecovery(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('state'),r=tx.objectStore('state').get('pre-coordination-v3');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
