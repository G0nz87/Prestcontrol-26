// UI handlers de Prestamos. Disparados desde onclick="..." del HTML.
// Delegan validacion + calculo + generacion de cuotas a window.prestamoService;
// persistencia local (IndexedDB) y sync queue siguen viviendo en el inline.
//
// NO migrados aun (otros sub-steps o renders):
// - openPrestamoDetail (render-heavy: ~50 lineas de template HTML)
// - filtrarClientesAC / seleccionarClienteAC / limpiarClienteAC / calcPreview (AC del sheet)
// - abrirPago / confirmarPago (cuota, no prestamo)
// - imprimirComprobantePrestamo / enviarWACuota (utility actions)

export function openSheetPrestamo(clientePreseleccionadoId = null) {
  ['pre-monto','pre-interes','pre-ncuotas','pre-notas','pre-prenda'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pre-tipo').value = 'Mensual';
  document.getElementById('pre-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('pre-preview').style.display = 'none';
  window.limpiarClienteAC();

  window.dbAll('clientes').then(lista => {
    window._acClientes = lista.filter(c => ['Activo', 'Bloqueado'].includes(c.estado));
    if (!window._acClientes.length) {
      document.getElementById('pre-cliente-search').placeholder = 'Sin clientes disponibles';
      document.getElementById('pre-cliente-search').disabled = true;
    } else {
      document.getElementById('pre-cliente-search').placeholder = 'Buscar cliente por nombre…';
      document.getElementById('pre-cliente-search').disabled = false;
    }
    if (clientePreseleccionadoId) {
      const cliente = window._acClientes.find(c => c.id === clientePreseleccionadoId);
      if (cliente && cliente.estado !== 'Bloqueado') {
        window.seleccionarClienteAC(cliente.id, cliente.nombre);
      }
    }
  });

  ['pre-monto','pre-interes','pre-ncuotas'].forEach(id => {
    document.getElementById(id).oninput = window.calcPreview;
  });

  window.openSheet('sh-prestamo');
}

export async function savePrestamo() {
  const clienteId = document.getElementById('pre-cliente').value;
  const montoRaw  = document.getElementById('pre-monto').value;
  const interesRaw= document.getElementById('pre-interes').value;
  const ncuotasRaw= document.getElementById('pre-ncuotas').value;
  const tipo      = document.getElementById('pre-tipo').value;
  const fechaRaw  = document.getElementById('pre-fecha').value;

  const monto       = parseFloat(montoRaw);
  const intPorCuota = parseFloat(interesRaw); // % POR cuota (por semana o por mes)
  const nCuotas     = parseInt(ncuotasRaw);

  // Validacion delegada al service
  try {
    window.prestamoService.validarDatosPrestamo({
      clienteId, monto, tasaPorCuota: intPorCuota, nCuotas, fecha: fechaRaw
    });
  } catch (e) {
    return window.toast('⚠️ ' + e.message);
  }

  const cliente = await window.dbGet('clientes', clienteId);
  if (cliente?.estado === 'Bloqueado') {
    return window.toast('Cliente bloqueado. No puede recibir nuevos préstamos.');
  }
  if (!cliente) return window.toast('⚠️ Cliente no encontrado');

  // Calculo financiero delegado al service
  const { interesTotal, total, cuotaMonto, ganancia } =
    window.prestamoService.calcularPlanPagos(monto, intPorCuota, nCuotas);
  const fecha = new Date(fechaRaw + 'T12:00:00');

  const todos = await window.dbAll('prestamos');
  const preId = window.nextId('PR', todos);

  const nowISO = new Date().toISOString();
  const prestamo = {
    id: preId, clienteId, clienteNombre: cliente.nombre,
    fecha: fecha.toISOString(), monto,
    interes: interesTotal,            // tasa total acumulada (compatibilidad y display)
    interesPorCuota: intPorCuota,     // tasa por período (la que el usuario ingresó)
    tipo, nCuotas,
    total, cuota: cuotaMonto, ganancia,
    estado: 'Activo',
    notas: document.getElementById('pre-notas').value.trim(),
    prenda: document.getElementById('pre-prenda').value.trim(),
    creadoEn: nowISO,
    updatedAt: nowISO
  };

  await window.dbPut('prestamos', prestamo);

  // Generacion de cuotas delegada al service (id base se calcula leyendo IndexedDB local)
  const todasCuotas = await window.dbAll('cuotas');
  let maxN = 0;
  todasCuotas.forEach(c => {
    const m = String(c.id||'').match(/^C-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1]));
  });

  const cuotasArr = window.prestamoService.generarCuotas({
    prestamoId    : preId,
    clienteId,
    clienteNombre : cliente.nombre,
    fechaInicio   : fecha,
    tipo,
    nCuotas,
    cuotaMonto,
    primerNumeroId: maxN + 1,
    nowISO
  });

  for (const c of cuotasArr) await window.dbPut('cuotas', c);

  // Sync queue — préstamo y cuotas
  await window.addToSyncQueue('prestamos', preId, prestamo, 'upsert');
  for (const c of cuotasArr) await window.addToSyncQueue('cuotas', c.id, c, 'upsert');

  await window.logBitacora('nuevo_prestamo', `Préstamo creado: ${cliente.nombre} · ${window.fmtMoney(monto)} · ${nCuotas} cuotas ${tipo}`, clienteId);

  window.closeSheet();
  window.toast(`✅ Préstamo creado · ${nCuotas} cuotas generadas`);
  window.pushInmediato();
  await window.autoUpdateEstados();
  await window.updateBadges();
  await window.renderPage('prestamos');
}

