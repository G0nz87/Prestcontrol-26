/* =====================================================
   RESET APP — borrar todos los datos del usuario
===================================================== */
function abrirResetApp() {
  document.getElementById('reset-master-pass').value = '';
  document.getElementById('reset-confirm-txt').value = '';
  document.getElementById('reset-app-err').classList.remove('on');
  openSheet('sh-reset-app');
}

/* =====================================================
   REPARACIÓN — buscar y limpiar cuotas duplicadas
===================================================== */
async function buscarCuotasDuplicadas() {
  toast('🔍 Analizando...');
  const [prestamos, cuotas] = await Promise.all([dbAll('prestamos'), dbAll('cuotas')]);

  const problemas = []; // { prestamo, esperadas, encontradas, duplicadas: [...] }

  for (const p of prestamos) {
    if (p.estado === 'Cancelado') continue;
    const misCuotas = cuotas.filter(c => c.prestamoId === p.id);
    const esperadas = p.nCuotas || 0;

    if (misCuotas.length <= esperadas) continue; // está bien

    // Agrupar por número de cuota
    const porNro = {};
    misCuotas.forEach(c => {
      const nro = c.nro;
      if (!porNro[nro]) porNro[nro] = [];
      porNro[nro].push(c);
    });

    const duplicadas = [];
    for (const nro of Object.keys(porNro)) {
      if (porNro[nro].length > 1) {
        // Ordenar: pagadas primero (para conservarlas), luego las más antiguas
        porNro[nro].sort((a, b) => {
          if (a.estado === 'Pagado' && b.estado !== 'Pagado') return -1;
          if (b.estado === 'Pagado' && a.estado !== 'Pagado') return 1;
          return new Date(a.creadoEn || 0) - new Date(b.creadoEn || 0);
        });
        // La primera se queda, el resto son duplicadas a borrar
        duplicadas.push(...porNro[nro].slice(1));
      }
    }

    if (duplicadas.length > 0) {
      problemas.push({
        prestamo: p,
        esperadas,
        encontradas: misCuotas.length,
        duplicadas
      });
    }
  }

  if (problemas.length === 0) {
    toast('✅ No hay cuotas duplicadas');
    return;
  }

  // Mostrar informe en un sheet
  const totalDupl = problemas.reduce((s, x) => s + x.duplicadas.length, 0);
  const html = `
    <div class="sheet-hdr">
      <div class="sheet-title">🔍 Cuotas duplicadas encontradas</div>
      <button class="sheet-close" onclick="closeSheet()">✕</button>
    </div>
    <div style="padding:0 4px 12px">
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="font-size:13px;font-weight:800;color:var(--red);margin-bottom:6px">⚠️ Se encontraron ${totalDupl} cuota${totalDupl!==1?'s':''} duplicada${totalDupl!==1?'s':''}</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.5">
          En ${problemas.length} préstamo${problemas.length!==1?'s':''}. Al reparar, se conservan las cuotas pagadas y la más antigua de cada número.
        </div>
      </div>
      ${problemas.map(pr => `
        <div class="card" style="margin-bottom:10px">
          <div style="font-weight:800;font-size:14px;color:var(--gold)">${pr.prestamo.clienteNombre}</div>
          <div style="font-size:12px;color:var(--muted);margin:4px 0 8px">
            ${pr.prestamo.id} · Esperadas: <b>${pr.esperadas}</b> · Encontradas: <b style="color:var(--red)">${pr.encontradas}</b>
          </div>
          <div style="font-size:12px;color:var(--txt)">
            ${pr.duplicadas.length} duplicada${pr.duplicadas.length!==1?'s':''} a eliminar:
            <div style="font-size:11px;color:var(--muted);margin-top:4px">
              ${pr.duplicadas.map(c => `• Cuota ${c.nro} — ${fmtMoney(c.monto)} — ${c.estado}`).join('<br>')}
            </div>
          </div>
        </div>
      `).join('')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <button class="btn btn-ghost" onclick="closeSheet()">Cancelar</button>
        <button class="btn btn-red" onclick='ejecutarLimpiezaDuplicadas(${JSON.stringify(problemas.flatMap(p=>p.duplicadas.map(c=>c.id)))})'>🗑️ Limpiar ${totalDupl} duplicada${totalDupl!==1?'s':''}</button>
      </div>
    </div>
  `;

  // Crear sheet temporal
  let sheetEl = document.getElementById('sh-dup');
  if (!sheetEl) {
    sheetEl = document.createElement('div');
    sheetEl.id = 'sh-dup';
    sheetEl.className = 'sheet';
    document.body.appendChild(sheetEl);
  }
  sheetEl.innerHTML = `<div class="sheet-box">${html}</div>`;
  openSheet('sh-dup');
}

