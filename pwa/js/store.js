/**
 * Хранилище на телефоне. IndexedDB, никакого сервера: медицинские записи
 * не покидают устройство. Экспорт в файл — единственный способ их вынести,
 * и делает это только сам человек.
 */
const DB_NAME = 'yasnaya-golova';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('weather')) db.createObjectStore('weather', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export const DEFAULTS = {
  city: 'Санкт-Петербург',
  lat: 59.9386,
  lon: 30.3141,
  tz: 'Europe/Moscow',
  // Что человек отмечает каждый день по своей воле. Без ежедневных отметок
  // фактор нельзя проверить — см. пояснение в engine.js.
  dailyFactors: ['sleepShort', 'stress', 'alcohol', 'coffee'],
};

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  if (row) return row.value;
  return key in DEFAULTS ? DEFAULTS[key] : fallback;
}

export async function setSetting(key, value) {
  return putMany('settings', [{ key, value }]);
}

export async function allSettings() {
  const out = { ...DEFAULTS };
  const rows = await getAll('settings');
  rows.forEach((r) => { out[r.key] = r.value; });
  return out;
}

export function getAll(store) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

export function get(store, key) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

/** Пакетная запись: импорт двух лет дневника — одна транзакция. */
export function putMany(store, rows) {
  if (!rows.length) return Promise.resolve(0);
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    rows.forEach((r) => s.put(r));
    t.oncomplete = () => resolve(rows.length);
    t.onerror = () => reject(t.error);
  }));
}

export const entries = {
  all: () => getAll('entries').then((r) => r.sort((a, b) => a.date.localeCompare(b.date))),
  get: (date) => get('entries', date),
  put: (row) => putMany('entries', [row]),
  putMany: (rows) => putMany('entries', rows),
};

export const weather = {
  all: () => getAll('weather').then((r) => r.sort((a, b) => a.date.localeCompare(b.date))),
  putMany: (rows) => putMany('weather', rows),
  async range(kind = 'archive') {
    const rows = (await weather.all()).filter((r) => !kind || r.kind === kind);
    return rows.length ? [rows[0].date, rows[rows.length - 1].date] : [null, null];
  },
};

export async function stats() {
  const e = await entries.all();
  const w = await weather.all();
  return {
    entries: e.length,
    headacheDays: e.filter((r) => r.headache === 1).length,
    from: e.length ? e[0].date : null,
    to: e.length ? e[e.length - 1].date : null,
    weatherDays: w.length,
  };
}

/** Резервная копия: один json-файл, который можно унести куда угодно. */
export async function exportAll() {
  return {
    app: 'yasnaya-golova',
    exportedAt: new Date().toISOString(),
    settings: await allSettings(),
    entries: await entries.all(),
  };
}

export async function importBackup(obj) {
  if (!obj || obj.app !== 'yasnaya-golova' || !Array.isArray(obj.entries)) {
    throw new Error('Это не резервная копия «Ясной головы»');
  }
  await entries.putMany(obj.entries);
  return obj.entries.length;
}

export async function wipe() {
  const db = await open();
  await Promise.all(['entries', 'weather'].map((name) => new Promise((resolve, reject) => {
    const t = db.transaction(name, 'readwrite');
    t.objectStore(name).clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  })));
}
