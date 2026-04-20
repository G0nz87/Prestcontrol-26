/* =====================================================
   ADD PRÉSTAMO
===================================================== */
let _acClientes = []; // lista completa para el autocomplete

function openSheetPrestamo() {
  ['pre-monto','pre-interes','pre-ncuotas','pre-notas','pre-prenda'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pre-tipo').value = 'Mensual';
  document.getElementById('pre-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('pre-preview').style.display = 'none';
  limpiarClienteAC();

  dbAll('clientes').then(lista => {
    _acClientes = lista.filter(c => c.estado === 'Activo');
    if (!_acClientes.length) {
      document.getElementById('pre-cliente-search').placeholder = 'Sin clientes activos';
      document.getElementById('pre-cliente-search').disabled = true;
    } else {
      document.getElementById('pre-cliente-search').placeholder = 'Buscar cliente por nombre…';
      document.getElementById('pre-cliente-search').disabled = false;
    }
  });

  ['pre-monto','pre-interes','pre-ncuotas'].forEach(id => {
    document.getElementById(id).oninput = calcPreview;
  });

  openSheet('sh-prestamo');
}

function filtrarClientesAC(q) {
  const drop = document.getElementById('pre-cliente-drop');
  const selected = document.getElementById('pre-cliente').value;
  if (selected) return; // ya seleccionado, no abrir

  const r = q.trim().toLowerCase();
  const lista = r
    ? _acClientes.filter(c => c.nombre.toLowerCase().includes(r) || (c.telefono||'').includes(r))
    : _acClientes;

  if (!lista.length) {
    drop.innerHTML = `<div class="ac-item" style="color:var(--muted);cursor:default">Sin resultados</div>`;
  } else {
    drop.innerHTML = lista.slice(0, 8).map(c => {
      const nombre = esc(c.nombre);
      const marked = r ? nombre.replace(new RegExp(`(${r.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<b>$1</b>') : nombre;
      return `<div class="ac-item" onclick="seleccionarClienteAC('${esc(c.id)}','${esc(c.nombre)}')">${marked}${c.telefono?` <span style="color:var(--muted);font-size:11px">· ${esc(c.telefono)}</span>`:''}</div>`;
    }).join('');
  }
  drop.classList.add('on');
}

function seleccionarClienteAC(id, nombre) {
  document.getElementById('pre-cliente').value = id;
  document.getElementById('pre-cliente-search').value = '';
  document.getElementById('pre-cliente-search').style.display = 'none';
  document.getElementById('pre-cliente-drop').classList.remove('on');
  const tag = document.getElementById('pre-cliente-tag');
  document.getElementById('pre-cliente-tag-txt').textContent = '👤 ' + nombre;
  tag.classList.add('on');
}

function limpiarClienteAC() {
  document.getElementById('pre-cliente').value = '';
  document.getElementById('pre-cliente-search').value = '';
  document.getElementById('pre-cliente-search').style.display = '';
  document.getElementById('pre-cliente-search').focus && document.getElementById('pre-cliente-search').focus();
  document.getElementById('pre-cliente-drop').classList.remove('on');
  document.getElementById('pre-cliente-tag').classList.remove('on');
}

// Cerrar dropdown al tocar fuera
document.addEventListener('click', e => {
  if (!e.target.closest('.ac-wrap') && !e.target.closest('.ac-sel-tag')) {
    const drop = document.getElementById('pre-cliente-drop');
    if (drop) drop.classList.remove('on');
  }
});

function calcPreview() {
  const m    = parseFloat(document.getElementById('pre-monto').value)    || 0;
  const iPor = parseFloat(document.getElementById('pre-interes').value)  || 0; // tasa POR cuota
  const n    = parseInt(document.getElementById('pre-ncuotas').value)    || 0;
  const tipo = document.getElementById('pre-tipo')?.value || 'Mensual';
  const pv   = document.getElementById('pre-preview');

  // Actualizar hint dinámico
  const hintEl = document.getElementById('pre-interes-hint');
  const lblEl  = document.getElementById('pre-interes-lbl');
  if (hintEl && n > 0 && iPor > 0) {
    const totalPct = round2(iPor * n);
    const periodo  = tipo === 'Semanal' ? 'semana' : 'mes';
    hintEl.textContent = `${iPor}% × ${n} ${periodo}${n>1?'s':''} = ${totalPct}% total`;
  } else if (hintEl) {
    const periodo = tipo === 'Semanal' ? 'semana' : 'mes';
    hintEl.textContent = `Ej: 8% por ${periodo} × 4 cuotas = 32% total`;
  }
  if (lblEl) {
    lblEl.textContent = `Interés por ${tipo === 'Semanal' ? 'semana' : 'mes'} (%) *`;
  }

  if (m > 0 && n > 0 && iPor >= 0) {
    // NUEVA LÓGICA: interés por cuota × cantidad de cuotas
    const interesTotal = iPor / 100 * n; // tasa total = tasa_por_cuota × n
    const total        = round2(m * (1 + interesTotal));
    const cuota        = round2(total / n);
    const ganancia     = round2(total - m);

    document.getElementById('pv-total').textContent = fmtMoney(total);
    document.getElementById('pv-cuota').textContent = fmtMoney(cuota);
    document.getElementById('pv-gan').textContent   = fmtMoney(ganancia);

    const detEl = document.getElementById('pv-detalle');
    if (detEl) {
      const periodo = tipo === 'Semanal' ? 'sem.' : 'mes.';
      detEl.textContent =
        `${fmtMoney(m)} prestado · ${iPor}%/${periodo} · ${n} cuotas = ${round2(iPor*n)}% total`;
    }
    pv.style.display = 'block';
  } else {
    pv.style.display = 'none';
  }
}

async function savePrestamo() {
  const clienteId = document.getElementById('pre-cliente').value;
  const montoRaw  = document.getElementById('pre-monto').value;
  const interesRaw= document.getElementById('pre-interes').value;
  const ncuotasRaw= document.getElementById('pre-ncuotas').value;
  const tipo      = document.getElementById('pre-tipo').value;
  const fechaRaw  = document.getElementById('pre-fecha').value;

  if (!clienteId) return toast('⚠️ Seleccioná un cliente');
  const monto    = parseFloat(montoRaw);
  const intPorCuota = parseFloat(interesRaw); // % POR cuota (por semana o por mes)
  const nCuotas  = parseInt(ncuotasRaw);
  if (!monto || monto <= 0)          return toast('⚠️ Ingresá el monto');
  if (isNaN(intPorCuota) || intPorCuota < 0) return toast('⚠️ Ingresá el interés por cuota');
  if (!nCuotas || nCuotas <= 0)      return toast('⚠️ Ingresá el número de cuotas');
  if (!fechaRaw)                     return toast('⚠️ Ingresá la fecha');

  const cliente = await dbGet('clientes', clienteId);
  if (!cliente) return toast('⚠️ Cliente no encontrado');

  // NUEVA LÓGICA: tasa total = tasa_por_cuota × número de cuotas
  const interesTotal = intPorCuota / 100 * nCuotas; // ej: 8% × 4 = 0.32
  const total        = round2(monto * (1 + interesTotal));
  const cuota        = round2(total / nCuotas);
  const ganancia     = round2(total - monto);
  const fecha        = new Date(fechaRaw + 'T12:00:00');
  // Guardamos intPorCuota para referencia, e interesTotal como el porcentaje total
  const interes      = interesTotal; // compatibilidad con código existente (muestra %)

  const todos = await dbAll('prestamos');
  const preId = nextId('PR', todos);

  const nowISO = new Date().toISOString();
  const prestamo = {
    id: preId, clienteId, clienteNombre: cliente.nombre,
    fecha: fecha.toISOString(), monto,
    interes,           // tasa total acumulada (para compatibilidad y display)
    interesPorCuota: intPorCuota, // tasa por período (la que el usuario ingresó)
    tipo, nCuotas,
    total, cuota, ganancia, estado: 'Activo',
    notas: document.getElementById('pre-notas').value.trim(),
    prenda: document.getElementById('pre-prenda').value.trim(),
    creadoEn: nowISO,
    updatedAt: nowISO
  };

  await dbPut('prestamos', prestamo);

  // Generar cuotas
  const todasCuotas = await dbAll('cuotas');
  let maxN = 0;
  todasCuotas.forEach(c => {
    const m = String(c.id||'').match(/^C-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1]));
  });

  const cuotasArr = [];
  for (let i = 1; i <= nCuotas; i++) {
    const fvenc = calcVenc(fecha, tipo, i);
    cuotasArr.push({
      id         : `C-${String(maxN+i).padStart(3,'0')}`,
      prestamoId : preId,
      clienteId,
      clienteNombre: cliente.nombre,
      nro        : i,
      fechaVenc  : fvenc.toISOString(),
      monto      : cuota,
      estado     : 'Pendiente',
      fechaPago  : null,
      metodo     : null,
      notas      : '',
      creadoEn   : nowISO,
      updatedAt  : nowISO
    });
  }

  for (const c of cuotasArr) await dbPut('cuotas', c);

  // Sync queue — préstamo y cuotas
  await addToSyncQueue('prestamos', preId, prestamo, 'upsert');
  for (const c of cuotasArr) await addToSyncQueue('cuotas', c.id, c, 'upsert');

  await logBitacora('nuevo_prestamo', `Préstamo creado: ${cliente.nombre} · ${fmtMoney(monto)} · ${nCuotas} cuotas ${tipo}`, clienteId);

  closeSheet();
  toast(`✅ Préstamo creado · ${nCuotas} cuotas generadas`);
  pushInmediato(); // Push inmediato a Firebase
  // Auto-actualizar estados inmediatamente (cuotas atrasadas se detectan al instante)
  await autoUpdateEstados();
  await updateBadges();
  await renderPage('prestamos');
}

/* =====================================================
   PAGO DE CUOTA
===================================================== */
async function abrirPago(cuotaId) {
  const c = await dbGet('cuotas', cuotaId);
  if (!c) { toast('Cuota no encontrada'); return; }
  if (c.estado === 'Pagado') { toast('ℹ️ Ya está pagada'); return; }

  document.getElementById('pago-cuota-id').value = cuotaId;
  document.getElementById('sh-pago-info').textContent =
    `${c.clienteNombre} — Cuota ${c.nro} — ${fmtMoney(c.monto)}`;
  document.getElementById('pago-fecha').value = new Date().toISOString().split('T')[0];
  openSheet('sh-pago');
}

async function confirmarPago(metodo) {
  const cuotaId  = document.getElementById('pago-cuota-id').value;
  const fechaPago = document.getElementById('pago-fecha').value;
  const c = await dbGet('cuotas', cuotaId);
  if (!c) { toast('Error: cuota no encontrada'); closeSheet(); return; }

  // ANTI-DUPLICADO: verificar que no esté ya pagada
  if (c.estado === 'Pagado') {
    toast('⚠️ Esta cuota ya fue registrada como pagada');
    closeSheet(); return;
  }

  c.estado     = 'Pagado';
  c.fechaPago  = new Date(fechaPago + 'T12:00:00').toISOString();
  c.metodo     = metodo;
  c.updatedAt  = new Date().toISOString();

  // 1. Guardado local inmediato
  await dbPut('cuotas', c);

  // 2. Registrar en sync_queue
  await addToSyncQueue('cuotas', cuotaId, c, 'upsert');

  // 3. Bitácora
  await logBitacora('pago', `Pago registrado: ${c.clienteNombre} · Cuota ${c.nro} · ${fmtMoney(c.monto)} · ${metodo}`, c.clienteId);

  // 4. Sync estado préstamo
  await syncEstadoPrestamo(c.prestamoId);

  // 5. Drive — PUSH INMEDIATO para que aparezca en otros dispositivos al instante
  pushInmediato();

  closeSheet();

  if (['hoy','atrasadas','cobros'].includes(curPage)) {
    const el = document.getElementById('li-' + CSS.escape(cuotaId));
    if (el) { el.style.opacity='.4'; el.style.transition='opacity .4s'; setTimeout(()=>el.remove(),400); }
    await renderPage(curPage);
  } else if (curPage === 'prestamo-detail') {
    await openPrestamoDetail(c.prestamoId);
  } else if (curPage === 'inicio') {
    await renderPage('inicio');
  }
  await renderDashboard();

  // Primero renderizar, después toast, después recibo
  setTimeout(() => {
    toast('✅ Cuota registrada · ' + metodo);
    setTimeout(() => mostrarComprobanteApp(cuotaId), 1800);
  }, 300);
}

async function mostrarComprobanteApp(cuotaId) {
  const cuota = await dbGet('cuotas', cuotaId);
  if (!cuota) return;
  const prestamo = await dbGet('prestamos', cuota.prestamoId);
  const cliente  = await dbGet('clientes', cuota.clienteId || prestamo?.clienteId);

  const fechaPago = cuota.fechaPago ? new Date(cuota.fechaPago).toLocaleDateString('es-AR', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  }) : new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const telefono = cliente?.telefono || prestamo?.clienteTelefono || '';
  const cuotasPagadas = prestamo ? (await dbAll('cuotas')).filter(c => c.prestamoId === prestamo.id && c.estado === 'Pagado').length : '-';

  // Texto para WhatsApp
  const msgWA = encodeURIComponent(
    `✅ *Comprobante de Pago*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 Cliente: *${cuota.clienteNombre}*\n` +
    `🧾 Préstamo: ${cuota.prestamoId}\n` +
    `📋 Cuota: *${cuota.nro} de ${prestamo?.nCuotas || '?'}*\n` +
    `📅 Fecha: ${fechaPago}\n` +
    `💳 Método: ${cuota.metodo || 'Efectivo'}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 *MONTO PAGADO: ${fmtMoney(cuota.monto)}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ Cuotas pagadas: ${cuotasPagadas} de ${prestamo?.nCuotas || '?'}\n` +
    `_PrestControl_`
  );

  const waURL = telefono
    ? `https://wa.me/54${telefono.replace(/\D/g,'')}?text=${msgWA}`
    : `https://wa.me/?text=${msgWA}`;

  // Construir sheet del comprobante
  const sheetEl = document.getElementById('sheet-comprobante');
  const bodyEl  = document.getElementById('sheet-comprobante-body');
  if (!sheetEl || !bodyEl) return;

  bodyEl.innerHTML = `
    <!-- Header azul estilo banco -->
    <div style="background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:12px;padding:22px 18px;margin-bottom:16px;text-align:center">
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Comprobante de Pago</div>
      <div style="font-size:36px;font-weight:900;color:#fff;font-family:'DM Mono',monospace;letter-spacing:-1px">${fmtMoney(cuota.monto)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:6px">${fechaPago}</div>
    </div>

    <!-- Datos del comprobante -->
    <div style="background:var(--card);border-radius:12px;border:1px solid var(--border);overflow:hidden;margin-bottom:14px">
      ${[
        ['👤 Cliente',   cuota.clienteNombre || '—'],
        ['🧾 Préstamo',  cuota.prestamoId || '—'],
        ['📋 Cuota',     `${cuota.nro} de ${prestamo?.nCuotas || '?'}`],
        ['📅 Vencía',    fmtDate(cuota.fechaVenc)],
        ['💳 Método',    cuota.metodo || 'Efectivo'],
        ['✅ Cuotas OK', `${cuotasPagadas} de ${prestamo?.nCuotas || '?'} pagadas`],
      ].map(([label, value], i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;${i>0?'border-top:1px solid var(--border)':''}">
          <span style="font-size:13px;color:var(--muted)">${label}</span>
          <span style="font-size:13px;font-weight:700;color:var(--txt)">${value}</span>
        </div>
      `).join('')}
    </div>

    <!-- Sello PAGADO -->
    <div style="border:2px solid var(--grn);border-radius:10px;padding:10px;text-align:center;margin-bottom:16px;background:var(--grnBg)">
      <span style="font-size:14px;font-weight:900;color:var(--grn);letter-spacing:2px">✅ PAGADO</span>
    </div>

    <!-- Botones -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <button class="btn btn-grn" onclick="window.open('${waURL}','_blank')" style="gap:6px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg>
        WhatsApp
      </button>
      <button class="btn btn-ghost" onclick="imprimirComprobante('${cuotaId}')">
        🖨️ PDF
      </button>
    </div>
    <button class="btn btn-ghost btn-full" onclick="closeSheet()">Cerrar</button>
    <div style="text-align:center;font-size:11px;color:var(--muted);margin-top:10px">PrestControl · Sistema de Gestión</div>
  `;

  // Abrir sheet
  document.getElementById('overlay').classList.add('on');
  sheetEl.classList.add('on');
}

function mostrarOpcionRecibo(cuotaId) {
  mostrarComprobanteApp(cuotaId);
}

async function syncEstadoPrestamo(prestamoId) {
  const [prestamo, cuotas] = await Promise.all([
    dbGet('prestamos', prestamoId), dbAll('cuotas')
  ]);
  if (!prestamo || prestamo._deleted) return;
  const misCuotas = cuotas.filter(c => c.prestamoId === prestamoId && !c._deleted);
  if (!misCuotas.length) return;

  let nuevo;
  if (misCuotas.every(c => c.estado === 'Pagado')) {
    nuevo = 'Pagado';
  } else if (misCuotas.some(c => c.estado === 'Atrasado')) {
    nuevo = 'Atrasado';
  } else {
    nuevo = 'Activo';
  }

  if (prestamo.estado !== nuevo && prestamo.estado !== 'Cancelado') {
    prestamo.estado    = nuevo;
    prestamo.updatedAt = new Date().toISOString();
    await dbPut('prestamos', prestamo);
  }
}

/* =====================================================
   DELETE PRÉSTAMO
===================================================== */
let _deletePrestamoId = null;
let _deletePrestamoMotivo = null;

async function confirmarBorrarPrestamo(id) {
  const p = await dbGet('prestamos', id);
  if (!p) return;
  _deletePrestamoId = id;
  _deletePrestamoMotivo = null;

  const cuotas = (await dbAll('cuotas')).filter(c => c.prestamoId === id);
  const pagadas = cuotas.filter(c => c.estado === 'Pagado').length;
  const pendientes = cuotas.filter(c => c.estado !== 'Pagado').length;

  document.getElementById('dp-info').innerHTML =
    `<b>${p.clienteNombre}</b> · ${fmtMoney(p.monto)} · ${p.nCuotas} cuotas ${p.tipo}<br>
     <span style="color:var(--grn)">✅ ${pagadas} pagadas</span> &nbsp;
     <span style="color:var(--yel)">⏳ ${pendientes} pendientes</span>`;

  // Reset form
  document.getElementById('dp-pass').value = '';
  document.getElementById('dp-mot-texto').value = '';
  document.getElementById('dp-err').classList.remove('on');
  ['pago','perdon','error','otro'].forEach(m => {
    const btn = document.getElementById('dp-mot-' + m);
    if (btn) { btn.style.borderColor = ''; btn.style.color = ''; btn.style.background = ''; }
  });

  openSheet('sh-delete-prestamo');
}

function selMotivo(motivo) {
  _deletePrestamoMotivo = motivo;
  ['pago','perdon','error','otro'].forEach(m => {
    const btn = document.getElementById('dp-mot-' + m);
    if (!btn) return;
    if (m === motivo) {
      btn.style.borderColor = 'var(--gold)';
      btn.style.color       = 'var(--gold)';
      btn.style.background  = 'var(--goldBg)';
    } else {
      btn.style.borderColor = '';
      btn.style.color       = '';
      btn.style.background  = '';
    }
  });
}

async function confirmarBorrarPrestamoFinal() {
  const id       = _deletePrestamoId;
  const motivo   = _deletePrestamoMotivo;
  const pass     = document.getElementById('dp-pass').value;
  const motTexto = document.getElementById('dp-mot-texto').value.trim();
  const errEl    = document.getElementById('dp-err');

  if (!motivo) { toast('⚠️ Seleccioná un motivo'); return; }
  if (!pass)   { errEl.textContent = 'Ingresá tu contraseña para confirmar'; errEl.classList.add('on'); return; }

  // Verificar contraseña contra Firebase Auth (la misma que usás para ingresar)
  let passValida = false;
  if (_fbUser && _fbAuth) {
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(_fbUser.email, pass);
      await _fbUser.reauthenticateWithCredential(credential);
      passValida = true;
    } catch(e) {
      console.warn('confirmarBorrarPrestamoFinal reauth:', e.code);
    }
  } else {
    // Fallback offline: validar contra local
    const cred = await authGetCred();
    if (pass === cred.pass) passValida = true;
  }

  if (!passValida) {
    errEl.textContent = 'Contraseña incorrecta';
    errEl.classList.add('on');
    document.getElementById('dp-pass').value = '';
    return;
  }
  errEl.classList.remove('on');

  const pre = await dbGet('prestamos', id);
  const cuotas = await dbAll('cuotas');
  const motivoLabel = { pago:'Se pagó completo', perdon:'Se ejecutó la prenda', error:'Error de carga', otro:'Otro motivo' }[motivo] || motivo;
  const motivoFinal = motTexto ? `${motivoLabel}: ${motTexto}` : motivoLabel;
  const nowISO = new Date().toISOString();
  const fechaPago = nowISO.split('T')[0] + 'T12:00:00.000Z';

  // Cuotas del préstamo que no están ni borradas ni ya pagadas
  const cuotasPendientes = cuotas.filter(c => c.prestamoId === id && !c._deleted && c.estado !== 'Pagado');

  if (motivo === 'pago') {
    // ── SE PAGÓ COMPLETO ──
    // Las cuotas pendientes se marcan como PAGADAS (cuentan en cobrado/ganancia)
    // El préstamo pasa a estado "Pagado" (no Cancelado)
    for (const c of cuotasPendientes) {
      const cPagada = {
        ...c,
        estado:     'Pagado',
        fechaPago:  fechaPago,
        metodo:     'Cancelación total',
        notas:      (c.notas || '') + (motTexto ? ` · ${motTexto}` : ''),
        updatedAt:  nowISO
      };
      await dbPut('cuotas', cPagada);
      await addToSyncQueue('cuotas', c.id, cPagada, 'upsert');
    }
    if (pre) {
      const preActualizado = {
        ...pre,
        estado: 'Pagado',
        motivoCancelacion: motivoFinal,
        canceladoEn: nowISO,
        updatedAt: nowISO
      };
      await dbPut('prestamos', preActualizado);
      await addToSyncQueue('prestamos', id, preActualizado, 'upsert');
    }
    await logBitacora('pago_completo',
      `Préstamo cancelado por pago total: ${pre?.clienteNombre || id} · ${pre ? fmtMoney(pre.total) : ''} · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} cerrada${cuotasPendientes.length!==1?'s':''}`,
      pre?.clienteId
    );
    pushInmediato();
    closeSheet();
    toast(`✅ Préstamo cerrado como pagado · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} cancelada${cuotasPendientes.length!==1?'s':''}`);
    goPage('prestamos');
    return;
  }

  if (motivo === 'perdon') {
    // ── SE EJECUTÓ LA PRENDA ──
    // Las cuotas YA PAGADAS quedan como están (cuentan en cobrado)
    // Las cuotas pendientes se marcan como "Ejecutada" (no cuentan ni como deuda ni como cobrado)
    // El préstamo pasa a estado "Ejecutado"
    for (const c of cuotasPendientes) {
      const cEjec = {
        ...c,
        estado:    'Ejecutada',
        fechaPago: fechaPago,
        metodo:    'Prenda ejecutada',
        notas:     (c.notas || '') + (motTexto ? ` · ${motTexto}` : ''),
        updatedAt: nowISO
      };
      await dbPut('cuotas', cEjec);
      await addToSyncQueue('cuotas', c.id, cEjec, 'upsert');
    }
    if (pre) {
      const preActualizado = {
        ...pre,
        estado: 'Ejecutado',
        motivoCancelacion: motivoFinal,
        canceladoEn: nowISO,
        updatedAt: nowISO
      };
      await dbPut('prestamos', preActualizado);
      await addToSyncQueue('prestamos', id, preActualizado, 'upsert');
    }
    const yaPagadas = cuotas.filter(c => c.prestamoId === id && !c._deleted && c.estado === 'Pagado').length;
    await logBitacora('prenda_ejecutada',
      `Préstamo cerrado por ejecución de prenda: ${pre?.clienteNombre || id} · ${yaPagadas} cuota${yaPagadas!==1?'s':''} cobrada${yaPagadas!==1?'s':''} previamente · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} ejecutada${cuotasPendientes.length!==1?'s':''}`,
      pre?.clienteId
    );
    pushInmediato();
    closeSheet();
    toast(`🔒 Préstamo cerrado por prenda · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} ejecutada${cuotasPendientes.length!==1?'s':''}`);
    goPage('prestamos');
    return;
  }

  // ── ERROR DE CARGA / OTRO MOTIVO ──
  // Borrado lógico total (como antes) - para eliminar errores sin afectar balance
  if (pre) {
    await dbPut('prestamos', { ...pre, estado: 'Cancelado', motivoCancelacion: motivoFinal, canceladoEn: nowISO, updatedAt: nowISO });
  }
  for (const c of cuotasPendientes) {
    await dbSoftDelete('cuotas', c.id);
    addToSyncQueue('cuotas', c.id, { _deleted: true, id: c.id });
  }
  await dbSoftDelete('prestamos', id);
  addToSyncQueue('prestamos', id, { _deleted: true, id });

  await logBitacora('eliminacion',
    `Préstamo eliminado [${motivoFinal}]: ${pre?.clienteNombre || id} · ${pre ? fmtMoney(pre.monto) : ''}`,
    pre?.clienteId
  );
  pushInmediato();

  closeSheet();
  toast(`🗑️ Préstamo eliminado · ${motivoLabel}`);
  goPage('prestamos');
}

