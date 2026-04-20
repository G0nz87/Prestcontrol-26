/* =====================================================
   FIREBASE — AUTH + FIRESTORE (fuente de verdad)
   Reemplaza Google Drive y almacenamiento local
===================================================== */

const firebaseConfig = {
  apiKey:            "AIzaSyD2wKWooUfxxiJf-QjhI0X7vZ-NlB9ZKZ4",
  authDomain:        "prestcontrol-5e965.firebaseapp.com",
  projectId:         "prestcontrol-5e965",
  storageBucket:     "prestcontrol-5e965.firebasestorage.app",
  messagingSenderId: "296362364315",
  appId:             "1:296362364315:web:a4846f6dc1daf7c173253e"
};

// Firebase se inicializa cuando los scripts del CDN estén listos
let _fbAuth = null;
let _fbDb   = null;
let _fbUser = null;

function _initFirebase() {
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK no disponible — modo offline');
    return false;
  }
  try {
    // Evitar doble init
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    _fbAuth = firebase.auth();
    _fbDb   = firebase.firestore();
    _fbDb.enablePersistence().catch(() => {});
    return true;
  } catch(e) {
    console.warn('Firebase init error:', e);
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────
function _userCol(name) { return _fbDb.collection('users').doc(_fbUser.uid).collection(name); }
function _userDoc(name, id) { return _fbDb.collection('users').doc(_fbUser.uid).collection(name).doc(id); }

// ── Compatibilidad con código existente ──────────────
let driveAccessToken = null;
let driveSyncTimer   = null;
let drivePendingSync = false;
function getDriveClientId()     { return Promise.resolve(''); }
function guardarDriveClientId() { toast('ℹ️ Usamos Firebase'); }

function driveSetStatus(tipo, msg) {
  const el = document.getElementById('drive-status');
  if (!el) return;
  el.className = '';
  el.classList.add('on', tipo);
  el.innerHTML = tipo === 'syncing' ? `<span class="spin-icon">🔄</span> ${msg}`
    : tipo === 'ok' ? `☁️ ${msg}` : `⚠️ ${msg}`;
  if (tipo !== 'syncing') setTimeout(() => el.classList.remove('on'), 4000);
}

// ── CRUD Firebase ─────────────────────────────────────
async function fbGuardar(colName, id, data) {
  if (!_fbUser) return;
  await _userDoc(colName, id).set(
    { ...data, userId: _fbUser.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function fbEliminar(colName, id) {
  if (!_fbUser) return;
  await _userDoc(colName, id).set(
    { _deleted: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function fbObtenerTodos(colName) {
  if (!_fbUser) return [];
  const snap = await _userCol(colName).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── SYNC: subir datos locales a Firebase ──────────────
async function _pushToFirebase() {
  if (!_fbUser) return;

  // OPTIMIZACIÓN: Solo subir lo que está en sync_queue (cambios pendientes)
  // En vez de subir TODOS los clientes/prestamos/cuotas, subimos solo los IDs modificados
  const pending = await getSyncQueuePending();

  // Si no hay nada pendiente, no hacer nada
  if (!pending.length) {
    driveSetStatus('ok', 'Sincronizado ✓');
    drivePendingSync = false;
    return;
  }

  driveSetStatus('syncing', `Guardando ${pending.length} cambio${pending.length!==1?'s':''}...`);

  try {
    // Agrupar por store para hacer batches eficientes
    // Firestore limit: 500 ops/batch. Usamos 400 por seguridad.
    const BATCH_LIMIT = 400;
    let batch = _fbDb.batch();
    let opsInBatch = 0;
    const processedOps = []; // IDs de operaciones exitosas

    for (const op of pending) {
      try {
        // Obtener el dato actualizado del IndexedDB (por si cambió después de encolarse)
        // Para operaciones de borrado, usamos el payload guardado
        let data;
        if (op.operation === 'delete' || op.payload?._deleted) {
          data = { ...op.payload, _deleted: true };
        } else {
          // Leer del DB por si hay versión más reciente
          data = await dbGet(op.store, op.recordId).catch(() => null);
          if (!data) {
            // El registro ya no existe localmente, marcarlo como borrado
            data = { id: op.recordId, _deleted: true };
          }
        }

        const ref = _userDoc(op.store, op.recordId);
        batch.set(ref, {
          ...data,
          userId: _fbUser.uid,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        processedOps.push(op.opId);
        opsInBatch++;

        // Commit batch si llegó al límite
        if (opsInBatch >= BATCH_LIMIT) {
          await batch.commit();
          // Limpiar sync_queue de las ops ya subidas
          for (const opId of processedOps) await markSyncOpDone(opId);
          processedOps.length = 0;
          batch = _fbDb.batch();
          opsInBatch = 0;
        }
      } catch(e) {
        console.warn('Error procesando op:', op, e);
        await markSyncOpError(op.opId, e.message || 'error desconocido');
      }
    }

    // Commit del último batch si quedan ops
    if (opsInBatch > 0) {
      await batch.commit();
      for (const opId of processedOps) await markSyncOpDone(opId);
    }

    drivePendingSync = false;
    const now = new Date().toISOString();
    await setGlobalConfig('drive_last_sync_' + currentUser, now);
    driveSetStatus('ok', 'Guardado ✓');
  } catch(e) {
    console.warn('pushToFirebase error:', e);
    driveSetStatus('err', 'Error al guardar');
  }
}

// ── SYNC COMPLETO: solo se usa en reset, cambio de cuenta, o recuperación ──
// Sube TODO el contenido local a Firebase (operación pesada, no usar para sync normal)
async function _pushCompletoAFirebase() {
  if (!_fbUser) return;
  driveSetStatus('syncing', 'Sincronización completa...');
  try {
    const [clientes, prestamos, cuotas] = await Promise.all([
      dbAllIncludeDeleted('clientes'),
      dbAllIncludeDeleted('prestamos'),
      dbAllIncludeDeleted('cuotas')
    ]);

    // Batches de 400 ops para respetar límite Firestore (500)
    const BATCH_LIMIT = 400;
    let batch = _fbDb.batch();
    let opsInBatch = 0;

    const addToBatch = async (store, items) => {
      for (const item of items) {
        batch.set(_userDoc(store, item.id), { ...item, userId: _fbUser.uid }, { merge: true });
        opsInBatch++;
        if (opsInBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = _fbDb.batch();
          opsInBatch = 0;
        }
      }
    };

    await addToBatch('clientes', clientes);
    await addToBatch('prestamos', prestamos);
    await addToBatch('cuotas', cuotas);

    if (opsInBatch > 0) await batch.commit();

    drivePendingSync = false;
    const now = new Date().toISOString();
    await setGlobalConfig('drive_last_sync_' + currentUser, now);
    driveSetStatus('ok', 'Guardado ✓');
  } catch(e) {
    console.warn('pushCompletoAFirebase error:', e);
    driveSetStatus('err', 'Error al guardar');
  }
}

// ── SYNC: bajar datos de Firebase al dispositivo ──────
async function _pullFromFirebase() {
  if (!_fbUser) return false;
  driveSetStatus('syncing', 'Sincronizando...');
  try {
    const [fbClientes, fbPrestamos, fbCuotas] = await Promise.all([
      fbObtenerTodos('clientes'),
      fbObtenerTodos('prestamos'),
      fbObtenerTodos('cuotas')
    ]);

    let changed = false;
    const merge = async (store, rows) => {
      for (const r of rows) {
        const local = await dbGet(store, r.id).catch(() => null);
        if (!local) { await dbPut(store, r); changed = true; }
        else {
          const rTime = r.updatedAt?.toMillis?.() || new Date(r.updatedAt||0).getTime();
          const lTime = new Date(local.updatedAt||0).getTime();
          if (rTime > lTime) { await dbPut(store, r); changed = true; }
        }
      }
    };

    await merge('clientes',  fbClientes);
    await merge('prestamos', fbPrestamos);
    await merge('cuotas',    fbCuotas);

    if (changed) {
      await autoUpdateEstados();
      await updateBadges();
      await renderPage(curPage);
      driveSetStatus('ok', 'Sincronizado ✓');
    } else {
      driveSetStatus('ok', 'Al día ✓');
    }
    return true;
  } catch(e) {
    console.warn('pullFromFirebase error:', e);
    driveSetStatus('err', 'Error de sync');
    return false;
  }
}

async function driveSave()     { await _pushToFirebase(); }
async function driveLoad()     { return null; }
async function driveAutoSync() {
  await _pullFromFirebase();
  await _pushToFirebase();
}
async function driveConectar()     { toast('ℹ️ Usamos Firebase'); }
async function driveGuardarAhora() { await _pushToFirebase(); }
async function driveGetToken()     { return _fbUser ? 'firebase' : null; }
async function driveAuth()         { return _fbUser ? 'firebase' : null; }

let _syncDebounce = null;
function scheduleDriveSync() {
  drivePendingSync = true;
  if (appDesbloqueada && DB) {
    updateBadges();
    if (curPage === 'dashboard') renderDashboard();
  }
  clearTimeout(_syncDebounce);
  _syncDebounce = setTimeout(() => {
    if (appDesbloqueada && navigator.onLine && _fbUser) _pushToFirebase();
  }, 500);
}

// Push inmediato (sin debounce) — para acciones críticas como pagar cuotas
async function pushInmediato() {
  if (appDesbloqueada && navigator.onLine && _fbUser) {
    clearTimeout(_syncDebounce);
    drivePendingSync = true;
    await _pushToFirebase();
  }
}

window.addEventListener('online',  () => { if (_fbUser && drivePendingSync) _pushToFirebase(); });
window.addEventListener('offline', () => driveSetStatus('err', 'Sin internet — modo offline'));

// ── AUTENTICACIÓN FIREBASE ────────────────────────────
// username → email: gonzalo → gonzalo@prestcontrol.app
function _toFbEmail(username) {
  if (username.includes('@')) return username.toLowerCase();
  return username.toLowerCase() + '@prestcontrol.app';
}

async function fbRegistrar(username, password) {
  if (!_fbAuth && !_initFirebase()) return false;
  try {
    const cred = await _fbAuth.createUserWithEmailAndPassword(_toFbEmail(username), password);
    await cred.user.updateProfile({ displayName: username });
    await _fbDb.collection('users').doc(cred.user.uid).set({
      username, email: _toFbEmail(username), createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    _fbUser = cred.user;
    driveSetStatus('ok', 'Cuenta creada ✓');
    return true;
  } catch(e) {
    console.warn('fbRegistrar:', e.code, e.message);
    return false;
  }
}

async function fbLogin(username, password) {
  try {
    const cred = await _fbAuth.signInWithEmailAndPassword(_toFbEmail(username), password);
    _fbUser = cred.user;
    driveSetStatus('ok', 'Firebase conectado ✓');
    return true;
  } catch(e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' ||
        e.code === 'auth/wrong-password' || e.code === 'auth/invalid-login-credentials') return null;
    console.warn('fbLogin:', e.code);
    return false;
  }
}

// Actualizar email y contraseña del usuario Firebase actual (cuando cambian credenciales)
async function fbActualizarCredenciales(newUsername, newPassword) {
  if (!_fbUser) return false;
  try {
    const newEmail = _toFbEmail(newUsername);
    // Actualizar email si cambió el username
    if (_fbUser.email !== newEmail) {
      await _fbUser.updateEmail(newEmail);
    }
    // Actualizar contraseña
    await _fbUser.updatePassword(newPassword);
    // Actualizar displayName
    await _fbUser.updateProfile({ displayName: newUsername });
    // Actualizar doc en Firestore
    await _fbDb.collection('users').doc(_fbUser.uid).set(
      { username: newUsername, email: newEmail },
      { merge: true }
    );
    driveSetStatus('ok', 'Credenciales actualizadas ✓');
    return true;
  } catch(e) {
    console.warn('fbActualizarCredenciales:', e.code, e.message);
    // Si falla por token expirado, solo seguimos con lo que tenemos
    return false;
  }
}

// Llamado tras login normal
async function sincronizarConServidor(username, password) {
  if (!navigator.onLine) {
    driveSetStatus('err', 'Sin internet — modo offline');
    return;
  }
  driveSetStatus('syncing', 'Conectando con Firebase...');
  try {
    let ok = await fbLogin(username, password);
    if (ok === null) ok = await fbRegistrar(username, password); // primera vez
    if (!ok) { driveSetStatus('err', 'Error Firebase — offline'); return; }

    driveSetStatus('syncing', 'Bajando datos...');
    await _pullFromFirebase();
    await _pushToFirebase();

    // Timer sync cada 2 minutos
    clearInterval(driveSyncTimer);
    driveSyncTimer = setInterval(() => {
      if (navigator.onLine && appDesbloqueada && _fbUser) driveAutoSync();
    }, 2 * 60 * 1000);

  } catch(e) {
    console.warn('sincronizarConServidor:', e);
    driveSetStatus('err', 'Sin conexión — offline');
  }
}

// Llamado cuando el usuario CAMBIA sus credenciales (first-run o cambio de cuenta)
async function sincronizarCambiandoCredenciales(oldUsername, oldPassword, newUsername, newPassword) {
  if (!navigator.onLine) return;
  driveSetStatus('syncing', 'Actualizando cuenta...');
  try {
    // Primero loguear con credenciales VIEJAS para tener token fresco
    if (!_fbUser) {
      await fbLogin(oldUsername, oldPassword);
    }
    if (!_fbUser) {
      // Si no había cuenta vieja, registrar con nuevas credenciales directamente
      await fbRegistrar(newUsername, newPassword);
    } else {
      // Actualizar las credenciales de la cuenta existente
      await fbActualizarCredenciales(newUsername, newPassword);
    }
    // Sincronizar datos - push completo porque es primera vez con estas credenciales
    await _pullFromFirebase();
    await _pushCompletoAFirebase();

    clearInterval(driveSyncTimer);
    driveSyncTimer = setInterval(() => {
      if (navigator.onLine && appDesbloqueada && _fbUser) driveAutoSync();
    }, 2 * 60 * 1000);

  } catch(e) {
    console.warn('sincronizarCambiandoCredenciales:', e);
    driveSetStatus('err', 'Sin conexión — offline');
  }
}

/* =====================================================
   SYNC EN TIEMPO REAL — Firestore onSnapshot (render parcial)
===================================================== */
let _realtimeUnsub = [];
let _stoChangedStores = new Set(); // qué colecciones cambiaron desde última UI

// Mapa: qué colecciones afectan a qué vistas
const PAGE_DEPS = {
  'dashboard':       ['clientes','prestamos','cuotas'],
  'hoy':             ['cuotas'],
  'atrasadas':       ['cuotas'],
  'clientes':        ['clientes'],
  'prestamos':       ['prestamos','cuotas'],
  'cuotas':          ['cuotas','prestamos'],
  'calendario':      ['cuotas'],
  'cobros':          ['cuotas','clientes','prestamos'],
  'historial':       ['cuotas','prestamos'],
  'bitacora':        [],
  'config':          [],
  'cliente-detail':  ['clientes','prestamos','cuotas'],
  'prestamo-detail': ['prestamos','cuotas']
};

function iniciarSyncRealtime() {
  if (!_fbUser || !_fbDb) return;
  _realtimeUnsub.forEach(u => u());
  _realtimeUnsub = [];
  _stoChangedStores.clear();

  const uid = _fbUser.uid;
  let _debounce = null;

  const actualizarUI = () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(async () => {
      if (!appDesbloqueada) return;

      // Siempre actualizar badges y estados (rápido)
      await autoUpdateEstados();
      await updateBadges();

      // Solo re-renderizar si la página actual depende de algo que cambió
      const deps = PAGE_DEPS[curPage] || [];
      const needsRender = deps.some(d => _stoChangedStores.has(d));

      if (needsRender) {
        await renderPage(curPage);
      }

      _stoChangedStores.clear();
      driveSetStatus('ok', 'Sincronizado ✓');
    }, 100);
  };

  const listenCol = (colName, store) => {
    try {
      const unsub = _fbDb
        .collection('users').doc(uid).collection(colName)
        .onSnapshot({ includeMetadataChanges: false }, async (snapshot) => {
          let changed = false;
          for (const change of snapshot.docChanges()) {
            if (change.type === 'added' || change.type === 'modified') {
              const data = { id: change.doc.id, ...change.doc.data() };
              // Normalizar updatedAt de Firestore a ISO para consistencia
              if (data.updatedAt?.toMillis) {
                data.updatedAt = new Date(data.updatedAt.toMillis()).toISOString();
              }
              const local = await dbGet(store, data.id).catch(() => null);
              const rt = new Date(data.updatedAt || 0).getTime();
              const lt = new Date(local?.updatedAt || 0).getTime();
              // Aplicar si no existe localmente, o si el remoto es >= (evita perder cambios)
              if (!local || rt >= lt) { await dbPut(store, data); changed = true; }
            } else if (change.type === 'removed') {
              // También reaccionar a borrados remotos
              changed = true;
            }
          }
          if (changed) {
            _stoChangedStores.add(store);
            actualizarUI();
          }
        }, err => console.warn('onSnapshot error:', err));
      _realtimeUnsub.push(unsub);
    } catch(e) { console.warn('listenCol error:', e); }
  };

  listenCol('clientes',  'clientes');
  listenCol('prestamos', 'prestamos');
  listenCol('cuotas',    'cuotas');
  driveSetStatus('ok', '⚡ Tiempo real activo');
}

function detenerSyncRealtime() {
  _realtimeUnsub.forEach(u => u());
  _realtimeUnsub = [];
}

/* =====================================================
   FOTO DE PERFIL
===================================================== */
// Carga y guarda la foto en Firestore como base64
async function subirFotoPerfil(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > 500 * 1024) { toast('⚠️ La foto debe pesar menos de 500 KB'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    try {
      // Guardar en Firestore
      if (_fbDb && _fbUser) {
        await _fbDb.collection('users').doc(_fbUser.uid).set({ foto: base64 }, { merge: true });
      }
      // Guardar localmente también
      await setGlobalConfig('foto_perfil_' + currentUser, base64);
      // Actualizar badge
      actualizarFotoBadge(base64);
      toast('✅ Foto de perfil actualizada');
    } catch(e) { toast('⚠️ Error al guardar la foto'); }
  };
  reader.readAsDataURL(file);
}

// Actualiza el avatar en el badge de usuario
function actualizarPreviewFoto(input) {
  if (!input.files?.[0]) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const prev = document.getElementById('cfg-foto-preview');
    if (prev) prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(input.files[0]);
}

// Actualiza el avatar en el badge de usuario
function actualizarFotoBadge(fotoBase64) {
  const badge = document.getElementById('usr-badge');
  if (!badge) return;
  if (fotoBase64) {
    badge.innerHTML = `<img src="${fotoBase64}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0"> ${currentUser || ''}`;
  } else {
    // Avatar con inicial y color
    const inicial = (currentUser || '?')[0].toUpperCase();
    const colors = ['#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B','#EF4444'];
    const color  = colors[inicial.charCodeAt(0) % colors.length];
    badge.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${inicial}</span> ${currentUser || ''}`;
  }
  badge.style.display = 'inline-flex';
}

// Cargar foto al iniciar sesión
async function cargarFotoPerfil() {
  let foto = await getGlobalConfig('foto_perfil_' + currentUser).catch(() => null);
  if (!foto && _fbDb && _fbUser) {
    try {
      const doc = await _fbDb.collection('users').doc(_fbUser.uid).get();
      if (doc.exists && doc.data().foto) {
        foto = doc.data().foto;
        await setGlobalConfig('foto_perfil_' + currentUser, foto);
      }
    } catch(e) {}
  }
  actualizarFotoBadge(foto || null);
}

