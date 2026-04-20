/* =====================================================
   DATABASE — IndexedDB (por usuario)
===================================================== */
let DB;
const DB_VER = 4;
const GLOBAL_DB_NAME = 'PrestamosApp_global';
const GLOBAL_DB_VER  = 2;
let GLOBAL_DB;

function getUserDbName(username) {
  return 'PrestamosApp_' + (username || 'default');
}

function initGlobalDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('usuarios'))
        db.createObjectStore('usuarios', { keyPath: 'username' });
      if (!db.objectStoreNames.contains('config'))
        db.createObjectStore('config', { keyPath: 'key' });
    };
    req.onsuccess = e => { GLOBAL_DB = e.target.result; res(); };
    req.onerror   = e => rej(e.target.error);
  });
}

function initDB(username) {
  const DB_NAME = getUserDbName(username);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('clientes'))
        db.createObjectStore('clientes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('prestamos'))
        db.createObjectStore('prestamos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cuotas'))
        db.createObjectStore('cuotas', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('config'))
        db.createObjectStore('config', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('bitacora'))
        db.createObjectStore('bitacora', { keyPath: 'id' });
      // v4: cola de sync y metadatos
      if (!db.objectStoreNames.contains('sync_queue'))
        db.createObjectStore('sync_queue', { keyPath: 'opId' });
      if (!db.objectStoreNames.contains('sync_meta'))
        db.createObjectStore('sync_meta', { keyPath: 'key' });
    };
    req.onsuccess = e => { DB = e.target.result; res(); };
    req.onerror   = e => rej(e.target.error);
  });
}

function dbAll(store) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      // Filtrar registros marcados como eliminados en stores críticos
      const filtered = STAMPED_STORES.includes(store)
        ? all.filter(r => !r._deleted)
        : all;
      res(filtered);
    };
    req.onerror = () => rej(req.error);
  });
}

// Versión que incluye eliminados (para sync y backup)
function dbAllIncludeDeleted(store) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// dbPut con timestamps automáticos en stores críticos
const STAMPED_STORES = ['clientes','prestamos','cuotas'];
function dbPut(store, obj) {
  const now = new Date().toISOString();
  const stamped = STAMPED_STORES.includes(store)
    ? { ...obj, updatedAt: now, createdAt: obj.createdAt || now }
    : obj;
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(stamped);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// Borrado lógico para datos críticos — marca deletedAt en vez de borrar
async function dbSoftDelete(store, key) {
  try {
    const existing = await dbGet(store, key);
    if (existing) {
      await dbPut(store, { ...existing, deletedAt: new Date().toISOString(), _deleted: true });
    }
  } catch(e) { /* si falla, borrado físico como fallback */ }
}

// Borrado físico — solo para bitácora y datos no críticos
function dbDel(store, key) {
  return new Promise((res, rej) => {
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

async function getConfig(key) {
  const r = await dbGet('config', key);
  return r ? r.value : null;
}
async function setConfig(key, value) {
  await dbPut('config', { key, value });
}

// Config global (independiente del usuario — para lista de usuarios)
function globalDbGet(store, key) {
  return new Promise((res, rej) => {
    if (!GLOBAL_DB) { res(null); return; }
    const tx  = GLOBAL_DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
function globalDbPut(store, obj) {
  return new Promise((res, rej) => {
    if (!GLOBAL_DB) { res(null); return; }
    const tx  = GLOBAL_DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
function globalDbAll(store) {
  return new Promise((res, rej) => {
    if (!GLOBAL_DB) { res([]); return; }
    const tx  = GLOBAL_DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}
async function getGlobalConfig(key) {
  const r = await globalDbGet('config', key);
  return r ? r.value : null;
}
async function setGlobalConfig(key, value) {
  await globalDbPut('config', { key, value });
}

/* =====================================================
   SYNC QUEUE — cola de operaciones pendientes
===================================================== */
let _syncProcessing = false;

async function addToSyncQueue(store, recordId, payload, operation = 'upsert') {
  if (!DB) return;
  try {
    const opId = `sq_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const entry = {
      opId, store, recordId, payload, operation,
      createdAt:  new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
      estado:     'pending',
      retryCount: 0,
      lastError:  null
    };
    await dbPut('sync_queue', entry);
    updateSyncPendingBadge();
  } catch(e) { /* no interrumpir flujo */ }
}

async function getSyncQueuePending() {
  if (!DB) return [];
  try {
    const all = await new Promise((res, rej) => {
      const tx  = DB.transaction('sync_queue','readonly');
      const req = tx.objectStore('sync_queue').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
    return all.filter(o => o.estado === 'pending' || o.estado === 'error');
  } catch(e) { return []; }
}

async function markSyncOpDone(opId) {
  if (!DB) return;
  try {
    const tx  = DB.transaction('sync_queue','readwrite');
    const req = tx.objectStore('sync_queue').delete(opId);
    await new Promise(r => { req.onsuccess = r; req.onerror = r; });
    updateSyncPendingBadge();
  } catch(e) {}
}

async function markSyncOpError(opId, error) {
  if (!DB) return;
  try {
    const tx  = DB.transaction('sync_queue','readwrite');
    const s   = tx.objectStore('sync_queue');
    const existing = await new Promise(r => { const q=s.get(opId); q.onsuccess=()=>r(q.result); q.onerror=()=>r(null); });
    if (existing) {
      existing.estado     = existing.retryCount >= 3 ? 'error' : 'pending';
      existing.retryCount = (existing.retryCount || 0) + 1;
      existing.lastError  = String(error);
      existing.updatedAt  = new Date().toISOString();
      s.put(existing);
    }
  } catch(e) {}
}

async function updateSyncPendingBadge() {
  if (!DB) return;
  const pending = await getSyncQueuePending();
  const badge   = document.getElementById('sync-pending-badge');
  if (badge) badge.classList.toggle('on', pending.length > 0);
}

/* =====================================================
   SYNC META — estado de sincronización
===================================================== */
const DEVICE_ID = localStorage.getItem('deviceId') || (() => {
  const id = 'dev_' + Date.now().toString(36);
  localStorage.setItem('deviceId', id);
  return id;
})();

async function getSyncMeta() {
  if (!DB) return {};
  try {
    const tx  = DB.transaction('sync_meta','readonly');
    const req = tx.objectStore('sync_meta').getAll();
    const arr = await new Promise(r => { req.onsuccess=()=>r(req.result||[]); req.onerror=()=>r([]); });
    return arr.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  } catch(e) { return {}; }
}

async function setSyncMeta(key, value) {
  if (!DB) return;
  try {
    const tx  = DB.transaction('sync_meta','readwrite');
    tx.objectStore('sync_meta').put({ key, value });
  } catch(e) {}
}