function getRenovacionInputs() {
  const cuotaId = document.getElementById('ren-cuota')?.value || '';
  const montoNominal = Number(document.getElementById('ren-monto')?.value || 0);
  const interesPorCuota = Number(document.getElementById('ren-interes')?.value || 0);
  const nCuotas = Number.parseInt(document.getElementById('ren-ncuotas')?.value || '0', 10);
  const tipo = document.getElementById('ren-tipo')?.value || 'Mensual';
  const fechaRaw = document.getElementById('ren-fecha')?.value || '';
  return { cuotaId, montoNominal, interesPorCuota, nCuotas, tipo, fechaRaw };
}

function setRenovacionError(message) {
  const err = document.getElementById('ren-error');
  if (!err) return;
  err.textContent = message || '';
  err.classList.toggle('on', !!message);
}

function maxCuotaNumero(cuotas) {
  let maxN = 0;
  (cuotas || []).forEach(c => {
    const m = String(c.id || '').match(/^C-(\d+)$/);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  });
  return maxN;
}

export async function abrirRenovacionPrestamo(prestamoId) {
  const [prestamo, cuotas] = await Promise.all([
    window.dbGet('prestamos', prestamoId),
    window.dbAll('cuotas')
  ]);
  if (!prestamo || prestamo._deleted) return window.toast('Prestamo no encontrado');
  if (!['Activo', 'Atrasado'].includes(prestamo.estado)) {
    return window.toast('Solo se pueden renovar prestamos activos o atrasados');
  }

  const clienteActual = await window.dbGet('clientes', prestamo.clienteId);
  if (clienteActual?.estado === 'Bloqueado') {
    return window.toast('Cliente bloqueado. No puede recibir nuevos prestamos.');
  }

  const mapaPrestamos = new Map([[prestamo.id, prestamo]]);
  const cuotasCobrables = cuotas
    .filter(c => c.prestamoId === prestamo.id && window.esCuotaCobrable(c, mapaPrestamos))
    .sort((a, b) => Number(a.nro || 0) - Number(b.nro || 0));
  if (!cuotasCobrables.length) {
    return window.toast('Este prestamo no tiene cuotas cobrables para compensar');
  }

  window._renovacionPrestamoId = prestamo.id;
  document.getElementById('ren-origen').innerHTML =
    `<b>${window.esc(prestamo.clienteNombre || '')}</b> · ${window.esc(prestamo.id)} · ${window.fmtMoney(prestamo.monto)}`;
  document.getElementById('ren-cuota').innerHTML = cuotasCobrables.map(c =>
    `<option value="${window.esc(c.id)}">Cuota ${window.esc(c.nro)} · ${window.fmtMoney(c.monto)} · vence ${window.fmtDate(c.fechaVenc)}</option>`
  ).join('');
  document.getElementById('ren-monto').value = prestamo.monto || '';
  document.getElementById('ren-interes').value = prestamo.interesPorCuota != null
    ? prestamo.interesPorCuota
    : window.round2(Number(prestamo.interes || 0) * 100 / Math.max(Number(prestamo.nCuotas || 1), 1));
  document.getElementById('ren-ncuotas').value = prestamo.nCuotas || '';
  document.getElementById('ren-tipo').value = prestamo.tipo || 'Mensual';
  document.getElementById('ren-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('ren-prenda').value = prestamo.prenda || '';
  document.getElementById('ren-notas').value = `Renovacion de ${prestamo.id}`;
  setRenovacionError('');
  calcularPreviewRenovacion();
  window.openSheet('sh-renovar-prestamo');
}

export function calcularPreviewRenovacion() {
  const prestamoId = window._renovacionPrestamoId;
  const cuotaId = document.getElementById('ren-cuota')?.value;
  const preview = document.getElementById('ren-preview');
  if (!preview || !prestamoId || !cuotaId) return;

  const { montoNominal, interesPorCuota, nCuotas } = getRenovacionInputs();
  window.dbGet('cuotas', cuotaId).then(cuota => {
    if (!cuota) return;
    const montoCompensado = Number(cuota.monto || 0);
    const montoEntregado = montoNominal - montoCompensado;
    if (!montoNominal || !nCuotas || !Number.isFinite(interesPorCuota)) {
      preview.style.display = 'none';
      return;
    }
    const { total, cuotaMonto, ganancia } =
      window.prestamoService.calcularPlanPagos(montoNominal, interesPorCuota, nCuotas);
    document.getElementById('ren-pv-total').textContent = window.fmtMoney(total);
    document.getElementById('ren-pv-cuota').textContent = window.fmtMoney(cuotaMonto);
    document.getElementById('ren-pv-gan').textContent = window.fmtMoney(ganancia);
    document.getElementById('ren-pv-detalle').textContent =
      `Compensa ${window.fmtMoney(montoCompensado)} · Entrega real ${window.fmtMoney(montoEntregado)}`;
    preview.style.display = '';
  }).catch(() => { preview.style.display = 'none'; });
}

export async function confirmarRenovacionPrestamo() {
  const btn = document.getElementById('ren-save');
  const prestamoOrigenId = window._renovacionPrestamoId;
  if (!prestamoOrigenId || btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Renovando...'; }
  setRenovacionError('');

  try {
    const { cuotaId, montoNominal, interesPorCuota, nCuotas, tipo, fechaRaw } = getRenovacionInputs();
    window.prestamoService.validarDatosPrestamo({
      clienteId: 'renovacion',
      monto: montoNominal,
      tasaPorCuota: interesPorCuota,
      nCuotas,
      fecha: fechaRaw
    });
    if (!['Mensual', 'Semanal'].includes(tipo)) throw new Error('Selecciona una frecuencia valida');

    const [prestamoOrigen, cuotaCompensada, prestamos, cuotasTodas] = await Promise.all([
      window.dbGet('prestamos', prestamoOrigenId),
      window.dbGet('cuotas', cuotaId),
      window.dbAll('prestamos'),
      window.dbAll('cuotas')
    ]);
    if (!prestamoOrigen || prestamoOrigen._deleted) throw new Error('Prestamo origen no encontrado');
    if (!['Activo', 'Atrasado'].includes(prestamoOrigen.estado)) throw new Error('Solo se pueden renovar prestamos activos o atrasados');

    const cliente = await window.dbGet('clientes', prestamoOrigen.clienteId);
    if (cliente?.estado === 'Bloqueado') throw new Error('Cliente bloqueado. No puede recibir nuevos prestamos.');

    const mapaPrestamos = new Map([[prestamoOrigen.id, prestamoOrigen]]);
    if (!cuotaCompensada || cuotaCompensada.prestamoId !== prestamoOrigenId || !window.esCuotaCobrable(cuotaCompensada, mapaPrestamos)) {
      throw new Error('Selecciona una cuota cobrable completa');
    }

    const montoCompensado = Number(cuotaCompensada.monto || 0);
    const montoEntregado = window.round2(montoNominal - montoCompensado);
    if (montoEntregado < 0) throw new Error('El monto entregado no puede ser negativo');

    const fecha = new Date(fechaRaw + 'T12:00:00');
    if (Number.isNaN(fecha.getTime())) throw new Error('Ingresa una fecha valida');
    const { interesTotal, total, cuotaMonto, ganancia } =
      window.prestamoService.calcularPlanPagos(montoNominal, interesPorCuota, nCuotas);

    const preId = window.nextId('PR', prestamos);
    const nowISO = new Date().toISOString();
    const nuevoPrestamo = {
      id: preId,
      clienteId: prestamoOrigen.clienteId,
      clienteNombre: prestamoOrigen.clienteNombre,
      fecha: fecha.toISOString(),
      monto: montoNominal,
      interes: interesTotal,
      interesPorCuota,
      tipo,
      nCuotas,
      total,
      cuota: cuotaMonto,
      ganancia,
      estado: 'Activo',
      notas: document.getElementById('ren-notas').value.trim(),
      prenda: document.getElementById('ren-prenda').value.trim(),
      origen: 'renovacion',
      prestamoOrigenId,
      renovacionTipo: 'descuento_cuota',
      montoNominal,
      montoEntregado,
      montoCompensado,
      cuotasCompensadas: [cuotaId],
      creadoEn: nowISO,
      updatedAt: nowISO
    };

    const cuotasNuevas = window.prestamoService.generarCuotas({
      prestamoId: preId,
      clienteId: prestamoOrigen.clienteId,
      clienteNombre: prestamoOrigen.clienteNombre,
      fechaInicio: fecha,
      tipo,
      nCuotas,
      cuotaMonto,
      primerNumeroId: maxCuotaNumero(cuotasTodas) + 1,
      nowISO
    });

    const cuotaActualizada = {
      ...cuotaCompensada,
      estado: 'Pagado',
      metodo: 'Renovación',
      origenPago: 'renovacion_descuento',
      montoEfectivo: 0,
      montoCompensado,
      prestamoRenovacionId: preId,
      fechaPago: nowISO,
      updatedAt: nowISO
    };

    const cuotasOrigenActualizadas = cuotasTodas.map(c => c.id === cuotaId ? cuotaActualizada : c);
    const quedanCobrables = cuotasOrigenActualizadas.some(c =>
      c.prestamoId === prestamoOrigenId && window.esCuotaCobrable(c, mapaPrestamos)
    );
    const quedanAtrasadas = cuotasOrigenActualizadas.some(c =>
      c.prestamoId === prestamoOrigenId && window.esCuotaCobrable(c, mapaPrestamos) && c.estado === 'Atrasado'
    );
    const prestamoOrigenActualizado = quedanCobrables
      ? {
          ...prestamoOrigen,
          estado: quedanAtrasadas ? 'Atrasado' : 'Activo',
          prestamoRenovacionId: preId,
          renovadoEn: nowISO,
          updatedAt: nowISO
        }
      : {
          ...prestamoOrigen,
          estado: 'Pagado',
          cerradoPor: 'renovacion',
          prestamoRenovacionId: preId,
          renovadoEn: nowISO,
          updatedAt: nowISO
        };

    await window.dbPut('prestamos', nuevoPrestamo);
    for (const c of cuotasNuevas) await window.dbPut('cuotas', c);
    await window.dbPut('cuotas', cuotaActualizada);
    await window.dbPut('prestamos', prestamoOrigenActualizado);

    await window.addToSyncQueue('prestamos', preId, nuevoPrestamo, 'upsert');
    for (const c of cuotasNuevas) await window.addToSyncQueue('cuotas', c.id, c, 'upsert');
    await window.addToSyncQueue('cuotas', cuotaId, cuotaActualizada, 'upsert');
    await window.addToSyncQueue('prestamos', prestamoOrigenId, prestamoOrigenActualizado, 'upsert');

    await window.logBitacora('renovacion',
      `Renovacion: ${prestamoOrigenId} -> ${preId} · Nominal ${window.fmtMoney(montoNominal)} · Compensado ${window.fmtMoney(montoCompensado)} · Entregado ${window.fmtMoney(montoEntregado)}`,
      prestamoOrigen.clienteId
    );

    window.closeSheet();
    window.toast('Prestamo renovado correctamente');
    window.pushInmediato();
    await window.updateBadges();
    await window.openPrestamoDetail(preId);
  } catch (e) {
    setRenovacionError(e.message || 'No se pudo renovar el prestamo');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Crear renovacion'; }
  }
}

export async function confirmarBorrarPrestamo(id) {
  const p = await window.dbGet('prestamos', id);
  if (!p) return;
  window._deletePrestamoId = id;
  window._deletePrestamoMotivo = null;

  const cuotas = (await window.dbAll('cuotas')).filter(c => c.prestamoId === id);
  const pagadas = cuotas.filter(c => c.estado === 'Pagado').length;
  const pendientes = cuotas.filter(c => c.estado !== 'Pagado').length;

  document.getElementById('dp-info').innerHTML =
    `<b>${p.clienteNombre}</b> · ${window.fmtMoney(p.monto)} · ${p.nCuotas} cuotas ${p.tipo}<br>
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

  window.openSheet('sh-delete-prestamo');
}

export function selMotivo(motivo) {
  window._deletePrestamoMotivo = motivo;
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

export async function confirmarBorrarPrestamoFinal() {
  const id       = window._deletePrestamoId;
  const motivo   = window._deletePrestamoMotivo;
  const pass     = document.getElementById('dp-pass').value;
  const motTexto = document.getElementById('dp-mot-texto').value.trim();
  const errEl    = document.getElementById('dp-err');

  if (!motivo) { window.toast('⚠️ Seleccioná un motivo'); return; }
  if (!pass)   { errEl.textContent = 'Ingresá tu contraseña para confirmar'; errEl.classList.add('on'); return; }

  // Verificar contraseña contra Firebase Auth (la misma que usás para ingresar)
  let passValida = false;
  if (window._fbUser && window._fbAuth) {
    try {
      const credential = window.firebase.auth.EmailAuthProvider.credential(window._fbUser.email, pass);
      await window._fbUser.reauthenticateWithCredential(credential);
      passValida = true;
    } catch(e) {
      console.warn('confirmarBorrarPrestamoFinal reauth:', e.code);
    }
  } else {
    // Fallback offline: validar contra local
    const cred = await window.authGetCred();
    if (pass === cred.pass) passValida = true;
  }

  if (!passValida) {
    errEl.textContent = 'Contraseña incorrecta';
    errEl.classList.add('on');
    document.getElementById('dp-pass').value = '';
    return;
  }
  errEl.classList.remove('on');

  const pre = await window.dbGet('prestamos', id);
  const cuotas = await window.dbAll('cuotas');
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
      await window.dbPut('cuotas', cPagada);
      await window.addToSyncQueue('cuotas', c.id, cPagada, 'upsert');
    }
    if (pre) {
      const preActualizado = {
        ...pre,
        estado: 'Pagado',
        motivoCancelacion: motivoFinal,
        canceladoEn: nowISO,
        updatedAt: nowISO
      };
      await window.dbPut('prestamos', preActualizado);
      await window.addToSyncQueue('prestamos', id, preActualizado, 'upsert');
    }
    await window.logBitacora('pago_completo',
      `Préstamo cancelado por pago total: ${pre?.clienteNombre || id} · ${pre ? window.fmtMoney(pre.total) : ''} · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} cerrada${cuotasPendientes.length!==1?'s':''}`,
      pre?.clienteId
    );
    window.pushInmediato();
    window.closeSheet();
    window.toast(`✅ Préstamo cerrado como pagado · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} cancelada${cuotasPendientes.length!==1?'s':''}`);
    window.goPage('prestamos');
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
      await window.dbPut('cuotas', cEjec);
      await window.addToSyncQueue('cuotas', c.id, cEjec, 'upsert');
    }
    if (pre) {
      const preActualizado = {
        ...pre,
        estado: 'Ejecutado',
        motivoCancelacion: motivoFinal,
        canceladoEn: nowISO,
        updatedAt: nowISO
      };
      await window.dbPut('prestamos', preActualizado);
      await window.addToSyncQueue('prestamos', id, preActualizado, 'upsert');
    }
    const yaPagadas = cuotas.filter(c => c.prestamoId === id && !c._deleted && c.estado === 'Pagado').length;
    await window.logBitacora('prenda_ejecutada',
      `Préstamo cerrado por ejecución de prenda: ${pre?.clienteNombre || id} · ${yaPagadas} cuota${yaPagadas!==1?'s':''} cobrada${yaPagadas!==1?'s':''} previamente · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} ejecutada${cuotasPendientes.length!==1?'s':''}`,
      pre?.clienteId
    );
    window.pushInmediato();
    window.closeSheet();
    window.toast(`🔒 Préstamo cerrado por prenda · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} ejecutada${cuotasPendientes.length!==1?'s':''}`);
    window.goPage('prestamos');
    return;
  }

  // ── ERROR DE CARGA / OTRO MOTIVO ──
  // Borrado lógico total (como antes) - para eliminar errores sin afectar balance
  if (pre) {
    await window.dbPut('prestamos', { ...pre, estado: 'Cancelado', motivoCancelacion: motivoFinal, canceladoEn: nowISO, updatedAt: nowISO });
  }
  for (const c of cuotasPendientes) {
    await window.dbSoftDelete('cuotas', c.id);
    window.addToSyncQueue('cuotas', c.id, { _deleted: true, id: c.id });
  }
  await window.dbSoftDelete('prestamos', id);
  window.addToSyncQueue('prestamos', id, { _deleted: true, id });

  await window.logBitacora('eliminacion',
    `Préstamo eliminado [${motivoFinal}]: ${pre?.clienteNombre || id} · ${pre ? window.fmtMoney(pre.monto) : ''}`,
    pre?.clienteId
  );
  window.pushInmediato();

  window.closeSheet();
  window.toast(`🗑️ Préstamo eliminado · ${motivoLabel}`);
  window.goPage('prestamos');
}
