// Маленькая обёртка над IndexedDB: очередь отправки (outbox) и кэш данных для работы без связи (kv).
// В IndexedDB можно хранить фото (Blob) — так снимки путевых не теряются, пока нет сети.

const DB = 'ordius';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

// Запись в одной транзакции; промис выполняется, когда транзакция завершена.
function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    fn(t.objectStore(store));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function kvGet(key) {
  try {
    const db = await open();
    return await req2p(db.transaction('kv').objectStore('kv').get(key));
  } catch (_) { return undefined; }
}
export async function kvSet(key, value) {
  try { await tx('kv', 'readwrite', (s) => { s.put(value, key); }); } catch (_) { /* кэш — не главное */ }
}
export async function kvClear() {
  try { await tx('kv', 'readwrite', (s) => { s.clear(); }); } catch (_) { /* нет */ }
}

export async function outboxAdd(items) {
  await tx('outbox', 'readwrite', (s) => { for (const it of items) s.add(it); });
}
export async function outboxAll() {
  const db = await open();
  return req2p(db.transaction('outbox').objectStore('outbox').getAll());
}
export async function outboxPut(item) {
  await tx('outbox', 'readwrite', (s) => { s.put(item); });
}
export async function outboxDelete(seq) {
  await tx('outbox', 'readwrite', (s) => { s.delete(seq); });
}
export async function outboxClear() {
  await tx('outbox', 'readwrite', (s) => { s.clear(); });
}
