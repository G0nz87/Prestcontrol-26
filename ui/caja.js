const INGRESOS = new Set(['APORTE_CAPITAL', 'OTRO_INGRESO']);
const EGRESOS = new Set(['GASTO_OPERATIVO', 'RETIRO_PERSONAL', 'IMPUESTO', 'OTRO_EGRESO']);
const TIPOS = new Set([...INGRESOS, ...EGRESOS]);
const MEDIOS = new Set(['Efectivo', 'Transferencia', 'MercadoPago', 'Otro']);
let periodo = 'mes';
let filtroTipo = 'todos';
let operationId = null;
let reversaOriginalId = null;
let reversaOperationId = null;
let conceptoAutocompletado = '';

const valor = id => document.getElementById(id)?.value?.trim() || '';
const hoy = () => new Date().toISOString().slice(0, 10);
const nuevaOperacion = () => globalThis.crypto?.randomUUID?.() || `op_caja_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const fechaMs = m => {
  const dato = m.fecha || m.createdAt || 0;
  const partes = typeof dato === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(dato);
  const n = partes
    ? new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), 12).getTime()
    : new Date(dato).getTime();
  return Number.isFinite(n) ? n : 0;
};
const creacionMs = m => {
  const dato = m?.createdAt;
  const n = dato?.toMillis instanceof Function
    ? dato.toMillis()
    : dato?.toDate instanceof Function
      ? dato.toDate().getTime()
      : new Date(dato || 0).getTime();
  // Compatibilidad con movimientos históricos sin createdAt: usar su fecha
  // operativa, nunca updatedAt (una sincronización no altera la cronología).
  return Number.isFinite(n) && n > 0 ? n : fechaMs(m);
};
const cronologico = (a, b) => creacionMs(a) - creacionMs(b) || String(a.id).localeCompare(String(b.id));
const nombreTipo = tipo => ({ SALDO_INICIAL:'Saldo inicial', APORTE_CAPITAL:'Aporte de capital', OTRO_INGRESO:'Otro ingreso', GASTO_OPERATIVO:'Gasto operativo', RETIRO_PERSONAL:'Retiro personal', IMPUESTO:'Impuesto', OTRO_EGRESO:'Otro egreso', REVERSA:'Reversa', DESEMBOLSO_PRESTAMO:'Desembolso de préstamo', DESEMBOLSO_RENOVACION:'Desembolso de renovación', COBRO_CUOTA:'Cobro de cuota', COBRO_ABONO:'Cobro parcial de cuota', COBRO_INTERES_RENOVACION:'Cobro de interés y renovación de capital', VENTA_PRENDA:'Venta de prenda', GASTO_VENTA_PRENDA:'Gasto venta de prenda', REVERSA_CORRECCION_VENTA:'Reversa por corrección de venta', REVERSA_CORRECCION_GASTO:'Reversa por corrección de gasto', VENTA_PRENDA_CORREGIDA:'Venta de prenda corregida', GASTO_VENTA_PRENDA_CORREGIDO:'Gasto de venta corregido' })[tipo] || tipo;

function rango() {
  const n = new Date();
  if (periodo === 'hoy') {
    const desde = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1); hasta.setMilliseconds(-1);
    return { desde: desde.getTime(), hasta: hasta.getTime() };
  }
  if (periodo === 'mes') return { desde: new Date(n.getFullYear(), n.getMonth(), 1).getTime(), hasta: new Date(n.getFullYear(), n.getMonth() + 1, 1, 0, 0, 0, -1).getTime() };
  return {};
}

function coincideTipo(m) {
  if (filtroTipo === 'ingresos') return m.direccion === 'ingreso';
  if (filtroTipo === 'egresos') return m.direccion === 'egreso';
  if (filtroTipo === 'gastos') return ['GASTO_OPERATIVO', 'GASTO_VENTA_PRENDA', 'GASTO_VENTA_PRENDA_CORREGIDO'].includes(m.tipo);
  if (filtroTipo === 'retiros') return m.tipo === 'RETIRO_PERSONAL';
  return true;
}

function filtrar(movimientos) {
  const { desde, hasta } = rango();
  return movimientos.filter(m => (!desde || fechaMs(m) >= desde) && (!hasta || fechaMs(m) <= hasta) && coincideTipo(m));
}

function saldosAcumulados(movimientos) {
  const saldos = new Map(); let saldo = 0;
  for (const m of [...movimientos].sort(cronologico)) {
    saldo += window.cajaService.importeFirmado(m);
    saldos.set(m.id, saldo);
  }
  return saldos;
}

async function guardarLocalYEncolar(movimiento) {
  const confirmado = await window.dbPutCajaAndQueueAtomic(movimiento, 'upsert');
  const persistido = confirmado.movimiento;
  void Promise.resolve(window.pushInmediato()).catch(error => console.warn('[CAJA SYNC] Push pendiente; la cola se conserva', error));
  return persistido;
}

export async function renderCaja() {
  const el = document.getElementById('pg-caja'); if (!el) return;
  const movimientos = await window.dbAll('movimientos_caja');
  if (!window.cajaService.esCajaIniciada(movimientos)) {
    el.innerHTML = `<div class="fadeIn"><div class="card empty" style="padding:28px 20px;text-align:center"><div style="font-size:42px">💰</div><h2>Caja / Tesorería</h2><p style="color:var(--muted);line-height:1.6">Todavía no comenzaste el control de Caja.</p><p style="color:var(--muted);line-height:1.6">El saldo inicial representa el dinero real disponible al momento de comenzar a usar Tesorería. Las operaciones anteriores no se reconstruirán automáticamente.</p><button class="btn btn-gold btn-full" onclick="openIniciarCaja()">Iniciar Caja</button></div></div>`;
    return;
  }
  const visibles = filtrar(movimientos);
  const resumen = window.cajaService.calcularResumenPeriodo(visibles);
  const saldoTotal = window.cajaService.calcularSaldo(movimientos);
  const saldos = saldosAcumulados(movimientos);
  const reversasPorOriginal = new Map(
    movimientos.filter(m => m.tipo === 'REVERSA' && m.reversaDeMovimientoId)
      .map(m => [m.reversaDeMovimientoId, m])
  );
  const historial = [...visibles].sort((a,b) => cronologico(b,a)).map(m => {
    const ingreso = m.direccion === 'ingreso';
    const fecha = new Date(fechaMs(m));
    const reversa = reversasPorOriginal.get(m.id);
    const elegible = TIPOS.has(m.tipo) && m.automatico !== true && !reversa;
    const trazabilidad = reversa
      ? `<div style="margin-top:7px"><span class="badge bg-red">Revertido</span> <span style="font-size:11px;color:var(--muted)">Reversa ${window.esc(reversa.id)}</span></div>`
      : m.tipo === 'REVERSA'
        ? `<div style="margin-top:7px"><span class="badge bg-yel">Reversa</span> <span style="font-size:11px;color:var(--muted)">Original ${window.esc(m.reversaDeMovimientoId || '')}</span></div>`
        : '';
    const automatico = m.automatico === true ? '<span class="badge badge-info" style="margin-top:7px">Automático</span>' : '';
    const componentes = m.medioPago === 'Mixto' && Array.isArray(m.componentesPago)
      ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">${m.componentesPago.map(item => `${window.esc(item.medioPago)} ${window.fmtMoney(item.monto)}`).join(' · ')}</div>`
      : '';
    return `<div class="card" style="padding:13px;margin-bottom:9px"><div style="display:flex;justify-content:space-between;gap:12px"><div><div style="font-size:11px;color:var(--muted)">${fechaMs(m) ? fecha.toLocaleDateString('es-AR') : 'Sin fecha'} · ${window.esc(m.medioPago === 'Mixto' ? 'Pago mixto' : (m.medioPago || 'Sin medio'))}</div><div style="font-weight:800;margin-top:4px">${window.esc(nombreTipo(m.tipo))}</div><div style="font-size:12px;color:var(--muted);margin-top:3px">${window.esc(m.concepto || 'Sin concepto')}</div>${componentes}${automatico}${trazabilidad}</div><div style="text-align:right;white-space:nowrap"><div style="font-weight:900;color:${ingreso ? 'var(--grn)' : 'var(--red)'}">${ingreso ? 'Ingreso +' : 'Egreso −'}${window.fmtMoney(m.monto)}</div><div style="font-size:11px;color:var(--muted);margin-top:4px">Saldo ${window.fmtMoney(saldos.get(m.id) || 0)}</div></div></div>${elegible ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="openReversaCaja('${window.esc(m.id)}')">Corregir / Revertir</button>` : ''}</div>`;
  }).join('');
  el.innerHTML = `<div class="fadeIn"><div class="card" style="padding:16px;margin-bottom:12px"><div class="form-section-title">Caja disponible</div><div style="font-size:30px;font-weight:900;margin:5px 0 14px">${window.fmtMoney(saldoTotal)}</div><div class="info-grid"><div class="info-cell"><div class="info-lbl">Ingresos del período</div><div class="info-val">${window.fmtMoney(resumen.ingresos)}</div></div><div class="info-cell"><div class="info-lbl">Egresos del período</div><div class="info-val">${window.fmtMoney(resumen.egresos)}</div></div><div class="info-cell"><div class="info-lbl">Gastos operativos</div><div class="info-val">${window.fmtMoney(resumen.gastosOperativos)}</div></div><div class="info-cell"><div class="info-lbl">Retiros personales</div><div class="info-val">${window.fmtMoney(resumen.retirosPersonales)}</div></div></div></div><button class="btn btn-gold btn-full" style="margin-bottom:12px" onclick="openMovimientoCaja()">＋ Movimiento</button><div class="card" style="padding:12px;margin-bottom:12px"><div class="form-grid form-grid-2"><select class="inp" onchange="setPeriodoCaja(this.value)"><option value="hoy"${periodo==='hoy'?' selected':''}>Hoy</option><option value="mes"${periodo==='mes'?' selected':''}>Este mes</option><option value="todos"${periodo==='todos'?' selected':''}>Todos</option></select><select class="inp" onchange="setTipoFiltroCaja(this.value)"><option value="todos"${filtroTipo==='todos'?' selected':''}>Todos</option><option value="ingresos"${filtroTipo==='ingresos'?' selected':''}>Ingresos</option><option value="egresos"${filtroTipo==='egresos'?' selected':''}>Egresos</option><option value="gastos"${filtroTipo==='gastos'?' selected':''}>Gastos</option><option value="retiros"${filtroTipo==='retiros'?' selected':''}>Retiros</option></select></div></div><div class="form-section-title" style="margin:14px 2px 9px">Historial (${visibles.length})</div>${historial || '<div class="empty">No hay movimientos para este filtro.</div>'}</div>`;
}

export function setPeriodoCaja(v) { periodo = ['hoy','mes','todos'].includes(v) ? v : 'mes'; return renderCaja(); }
export function setTipoFiltroCaja(v) { filtroTipo = ['todos','ingresos','egresos','gastos','retiros'].includes(v) ? v : 'todos'; return renderCaja(); }

export async function openIniciarCaja() {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const existentes = await window.dbAll('movimientos_caja');
  if (window.cajaService.esCajaIniciada(existentes)) return window.toast('Caja ya está iniciada');
  operationId = nuevaOperacion();
  document.getElementById('caja-saldo-inicial').value = '';
  document.getElementById('caja-fecha-inicial').value = hoy();
  document.getElementById('caja-nota-inicial').value = '';
  window.openSheet('sh-caja-inicial');
}

export async function confirmarSaldoInicial() {
  const lock = window.iniciarOperacionProtegida?.('caja:saldo-inicial', document.getElementById('caja-inicial-save'), 'Guardando...'); if (!lock) return;
  try {
    if (await window.bloquearEscrituraPorRestorePending?.()) return;
    const existentes = await window.dbAll('movimientos_caja');
    if (window.cajaService.esCajaIniciada(existentes)) throw new Error('Caja ya tiene un saldo inicial activo.');
    if (!valor('caja-fecha-inicial')) throw new Error('Ingresá la fecha de inicio.');
    const sourceKey = 'SALDO_INICIAL:GENERAL';
    const m = window.cajaService.crearMovimiento({ id:window.cajaService.generarIdAutomatico(sourceKey), tipo:'SALDO_INICIAL', direccion:'ingreso', monto:Number(valor('caja-saldo-inicial')), fecha:valor('caja-fecha-inicial'), concepto:'Inicio de Caja', nota:valor('caja-nota-inicial'), medioPago:'Efectivo', cuentaId:'GENERAL', automatico:false, sourceKey, operationId:operationId || nuevaOperacion(), createdByUid:window._fbUser?.uid || null, deviceId:window.DEVICE_ID || null, movimientosExistentes:existentes });
    await guardarLocalYEncolar(m); await window.logBitacora?.('caja_saldo_inicial', `Caja iniciada con ${window.fmtMoney(m.monto)}`, m.id);
    operationId = null; window.closeSheet(); window.toast('✅ Caja iniciada'); await renderCaja();
  } catch (e) { window.toast('⚠️ ' + (e.message || 'No se pudo iniciar Caja')); } finally { lock.liberar(); }
}

export function actualizarDireccionMovimientoCaja() {
  const tipo = valor('caja-mov-tipo'); const el = document.getElementById('caja-mov-direccion');
  if (el) el.textContent = INGRESOS.has(tipo) ? 'Ingreso' : EGRESOS.has(tipo) ? 'Egreso' : '—';
  const conceptos = { APORTE_CAPITAL:'Aporte de capital', GASTO_OPERATIVO:'Gasto operativo', RETIRO_PERSONAL:'Retiro personal', IMPUESTO:'Impuesto', OTRO_INGRESO:'Otro ingreso', OTRO_EGRESO:'Otro egreso' };
  const campo = document.getElementById('caja-mov-concepto');
  if (campo && (!campo.value.trim() || campo.value === conceptoAutocompletado)) {
    conceptoAutocompletado = conceptos[tipo] || '';
    campo.value = conceptoAutocompletado;
  }
}

export async function openMovimientoCaja() {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  if (!window.cajaService.esCajaIniciada(await window.dbAll('movimientos_caja'))) return window.toast('Primero iniciá Caja');
  operationId = nuevaOperacion();
  conceptoAutocompletado = '';
  for (const id of ['caja-mov-monto','caja-mov-concepto','caja-mov-nota']) document.getElementById(id).value = '';
  document.getElementById('caja-mov-tipo').value = ''; document.getElementById('caja-mov-fecha').value = hoy(); document.getElementById('caja-mov-medio').value = 'Efectivo'; actualizarDireccionMovimientoCaja(); window.openSheet('sh-caja-movimiento');
}

export async function guardarMovimientoCaja() {
  const op = operationId; const lock = window.iniciarOperacionProtegida?.(`caja:movimiento:${op || 'invalido'}`, document.getElementById('caja-mov-save'), 'Guardando...'); if (!lock) return;
  try {
    if (await window.bloquearEscrituraPorRestorePending?.()) return;
    if (!op) throw new Error('La operación venció. Volvé a abrir el formulario.');
    const tipo = valor('caja-mov-tipo'), concepto = valor('caja-mov-concepto'), medioPago = valor('caja-mov-medio'), fecha = valor('caja-mov-fecha');
    if (!TIPOS.has(tipo)) throw new Error('Seleccioná un tipo válido.'); if (!concepto) throw new Error('Ingresá un concepto.'); if (!fecha) throw new Error('Ingresá una fecha.'); if (!MEDIOS.has(medioPago)) throw new Error('Seleccioná un medio válido.');
    const sourceKey = `MANUAL:${op}`, id = window.cajaService.generarIdAutomatico(sourceKey);
    const existente = await window.dbGet('movimientos_caja', id).catch(() => null);
    if (existente && existente._deleted !== true) { operationId = null; window.closeSheet(); await renderCaja(); return window.toast('El movimiento ya había sido registrado'); }
    const m = window.cajaService.crearMovimiento({ id, tipo, direccion:INGRESOS.has(tipo)?'ingreso':'egreso', monto:Number(valor('caja-mov-monto')), fecha, concepto, nota:valor('caja-mov-nota'), medioPago, cuentaId:'GENERAL', automatico:false, sourceKey, operationId:op, createdByUid:window._fbUser?.uid || null, deviceId:window.DEVICE_ID || null });
    await guardarLocalYEncolar(m); await window.logBitacora?.('caja_movimiento', `${nombreTipo(tipo)}: ${window.fmtMoney(m.monto)} · ${concepto}`, id);
    operationId = null; window.closeSheet(); window.toast('✅ Movimiento registrado'); await renderCaja();
  } catch (e) { window.toast('⚠️ ' + (e.message || 'No se pudo registrar el movimiento')); } finally { lock.liberar(); }
}

function reversaCompatible(reversa, original) {
  return reversa?.tipo === 'REVERSA'
    && reversa.reversaDeMovimientoId === original.id
    && Number(reversa.monto) === Number(original.monto)
    && reversa.direccion === (original.direccion === 'ingreso' ? 'egreso' : 'ingreso')
    && reversa.sourceKey === `REVERSA:${original.id}`;
}

export async function openReversaCaja(id) {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const movimientos = await window.dbAll('movimientos_caja');
  const original = movimientos.find(m => m.id === id);
  if (!original) return window.toast('Movimiento no encontrado');
  if (!TIPOS.has(original.tipo) || original.automatico === true) return window.toast('Este movimiento no admite reversa manual');
  const sourceKey = `REVERSA:${original.id}`;
  const existente = movimientos.find(m => m.sourceKey === sourceKey || m.reversaDeMovimientoId === original.id);
  if (existente) return window.toast(reversaCompatible(existente, original) ? 'Este movimiento ya está revertido' : 'Existe un conflicto con la reversa de este movimiento');
  reversaOriginalId = original.id;
  reversaOperationId = nuevaOperacion();
  document.getElementById('caja-reversa-resumen').innerHTML = `<div><b>${window.esc(nombreTipo(original.tipo))}</b></div><div>${window.esc(original.concepto || 'Sin concepto')}</div><div>${original.direccion === 'ingreso' ? 'Ingreso' : 'Egreso'} · ${window.fmtMoney(original.monto)}</div><div>${window.esc(original.fecha || 'Sin fecha')}</div>`;
  document.getElementById('caja-reversa-fecha').value = hoy();
  document.getElementById('caja-reversa-motivo').value = '';
  window.openSheet('sh-caja-reversa');
}

export async function confirmarReversaCaja() {
  const originalId = reversaOriginalId;
  const op = reversaOperationId;
  const lock = window.iniciarOperacionProtegida?.(`caja:reversa:${originalId || 'invalida'}`, document.getElementById('caja-reversa-save'), 'Guardando...');
  if (!lock) return;
  try {
    if (await window.bloquearEscrituraPorRestorePending?.()) return;
    if (!originalId || !op) throw new Error('La operación de reversa venció.');
    const motivo = valor('caja-reversa-motivo');
    const fecha = valor('caja-reversa-fecha');
    if (!motivo) throw new Error('Ingresá el motivo de corrección.');
    if (!fecha) throw new Error('Ingresá la fecha de la reversa.');
    const movimientos = await window.dbAll('movimientos_caja');
    const original = movimientos.find(m => m.id === originalId);
    if (!original) throw new Error('El movimiento original ya no está disponible.');
    if (!TIPOS.has(original.tipo) || original.automatico === true) throw new Error('Este movimiento no admite reversa manual.');
    const sourceKey = `REVERSA:${original.id}`;
    const id = window.cajaService.generarIdAutomatico(sourceKey);
    const existente = movimientos.find(m => m.id === id || m.sourceKey === sourceKey || m.reversaDeMovimientoId === original.id);
    if (existente) {
      if (!reversaCompatible(existente, original)) throw new Error('Conflicto: existe una reversa incompatible para este movimiento.');
      reversaOriginalId = null; reversaOperationId = null; window.closeSheet(); await renderCaja();
      return window.toast('La reversa ya había sido registrada');
    }
    const reversa = window.cajaService.crearMovimiento({
      id,
      tipo: 'REVERSA',
      direccion: original.direccion === 'ingreso' ? 'egreso' : 'ingreso',
      monto: Number(original.monto),
      fecha,
      concepto: `Reversa: ${original.concepto || nombreTipo(original.tipo)}`,
      nota: motivo,
      medioPago: original.medioPago || null,
      cuentaId: original.cuentaId || 'GENERAL',
      eventoTipo: 'REVERSA_CAJA',
      eventoId: original.id,
      automatico: false,
      sourceKey,
      reversaDeMovimientoId: original.id,
      operationId: op,
      createdByUid: window._fbUser?.uid || null,
      deviceId: window.DEVICE_ID || null,
      movimientosExistentes: movimientos
    });
    await guardarLocalYEncolar(reversa);
    await window.logBitacora?.('caja_reversa', `Reversa de ${original.id}: ${motivo}`, reversa.id);
    reversaOriginalId = null; reversaOperationId = null;
    window.closeSheet(); window.toast('✅ Reversa registrada'); await renderCaja();
  } catch (e) {
    window.toast('⚠️ ' + (e.message || 'No se pudo registrar la reversa'));
  } finally { lock.liberar(); }
}