async function ejecutarLimpiezaDuplicadas(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  closeSheet();
  toast('⏳ Limpiando duplicadas...');
  try {
    for (const id of ids) {
      await dbSoftDelete('cuotas', id);
      addToSyncQueue('cuotas', id, { _deleted: true, id });
    }
    await logBitacora('sistema', `Limpieza de duplicadas: ${ids.length} cuotas eliminadas`);
    pushInmediato();
    toast(`✅ ${ids.length} cuota${ids.length!==1?'s':''} duplicada${ids.length!==1?'s':''} eliminada${ids.length!==1?'s':''}`);
    await renderPage(curPage);
    await updateBadges();
  } catch(e) {
    toast('❌ Error: ' + e.message);
  }
}

async function ejecutarResetApp() {
  const masterInput = document.getElementById('reset-master-pass').value;
  const confirmTxt  = document.getElementById('reset-confirm-txt').value.trim();
  const errEl       = document.getElementById('reset-app-err');

  // Verificar texto de confirmación
  if (confirmTxt !== 'BORRAR TODO') {
    errEl.textContent = 'Escribí exactamente BORRAR TODO para confirmar';
    errEl.classList.add('on'); return;
  }

  if (!masterInput) {
    errEl.textContent = 'Ingresá tu contraseña para confirmar';
    errEl.classList.add('on'); return;
  }

  // Verificar contraseña contra Firebase Auth (la misma que usás para ingresar)
  let passValida = false;
  if (_fbUser && _fbAuth) {
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(_fbUser.email, masterInput);
      await _fbUser.reauthenticateWithCredential(credential);
      passValida = true;
    } catch(e) {
      console.warn('ejecutarResetApp reauth:', e.code);
    }
  } else {
    // Fallback offline
    const cred = await authGetCred();
    if (masterInput === cred.pass) passValida = true;
  }

  if (!passValida) {
    errEl.textContent = 'Contraseña incorrecta';
    errEl.classList.add('on');
    document.getElementById('reset-master-pass').value = '';
    return;
  }
  errEl.classList.remove('on');

  // Ejecutar borrado de todas las tablas del usuario
  closeSheet();
  toast('⏳ Borrando datos...');

  try {
    // 1. DETENER sync en tiempo real para que no re-baje datos viejos
    detenerSyncRealtime();

    // 2. Borrar colecciones de Firebase PRIMERO (para que al reconectar no vuelvan)
    if (_fbUser && _fbDb && navigator.onLine) {
      toast('⏳ Borrando de Firebase...');
      const colls = ['clientes','prestamos','cuotas'];
      for (const col of colls) {
        try {
          const snap = await _fbDb.collection('users').doc(_fbUser.uid).collection(col).get();
          // Borrar en lotes de 400 (límite Firestore: 500)
          let batch = _fbDb.batch();
          let count = 0;
          for (const doc of snap.docs) {
            batch.delete(doc.ref);
            count++;
            if (count >= 400) {
              await batch.commit();
              batch = _fbDb.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        } catch(e) {
          console.warn('Error borrando Firebase colección', col, e);
        }
      }
    }

    // 3. Borrar IndexedDB local
    const stores = ['clientes','prestamos','cuotas','config','bitacora','sync_queue','sync_meta'];
    for (const store of stores) {
      await new Promise(res => {
        const tx = DB.transaction(store, 'readwrite');
        const req = tx.objectStore(store).clear();
        req.onsuccess = () => res(true);
        req.onerror   = () => res(false);
      });
    }

    await logBitacora('sistema', 'Aplicación reseteada — todos los datos fueron eliminados (local + Firebase)');
    toast('✅ Todo eliminado correctamente.');

    // 4. Reiniciar sync en tiempo real (limpio)
    if (_fbUser) {
      setTimeout(() => iniciarSyncRealtime(), 500);
    }

    setTimeout(() => {
      renderPage('dashboard');
      updateBadges();
    }, 1200);
  } catch(e) {
    toast('❌ Error al resetear: ' + e.message);
  }
}

/* =====================================================
   BORRAR SOLO PRÉSTAMOS Y CUOTAS (conserva clientes)
===================================================== */
function abrirBorrarPrestamos() {
  document.getElementById('bp-pass').value = '';
  document.getElementById('bp-confirm-txt').value = '';
  document.getElementById('bp-err').classList.remove('on');
  openSheet('sh-borrar-prestamos');
}

async function ejecutarBorrarPrestamos() {
  const passInput  = document.getElementById('bp-pass').value;
  const confirmTxt = document.getElementById('bp-confirm-txt').value.trim();
  const errEl      = document.getElementById('bp-err');

  if (confirmTxt !== 'BORRAR PRESTAMOS') {
    errEl.textContent = 'Escribí exactamente BORRAR PRESTAMOS para confirmar';
    errEl.classList.add('on'); return;
  }

  if (!passInput) {
    errEl.textContent = 'Ingresá tu contraseña para confirmar';
    errEl.classList.add('on'); return;
  }

  // Verificar contraseña contra Firebase Auth
  let passValida = false;
  if (_fbUser && _fbAuth) {
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(_fbUser.email, passInput);
      await _fbUser.reauthenticateWithCredential(credential);
      passValida = true;
    } catch(e) {
      console.warn('ejecutarBorrarPrestamos reauth:', e.code);
    }
  } else {
    const cred = await authGetCred();
    if (passInput === cred.pass) passValida = true;
  }

  if (!passValida) {
    errEl.textContent = 'Contraseña incorrecta';
    errEl.classList.add('on');
    document.getElementById('bp-pass').value = '';
    return;
  }
  errEl.classList.remove('on');

  closeSheet();
  toast('⏳ Borrando préstamos y cuotas...');

  try {
    // Detener sync
    detenerSyncRealtime();

    // Borrar de Firebase SOLO prestamos y cuotas (mantener clientes)
    if (_fbUser && _fbDb && navigator.onLine) {
      for (const col of ['prestamos','cuotas']) {
        try {
          const snap = await _fbDb.collection('users').doc(_fbUser.uid).collection(col).get();
          let batch = _fbDb.batch();
          let count = 0;
          for (const doc of snap.docs) {
            batch.delete(doc.ref);
            count++;
            if (count >= 400) { await batch.commit(); batch = _fbDb.batch(); count = 0; }
          }
          if (count > 0) await batch.commit();
        } catch(e) { console.warn('Error borrando', col, e); }
      }
    }

    // Borrar de IndexedDB local SOLO prestamos, cuotas y bitacora (mantener clientes)
    for (const store of ['prestamos','cuotas','sync_queue']) {
      await new Promise(res => {
        const tx = DB.transaction(store, 'readwrite');
        const req = tx.objectStore(store).clear();
        req.onsuccess = () => res(true);
        req.onerror   = () => res(false);
      });
    }

    await logBitacora('sistema', 'Préstamos y cuotas eliminados — clientes conservados');
    toast('✅ Préstamos y cuotas eliminados. Clientes conservados.');

    // Reiniciar sync
    if (_fbUser) {
      setTimeout(() => iniciarSyncRealtime(), 500);
    }

    setTimeout(() => {
      renderPage('dashboard');
      updateBadges();
    }, 1200);
  } catch(e) {
    toast('❌ Error: ' + e.message);
  }
}

/* =====================================================
   LICENCIAS — desactivado (uso personal)
   Para activar en el futuro: implementar checkLicense con Supabase
===================================================== */
// requireLicense siempre devuelve true — acceso completo
function requireLicense(action) { return true; }
// checkLicense no hace nada — retorna 'full' siempre
async function checkLicense(username) { return 'full'; }

