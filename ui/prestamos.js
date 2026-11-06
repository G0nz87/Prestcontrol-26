// UI handlers de Prestamos. Disparados desde onclick="..." del HTML.
// Delegan validacion + calculo + generacion de cuotas a window.prestamoService;
// persistencia local (IndexedDB) y sync queue siguen viviendo en el inline.
//
// NO migrados aun (otros sub-steps o renders):
// - openPrestamoDetail (render-heavy: ~50 lineas de template HTML)
// - filtrarClientesAC / seleccionarClienteAC / limpiarClienteAC / calcPreview (AC del sheet)
// - abrirPago / confirmarPago (cuota, no prestamo)
// - imprimirComprobantePrestamo / enviarWACuota (utility actions)

import { saldoCobrableCuota } from '../core/helpers.js';

const PRESTAMO_SUBMIT_LOCK = '__prestcontrolGuardandoPrestamo';
const MEDIOS_ENTREGA = new Set(['Efectivo', 'Transferencia', 'MercadoPago', 'Otro']);

function nuevaOperacionFinanciera(prefijo) {
  return globalThis.crypto?.randomUUID?.() || `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function cajaEstaIniciada() {
  return window.cajaService.esCajaIniciada(await window.dbAll('movimientos_caja'));
}

function ofrecerIrACaja() {
  const ir = confirm('Primero iniciá Caja / Tesorería para registrar correctamente el movimiento de dinero.\n\nPresioná Aceptar para ir a Caja.');
  if (ir) { window.closeSheet(); window.goPage('caja'); }
}

function movimientoCajaCompatible(existente, esperado) {
  return existente
    && existente.sourceKey === esperado.sourceKey
    && existente.tipo === esperado.tipo
    && existente.direccion === esperado.direccion
    && Number(existente.monto) === Number(esperado.monto)
    && existente.prestamoId === esperado.prestamoId
    && existente.clienteId === esperado.clienteId;
}

export function openSheetPrestamo(clientePreseleccionadoId = null) {
  ['pre-monto','pre-interes','pre-ncuotas','pre-notas','pre-prenda'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pre-tipo').value = 'Mensual';
  document.getElementById('pre-medio-entrega').value = 'Efectivo';
  document.getElementById('pre-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('pre-preview').style.display = 'none';
  window.resetGarantiaNuevoPrestamo?.();
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
  const btnGuardar = document.getElementById('pre-save');
  if (btnGuardar && window[PRESTAMO_SUBMIT_LOCK] !== true) {
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Crear Préstamo + Cuotas';
  }

  window.openSheet('sh-prestamo');
}

export async function savePrestamo() {
  const btnGuardar = document.getElementById('pre-save');
  if (
    window[PRESTAMO_SUBMIT_LOCK] === true
    || btnGuardar?.dataset?.submitting === 'true'
  ) return;

  window[PRESTAMO_SUBMIT_LOCK] = true;
  if (btnGuardar?.dataset) btnGuardar.dataset.submitting = 'true';
  if (btnGuardar) {
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';
  }
  let prestamoCreadoLocalmente = false;

  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  if (await window.bloquearFinanzasDuranteCargaHistorica?.()) return;
  const clienteId = document.getElementById('pre-cliente').value;
  const montoRaw  = document.getElementById('pre-monto').value;
  const interesRaw= document.getElementById('pre-interes').value;
  const ncuotasRaw= document.getElementById('pre-ncuotas').value;
  const tipo      = document.getElementById('pre-tipo').value;
  const fechaRaw  = document.getElementById('pre-fecha').value;
  const notasRaw  = document.getElementById('pre-notas').value.trim();
  const prendaLegacyRaw = document.getElementById('pre-prenda').value.trim();
  const medioEntrega = document.getElementById('pre-medio-entrega').value;

  const monto       = parseFloat(montoRaw);
  const intPorCuota = parseFloat(interesRaw); // % POR cuota (por semana o por mes)
  const nCuotas     = parseInt(ncuotasRaw);
  let garantiaDatos = null;

  // Validar préstamo y garantía antes de realizar cualquier escritura.
  try {
    window.prestamoService.validarDatosPrestamo({
      clienteId, monto, tasaPorCuota: intPorCuota, nCuotas, fecha: fechaRaw
    });
    garantiaDatos = window.obtenerGarantiaNuevoPrestamo?.() || null;
    if (!MEDIOS_ENTREGA.has(medioEntrega)) throw new Error('Seleccioná un medio de entrega válido');
  } catch (e) {
    return window.toast('⚠️ ' + e.message);
  }

  const cliente = await window.dbGet('clientes', clienteId);
  if (cliente?.estado === 'Bloqueado') {
    return window.toast('Cliente bloqueado. No puede recibir nuevos préstamos.');
  }
  if (!cliente) return window.toast('⚠️ Cliente no encontrado');
  const riesgoYaConfirmadoEnEsteIntento = window.consumirAutorizacionRiesgoPrestamo(clienteId);
  if (!riesgoYaConfirmadoEnEsteIntento && !(await window.confirmarRiesgoNuevoPrestamo(clienteId, { restaurarFormulario: true }))) return;
  if (!(await cajaEstaIniciada())) {
    ofrecerIrACaja();
    return;
  }

  // Calculo financiero delegado al service
  const { interesTotal, total, cuotaMonto, ganancia } =
    window.prestamoService.calcularPlanPagos(monto, intPorCuota, nCuotas);
  const fecha = new Date(fechaRaw + 'T12:00:00');

  const todos = await window.dbAllIncludeDeleted('prestamos');
  const preId = window.nextId('PR', todos);
  const operationIdAlta = nuevaOperacionFinanciera('prestamo');

  const nowISO = new Date().toISOString();
  const prestamo = {
    id: preId, clienteId, clienteNombre: cliente.nombre,
    fecha: fecha.toISOString(), monto,
    interes: interesTotal,            // tasa total acumulada (compatibilidad y display)
    interesPorCuota: intPorCuota,     // tasa por período (la que el usuario ingresó)
    tipo, nCuotas,
    total, cuota: cuotaMonto, ganancia,
    estado: 'Activo',
    notas: notasRaw,
    prenda: prendaLegacyRaw,
    medioEntrega,
    operationId: operationIdAlta,
    creadoEn: nowISO,
    updatedAt: nowISO
  };

  // Generacion de cuotas delegada al service (id base se calcula leyendo IndexedDB local)
  const todasCuotas = await window.dbAllIncludeDeleted('cuotas');
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

  const sourceKeyCaja = `DESEMBOLSO_PRESTAMO:${preId}`;
  const movimientoCaja = window.cajaService.crearMovimiento({
    id: window.cajaService.generarIdAutomatico(sourceKeyCaja),
    tipo: 'DESEMBOLSO_PRESTAMO', direccion: 'egreso', monto,
    fecha: fechaRaw, concepto: `Desembolso préstamo ${preId}`, medioPago: medioEntrega,
    cuentaId: 'GENERAL', eventoTipo: 'PRESTAMO', eventoId: preId,
    prestamoId: preId, clienteId, automatico: true, sourceKey: sourceKeyCaja,
    operationId: operationIdAlta, createdByUid: window._fbUser?.uid || null,
    deviceId: window.DEVICE_ID || null
  });
  const cajaExistente = (await window.dbAll('movimientos_caja')).find(m => m.sourceKey === sourceKeyCaja || m.id === movimientoCaja.id);
  if (cajaExistente && !movimientoCajaCompatible(cajaExistente, movimientoCaja)) {
    throw new Error(`Conflicto de integridad en Caja para ${preId}`);
  }

  let prendaCreada = null;
  if (garantiaDatos) {
    const prendasTodas = await window.dbAllIncludeDeleted('prendas');
    prendaCreada = { id: window.nextId('PD', prendasTodas), clienteId, prestamoId: preId, ...garantiaDatos, estado: 'En garantía', _deleted: false, deletedAt: null };
  }
  const registrosOperacion = [
    { store: 'prestamos', data: prestamo },
    ...cuotasArr.map(c => ({ store: 'cuotas', data: c })),
    ...(prendaCreada ? [{ store: 'prendas', data: prendaCreada }] : []),
    ...(cajaExistente ? [] : [{ store: 'movimientos_caja', data: movimientoCaja }])
  ];
  await window.dbCommitOperacionPrestamoCajaAtomic(registrosOperacion);
  prestamoCreadoLocalmente = true;
  const fallosEncolado = [];

  await window.logBitacora('nuevo_prestamo', `Préstamo creado: ${cliente.nombre} · ${window.fmtMoney(monto)} · ${nCuotas} cuotas ${tipo}`, clienteId);
  await window.logBitacora('caja_desembolso', `Desembolso registrado en Caja: ${preId} · ${window.fmtMoney(monto)} · ${medioEntrega}`, preId);
  if (prendaCreada) {
    await window.logBitacora('prenda_creada', `Prenda creada: ${prendaCreada.id} · ${prendaCreada.descripcion} · préstamo ${preId}`, prendaCreada.id);
    await window.logBitacora('prestamo_con_garantia', `Préstamo creado con garantía: ${preId} · ${prendaCreada.id} · ${garantiaDatos.descripcion}`, preId);
  }

  window.closeSheet();

  let syncPendiente = fallosEncolado.length > 0;
  if (!syncPendiente) {
    await window.pushInmediato();
    const idsAlta = new Set([preId, ...cuotasArr.map(c => c.id), movimientoCaja.id, ...(prendaCreada ? [prendaCreada.id] : [])]);
    const [pendientes, prestamoPostPush] = await Promise.all([
      window.getSyncQueuePending(),
      window.dbGet('prestamos', preId)
    ]);
    syncPendiente = prestamoPostPush?._deleted === true || pendientes.some(op =>
      idsAlta.has(op.recordId) && ['prestamos', 'cuotas', 'prendas', 'movimientos_caja'].includes(op.store)
    );
  }

  if (syncPendiente) {
    window.toast(`⚠️ Préstamo ${preId} guardado localmente · sincronización pendiente`);
    alert(fallosEncolado.length
      ? `El préstamo ${preId} quedó guardado localmente, pero no se pudo confirmar su ingreso completo en sync_queue. No se intentó publicarlo; revisá la sincronización antes de continuar en otro dispositivo.`
      : `El préstamo ${preId} quedó guardado en este dispositivo, pero todavía no pudo sincronizarse. Reintentá “Guardar ahora” cuando haya conexión.`);
  } else {
    window.toast(prendaCreada
      ? `✅ Préstamo creado con garantía ${prendaCreada.id}`
      : `✅ Préstamo creado · ${nCuotas} cuotas generadas`);
  }
  await window.autoUpdateEstados();
  await window.updateBadges();
  await window.renderPage('prestamos');
  } catch (error) {
    console.error('No se pudo completar la creación del préstamo:', error);
    if (prestamoCreadoLocalmente) {
      window.closeSheet();
      window.toast('⚠️ El préstamo quedó guardado localmente; revisá la sincronización');
      alert(`El préstamo fue creado localmente, pero una operación posterior no pudo completarse.\n\nNo vuelvas a pulsar Guardar para esta misma operación.\n\n${error?.message || error}`);
      await window.renderPage('prestamos').catch(() => {});
    } else {
      window.toast('⚠️ ' + (error?.message || 'No se pudo crear el préstamo'));
    }
  } finally {
    window[PRESTAMO_SUBMIT_LOCK] = false;
    if (btnGuardar) {
      delete btnGuardar.dataset.submitting;
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Crear Préstamo + Cuotas';
    }
  }
}

function getRenovacionInputs() {
  const montoNominal = Number(document.getElementById('ren-monto')?.value || 0);
  const interesPorCuota = Number(document.getElementById('ren-interes')?.value || 0);
  const nCuotas = Number.parseInt(document.getElementById('ren-ncuotas')?.value || '0', 10);
  const tipo = document.getElementById('ren-tipo')?.value || 'Mensual';
  const fechaRaw = document.getElementById('ren-fecha')?.value || '';
  return { montoNominal, interesPorCuota, nCuotas, tipo, fechaRaw };
}

function cuotasPendientesRenovacion(cuotas, prestamoId) {
  const estadosIncluidos = new Set(['pendiente', 'atrasado', 'atrasada', 'parcial']);
  return (cuotas || [])
    .filter(cuota =>
      cuota?.prestamoId === prestamoId &&
      cuota._deleted !== true &&
      estadosIncluidos.has(String(cuota.estado || '').trim().toLocaleLowerCase('es-AR')) &&
      saldoCobrableCuota(cuota) > 0
    )
    .sort((a, b) => Number(a.nro || 0) - Number(b.nro || 0));
}

function deudaPendienteRenovacion(cuotas) {
  return window.round2((cuotas || []).reduce(
    (total, cuota) => total + saldoCobrableCuota(cuota),
    0
  ));
}

function totalAbonadoPrevioRenovacion(cuotas) {
  return window.round2((cuotas || []).reduce(
    (total, cuota) => total + Number(cuota.totalAbonado || 0),
    0
  ));
}

function cerrarCuotasPorRenovacion(cuotas, preId, nowISO) {
  return (cuotas || []).map(cuota => {
    const saldoCompensado = saldoCobrableCuota(cuota);
    const totalAbonado = window.round2(Number(cuota.totalAbonado || 0));
    return {
      ...cuota,
      estado: 'Pagado',
      metodo: 'Renovación',
      origenPago: 'renovacion_descuento',
      montoEfectivo: totalAbonado,
      montoCompensado: saldoCompensado,
      montoCompensadoRenovacion: saldoCompensado,
      saldoPendienteAlRenovar: saldoCompensado,
      totalAbonadoAlRenovar: totalAbonado,
      saldoPendiente: 0,
      cerradoPor: 'renovacion',
      prestamoRenovacionId: preId,
      fechaPago: nowISO,
      updatedAt: nowISO
    };
  });
}

function cuotaRemotaCoincideParaRenovacion(local, remota) {
  if (!remota || remota._deleted === true) return false;
  const campos = ['estado', 'monto', 'totalAbonado', 'saldoPendiente', 'cantidadAbonos', 'ultimoPagoId'];
  return campos.every(campo => String(remota[campo] ?? '') === String(local[campo] ?? ''));
}

async function confirmarRenovacionParcialEnFirebase({ prestamoOrigen, cuotasOrigen, registros }) {
  if (!navigator.onLine || !window._fbUser || !window._fbDb?.runTransaction) {
    throw new Error('La renovación con cuotas parciales requiere conexión para verificar el saldo actual.');
  }
  const db = window._fbDb;
  const uid = window._fbUser.uid;
  const ref = (store, id) => db.collection('users').doc(uid).collection(store).doc(id);
  const prestamoRef = ref('prestamos', prestamoOrigen.id);
  const cuotaRefs = cuotasOrigen.map(cuota => ref('cuotas', cuota.id));
  const nuevos = registros.filter(item =>
    (item.store === 'prestamos' && item.data.id !== prestamoOrigen.id) ||
    (item.store === 'cuotas' && item.data.prestamoId !== prestamoOrigen.id) ||
    item.store === 'movimientos_caja' || item.store === 'bitacora'
  );

  await db.runTransaction(async transaction => {
    const [prestamoSnap, ...cuotaSnaps] = await Promise.all([
      transaction.get(prestamoRef),
      ...cuotaRefs.map(cuotaRef => transaction.get(cuotaRef))
    ]);
    const nuevosSnaps = await Promise.all(nuevos.map(item => transaction.get(ref(item.store, item.data.id))));
    if (!prestamoSnap.exists) throw new Error('El préstamo todavía no está disponible en Firebase. Sincronizá y reintentá.');
    const remotoPrestamo = prestamoSnap.data();
    if (remotoPrestamo._deleted === true || !['Activo', 'Atrasado'].includes(remotoPrestamo.estado) || remotoPrestamo.prestamoRenovacionId) {
      throw new Error('El préstamo cambió en otro dispositivo. Sincronizá y volvé a calcular la renovación.');
    }
    if (cuotaSnaps.some((snap, indice) => !snap.exists || !cuotaRemotaCoincideParaRenovacion(cuotasOrigen[indice], snap.data()))) {
      throw new Error('Los saldos del préstamo cambiaron en otro dispositivo. Sincronizá y volvé a calcular la renovación.');
    }
    if (nuevosSnaps.some(snap => snap.exists)) {
      throw new Error('La renovación ya existe o su identificador está ocupado. Sincronizá antes de reintentar.');
    }
    const serverNow = window.firebase.firestore.FieldValue.serverTimestamp();
    for (const item of registros) {
      transaction.set(ref(item.store, item.data.id), {
        ...item.data,
        userId: uid,
        updatedAt: serverNow
      }, { merge: true });
    }
  });
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

export function prepararGarantiasRenovacion(prendas, prestamoOrigenId, preId, nowISO) {
  return (prendas || [])
    .filter(prenda => prenda.prestamoId === prestamoOrigenId && prenda._deleted !== true && prenda.estado === 'En garantía')
    .map(prenda => ({
      ...prenda,
      prestamoId: preId,
      prestamosAnteriores: [...new Set([...(Array.isArray(prenda.prestamosAnteriores) ? prenda.prestamosAnteriores : []), prestamoOrigenId])],
      historial: [
        ...(Array.isArray(prenda.historial) ? prenda.historial : []),
        {
          tipo: 'renovacion_traslado',
          fecha: nowISO,
          texto: `Garantía trasladada por renovación de ${prestamoOrigenId} a ${preId}`,
          prestamoOrigenId,
          prestamoDestinoId: preId
        }
      ],
      updatedAt: nowISO
    }));
}

const RENOVACION_CAPITAL_TIPO = 'interes_cobrado_capital_renovado';
const ORIGEN_COBRO_INTERES_RENOVACION = 'interes_cobrado_renovacion_capital';

function setRenovacionCapitalError(message) {
  const error = document.getElementById('rc-error');
  if (!error) return;
  error.textContent = message || '';
  error.classList.toggle('on', Boolean(message));
}

function datosRenovacionCapitalFormulario() {
  return {
    interesRecibido: Number(document.getElementById('rc-interes-recibido')?.value || 0),
    interesPorCuota: Number(document.getElementById('rc-interes')?.value || 0),
    nCuotas: Number.parseInt(document.getElementById('rc-ncuotas')?.value || '0', 10),
    tipo: document.getElementById('rc-tipo')?.value || 'Mensual',
    fechaRaw: document.getElementById('rc-fecha')?.value || '',
    medioCobro: document.getElementById('rc-medio-cobro')?.value || ''
  };
}

function calcularImportesRenovacionCapital(prestamo, cuota) {
  const capitalRenovado = window.round2(Number(prestamo?.montoNominal ?? prestamo?.monto ?? 0));
  const saldo = window.round2(saldoCobrableCuota(cuota));
  const interesPeriodo = window.round2(saldo - capitalRenovado);
  return { capitalRenovado, saldo, interesPeriodo };
}

export async function evaluarCobroInteresRenovacionCapital(prestamoId) {
  const [prestamo, cuotas, movimientos] = await Promise.all([
    window.dbGet('prestamos', prestamoId),
    window.dbAll('cuotas'),
    window.dbAll('movimientos_caja')
  ]);
  if (!prestamo || prestamo._deleted) return { ok: false, motivo: 'Préstamo no encontrado' };
  if (!['Activo', 'Atrasado'].includes(prestamo.estado)) return { ok: false, motivo: 'El préstamo no está cobrable' };
  if (prestamo.prestamoRenovacionId) return { ok: false, motivo: 'El préstamo ya fue renovado' };
  if (await window.hayRestauracionLocalPendiente?.()) return { ok: false, motivo: 'Existe una restauración pendiente' };
  if (!window.cajaService.esCajaIniciada(movimientos)) return { ok: false, motivo: 'Caja no está iniciada' };
  const mapa = new Map([[prestamo.id, prestamo]]);
  const cobrables = cuotas.filter(cuota => cuota.prestamoId === prestamo.id && window.esCuotaCobrable(cuota, mapa));
  if (cobrables.length !== 1) return { ok: false, motivo: 'Se requiere exactamente una cuota cobrable' };
  const cuota = cobrables[0];
  if (cuota.estado === 'Parcial' || Number(cuota.totalAbonado || 0) > 0 || Number(cuota.cantidadAbonos || 0) > 0) {
    return { ok: false, motivo: 'La cuota contiene pagos parciales incompatibles' };
  }
  const importes = calcularImportesRenovacionCapital(prestamo, cuota);
  if (!(importes.capitalRenovado > 0) || !(importes.interesPeriodo > 0) || importes.saldo !== window.round2(Number(cuota.monto || 0))) {
    return { ok: false, motivo: 'No se pudo separar capital e interés sin ambigüedad' };
  }
  return { ok: true, prestamo, cuota, ...importes };
}

export async function abrirCobroInteresRenovacionCapital(prestamoId) {
  if (!navigator.onLine || !window._fbUser || !window._fbDb?.runTransaction) {
    return window.toast('Esta operación requiere conexión para verificar el préstamo y evitar duplicados');
  }
  const evaluacion = await evaluarCobroInteresRenovacionCapital(prestamoId);
  if (!evaluacion.ok) return window.toast(`No disponible: ${evaluacion.motivo}`);
  const cliente = await window.dbGet('clientes', evaluacion.prestamo.clienteId);
  if (cliente?.estado === 'Bloqueado') return window.toast('Cliente bloqueado. No puede recibir una renovación');

  window._renovacionCapitalPrestamoId = prestamoId;
  document.getElementById('rc-origen').innerHTML = `<b>${window.esc(evaluacion.prestamo.clienteNombre || '')}</b> · ${window.esc(prestamoId)}`;
  document.getElementById('rc-resumen-origen').innerHTML = `
    <div class="form-summary-row"><span>Capital que continúa</span><strong>${window.fmtMoney(evaluacion.capitalRenovado)}</strong></div>
    <div class="form-summary-row"><span>Interés del período</span><strong>${window.fmtMoney(evaluacion.interesPeriodo)}</strong></div>`;
  document.getElementById('rc-interes-recibido').value = String(evaluacion.interesPeriodo);
  document.getElementById('rc-medio-cobro').value = 'Efectivo';
  document.getElementById('rc-interes').value = evaluacion.prestamo.interesPorCuota != null
    ? evaluacion.prestamo.interesPorCuota
    : window.round2(Number(evaluacion.prestamo.interes || 0) * 100 / Math.max(Number(evaluacion.prestamo.nCuotas || 1), 1));
  document.getElementById('rc-ncuotas').value = evaluacion.prestamo.nCuotas || 1;
  document.getElementById('rc-tipo').value = evaluacion.prestamo.tipo || 'Mensual';
  document.getElementById('rc-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('rc-confirm-text').value = '';
  setRenovacionCapitalError('');
  await calcularPreviewRenovacionCapital();
  window.openSheet('sh-renovar-capital');
}

export async function calcularPreviewRenovacionCapital() {
  const prestamoId = window._renovacionCapitalPrestamoId;
  const preview = document.getElementById('rc-preview');
  if (!prestamoId || !preview) return;
  const evaluacion = await evaluarCobroInteresRenovacionCapital(prestamoId);
  if (!evaluacion.ok) {
    preview.innerHTML = `<div class="form-alert is-warning">${window.esc(evaluacion.motivo)}</div>`;
    return;
  }
  const datos = datosRenovacionCapitalFormulario();
  if (!datos.nCuotas || !Number.isFinite(datos.interesPorCuota)) return;
  const plan = window.prestamoService.calcularPlanPagos(evaluacion.capitalRenovado, datos.interesPorCuota, datos.nCuotas);
  const interesValido = Math.abs(window.round2(datos.interesRecibido) - evaluacion.interesPeriodo) <= 0.009;
  preview.innerHTML = `
    <div class="form-summary-row"><span>Interés recibido</span><strong style="color:${interesValido ? 'var(--grn)' : 'var(--red)'}">${window.fmtMoney(datos.interesRecibido)}</strong></div>
    <div class="form-summary-row"><span>Capital renovado</span><strong>${window.fmtMoney(evaluacion.capitalRenovado)}</strong></div>
    <div class="form-summary-row"><span>Efectivo nuevo entregado</span><strong>${window.fmtMoney(0)}</strong></div>
    <div class="form-summary-row"><span>Nuevo total</span><strong>${window.fmtMoney(plan.total)}</strong></div>
    <div class="form-summary-row"><span>Nueva cuota</span><strong>${window.fmtMoney(plan.cuotaMonto)}</strong></div>`;
  setRenovacionCapitalError(interesValido ? '' : `El interés recibido debe ser ${window.fmtMoney(evaluacion.interesPeriodo)}.`);
}

export async function confirmarCobroInteresRenovacionCapital() {
  const prestamoOrigenId = window._renovacionCapitalPrestamoId;
  const boton = document.getElementById('rc-save');
  if (!prestamoOrigenId) return;
  if (document.getElementById('rc-confirm-text')?.value.trim().toUpperCase() !== 'RENOVAR CAPITAL') {
    setRenovacionCapitalError('Escribí RENOVAR CAPITAL para confirmar la operación');
    return document.getElementById('rc-confirm-text')?.focus();
  }
  const lock = window.iniciarOperacionProtegida?.(`prestamo:renovar-capital:${prestamoOrigenId}`, boton, 'Procesando...');
  if (!lock) return;
  let nuevoId = '';
  try {
    if (await window.bloquearEscrituraPorRestorePending?.()) return;
    if (await window.bloquearFinanzasDuranteCargaHistorica?.()) return;
    if (!navigator.onLine || !window._fbUser || !window._fbDb?.runTransaction) throw new Error('Esta operación requiere conexión.');
    const evaluacion = await evaluarCobroInteresRenovacionCapital(prestamoOrigenId);
    if (!evaluacion.ok) throw new Error(evaluacion.motivo);
    const datos = datosRenovacionCapitalFormulario();
    if (!MEDIOS_ENTREGA.has(datos.medioCobro)) throw new Error('Seleccioná un medio de cobro válido');
    window.prestamoService.validarDatosPrestamo({ clienteId: evaluacion.prestamo.clienteId, monto: evaluacion.capitalRenovado, tasaPorCuota: datos.interesPorCuota, nCuotas: datos.nCuotas, fecha: datos.fechaRaw });
    if (!['Mensual', 'Semanal'].includes(datos.tipo)) throw new Error('Seleccioná una frecuencia válida');
    const interesRecibido = window.round2(datos.interesRecibido);
    if (Math.abs(interesRecibido - evaluacion.interesPeriodo) > 0.009) throw new Error(`El interés recibido debe ser ${window.fmtMoney(evaluacion.interesPeriodo)}.`);

    const [prestamos, cuotasTodas, prendasTodas, movimientos] = await Promise.all([
      window.dbAllIncludeDeleted('prestamos'), window.dbAllIncludeDeleted('cuotas'),
      window.dbAllIncludeDeleted('prendas'), window.dbAll('movimientos_caja')
    ]);
    const preId = window.nextId('PR', prestamos);
    nuevoId = preId;
    const nowISO = new Date().toISOString();
    const fecha = new Date(`${datos.fechaRaw}T12:00:00`);
    const plan = window.prestamoService.calcularPlanPagos(evaluacion.capitalRenovado, datos.interesPorCuota, datos.nCuotas);
    const operationId = nuevaOperacionFinanciera('renovacion_capital');
    const pagoId = `PAGO_INTERES_RENOVACION:${evaluacion.cuota.id}`;
    const componentePagoId = String(datos.medioCobro).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const componentesPago = [{ componentePagoId, medioPago: datos.medioCobro, monto: interesRecibido }];
    const pagoFingerprintCuota = `${componentePagoId}:${interesRecibido.toFixed(2)}|RENOVACION_CAPITAL:${evaluacion.capitalRenovado.toFixed(2)}`;
    const pagoFingerprintCaja = `${componentePagoId}:${interesRecibido.toFixed(2)}`;
    const cuotaAnterior = {
      ...evaluacion.cuota, estado: 'Pagado', fechaPago: nowISO, metodo: datos.medioCobro,
      origenPago: ORIGEN_COBRO_INTERES_RENOVACION, cerradoPor: 'renovacion_capital',
      montoEfectivo: interesRecibido, montoCompensado: evaluacion.capitalRenovado,
      montoCompensadoRenovacion: evaluacion.capitalRenovado, capitalCobradoReal: 0,
      interesCobradoReal: interesRecibido, totalAbonado: interesRecibido,
      saldoPendiente: 0, pagoId, componentesPago, pagoFingerprint: pagoFingerprintCuota,
      prestamoRenovacionId: preId, updatedAt: nowISO
    };
    const prestamoAnterior = {
      ...evaluacion.prestamo, estado: 'Pagado', cerradoPor: 'renovacion_capital',
      renovacionTipo: RENOVACION_CAPITAL_TIPO, prestamoRenovacionId: preId,
      renovadoEn: nowISO, updatedAt: nowISO
    };
    const prestamoNuevo = {
      id: preId, clienteId: evaluacion.prestamo.clienteId, clienteNombre: evaluacion.prestamo.clienteNombre,
      fecha: fecha.toISOString(), monto: evaluacion.capitalRenovado, montoNominal: evaluacion.capitalRenovado,
      interes: plan.interesTotal, interesPorCuota: datos.interesPorCuota, tipo: datos.tipo,
      nCuotas: datos.nCuotas, total: plan.total, cuota: plan.cuotaMonto, ganancia: plan.ganancia,
      estado: 'Activo', notas: `Capital renovado de ${prestamoOrigenId}`, prenda: evaluacion.prestamo.prenda || '',
      origen: 'renovacion', renovacionTipo: RENOVACION_CAPITAL_TIPO, prestamoOrigenId,
      montoCompensado: evaluacion.capitalRenovado, montoEntregado: 0, montoInteresCobradoRenovacion: interesRecibido,
      medioEntrega: null, cuotasCompensadas: [evaluacion.cuota.id], operationId,
      creadoEn: nowISO, updatedAt: nowISO
    };
    const cuotasNuevas = window.prestamoService.generarCuotas({
      prestamoId: preId, clienteId: prestamoNuevo.clienteId, clienteNombre: prestamoNuevo.clienteNombre,
      fechaInicio: fecha, tipo: datos.tipo, nCuotas: datos.nCuotas, cuotaMonto: plan.cuotaMonto,
      primerNumeroId: maxCuotaNumero(cuotasTodas) + 1, nowISO
    });
    const garantias = prepararGarantiasRenovacion(prendasTodas, prestamoOrigenId, preId, nowISO);
    const sourceKey = `COBRO_INTERES_RENOVACION:${prestamoOrigenId}:${evaluacion.cuota.id}`;
    const movimiento = window.cajaService.crearMovimiento({
      id: window.cajaService.generarIdAutomatico(sourceKey), tipo: 'COBRO_INTERES_RENOVACION',
      direccion: 'ingreso', monto: interesRecibido, fecha: nowISO,
      concepto: `Interés cobrado y capital renovado ${prestamoOrigenId} → ${preId}`,
      medioPago: datos.medioCobro, cuentaId: 'GENERAL', eventoTipo: 'RENOVACION_CAPITAL', eventoId: preId,
      prestamoId: prestamoOrigenId, cuotaId: evaluacion.cuota.id, clienteId: prestamoNuevo.clienteId,
      pagoId, componentePagoId, componentesPago, pagoFingerprint: pagoFingerprintCaja, automatico: true, sourceKey,
      operationId, createdByUid: window._fbUser.uid, deviceId: window.DEVICE_ID || null,
      movimientosExistentes: movimientos
    });
    const bitacora = {
      id: `BIT-${operationId}`,
      tipo: 'renovacion_capital',
      descripcion: `Interés cobrado ${window.fmtMoney(interesRecibido)} · capital renovado ${window.fmtMoney(evaluacion.capitalRenovado)} · ${prestamoOrigenId} → ${preId}`,
      refId: prestamoNuevo.clienteId,
      fecha: nowISO,
      operationId,
      deviceId: window.DEVICE_ID || null,
      entidad: 'prestamos',
      recordId: preId,
      estadoAnterior: evaluacion.prestamo.estado,
      estadoNuevo: 'Renovado'
    };
    const existente = movimientos.find(item => item.id === movimiento.id || item.sourceKey === sourceKey);
    if (existente) throw new Error('Esta operación ya tiene un movimiento de Caja. Sincronizá y revisá el préstamo.');
    const registros = [
      { store: 'prestamos', data: prestamoAnterior }, { store: 'cuotas', data: cuotaAnterior },
      { store: 'prestamos', data: prestamoNuevo }, ...cuotasNuevas.map(data => ({ store: 'cuotas', data })),
      ...garantias.map(data => ({ store: 'prendas', data })),
      { store: 'movimientos_caja', data: movimiento }, { store: 'bitacora', data: bitacora }
    ];
    await confirmarRenovacionParcialEnFirebase({ prestamoOrigen: evaluacion.prestamo, cuotasOrigen: [evaluacion.cuota], registros });
    await window.dbCommitOperacionPrestamoCajaAtomic(registros);
    window._renovacionCapitalPrestamoId = '';
    window.closeSheet();
    window.toast(`Interés cobrado y capital renovado como ${preId}`);
    await window.openPrestamoDetail(preId, { push: false });
    void Promise.resolve(window.pushInmediato()).catch(() => window.scheduleDriveSync?.());
  } catch (error) {
    nuevoId = '';
    setRenovacionCapitalError(error?.message || 'No se pudo completar la operación');
  } finally {
    lock.liberar();
  }
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

  const cuotasCobrables = cuotasPendientesRenovacion(cuotas, prestamo.id);
  if (!cuotasCobrables.length) {
    return window.toast('Este prestamo no tiene cuotas cobrables para compensar');
  }

  window._renovacionPrestamoId = prestamo.id;
  document.getElementById('ren-origen').innerHTML =
    `<b>${window.esc(prestamo.clienteNombre || '')}</b> · ${window.esc(prestamo.id)} · ${window.fmtMoney(prestamo.monto)}`;
  const deudaPendiente = deudaPendienteRenovacion(cuotasCobrables);
  document.getElementById('ren-deuda-pendiente').innerHTML =
    `<b>Deuda pendiente real: ${window.fmtMoney(deudaPendiente)}</b><br>` +
    cuotasCobrables.map(c => {
      const saldo = saldoCobrableCuota(c);
      const abonado = Number(c.totalAbonado || 0);
      return c.estado === 'Parcial'
        ? `Cuota ${window.esc(c.nro)}: valor ${window.fmtMoney(c.monto)} · abonado ${window.fmtMoney(abonado)} · saldo a compensar ${window.fmtMoney(saldo)}`
        : `Cuota ${window.esc(c.nro)}: saldo a compensar ${window.fmtMoney(saldo)}`;
    }).join('<br>') +
    `<br><b>Total a compensar: ${window.fmtMoney(deudaPendiente)}</b>`;
  document.getElementById('ren-monto').value = prestamo.monto || '';
  document.getElementById('ren-interes').value = prestamo.interesPorCuota != null
    ? prestamo.interesPorCuota
    : window.round2(Number(prestamo.interes || 0) * 100 / Math.max(Number(prestamo.nCuotas || 1), 1));
  document.getElementById('ren-ncuotas').value = prestamo.nCuotas || '';
  document.getElementById('ren-tipo').value = prestamo.tipo || 'Mensual';
  document.getElementById('ren-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('ren-prenda').value = prestamo.prenda || '';
  document.getElementById('ren-notas').value = `Renovacion de ${prestamo.id}`;
  document.getElementById('ren-medio-entrega').value = 'Efectivo';
  document.getElementById('ren-confirm-text').value = '';
  setRenovacionError('');
  calcularPreviewRenovacion();
  window.openSheet('sh-renovar-prestamo');
}

export function calcularPreviewRenovacion() {
  const prestamoId = window._renovacionPrestamoId;
  const preview = document.getElementById('ren-preview');
  if (!preview || !prestamoId) return;

  const { montoNominal, interesPorCuota, nCuotas } = getRenovacionInputs();
  window.dbAll('cuotas').then(cuotas => {
    const pendientes = cuotasPendientesRenovacion(cuotas, prestamoId);
    const montoCompensado = deudaPendienteRenovacion(pendientes);
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
      montoEntregado < 0
        ? `Renovación inválida · Deuda real ${window.fmtMoney(montoCompensado)} · Faltan ${window.fmtMoney(Math.abs(montoEntregado))}`
        : `Deuda real pendiente ${window.fmtMoney(montoCompensado)} · Compensado ${window.fmtMoney(montoCompensado)} · Dinero realmente entregado ${window.fmtMoney(montoEntregado)}`;
    const medioWrap = document.getElementById('ren-medio-entrega-wrap');
    if (medioWrap) medioWrap.style.display = montoEntregado > 0 ? '' : 'none';
    preview.style.display = '';
  }).catch(() => { preview.style.display = 'none'; });
}

function descargarComprobanteRenovacionPDF(datos) {
  if (!window.jspdf?.jsPDF) return window.toast('PDF no disponible en este dispositivo');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a6' });
  let y = 15;
  doc.setFontSize(16); doc.text('PrestControl', 52.5, y, { align: 'center' });
  y += 8; doc.setFontSize(12); doc.text('COMPROBANTE DE RENOVACION', 52.5, y, { align: 'center' });
  y += 9; doc.setFontSize(9);
  const esRenovacionCapital = datos.renovacionTipo === RENOVACION_CAPITAL_TIPO;
  if (esRenovacionCapital) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text(`INTERES COBRADO: ${window.fmtMoney(datos.interesCobrado || 0)}`, 52.5, y, { align: 'center' });
    y += 8;
    doc.setFontSize(9);
  }
  const filas = [
    ['Cliente', datos.clienteNombre || '—'],
    ['Fecha', datos.fechaTexto],
    ['Prestamo anterior', datos.prestamoOrigenId],
    ['Prestamo nuevo', datos.preId],
    ['Deuda pendiente al renovar', datos.cuotaTexto],
    [esRenovacionCapital ? 'Interes cobrado' : 'Abonado previamente', window.fmtMoney(esRenovacionCapital ? datos.interesCobrado : (datos.montoAbonadoPrevio || 0))],
    [esRenovacionCapital ? 'Capital renovado' : 'Capital nominal nuevo', window.fmtMoney(datos.montoNominal)],
    ['Compensado por renovacion', window.fmtMoney(datos.montoCompensado)],
    [esRenovacionCapital ? 'Efectivo nuevo entregado' : 'Dinero realmente entregado', window.fmtMoney(datos.montoEntregado)],
    ['Total del prestamo nuevo', window.fmtMoney(datos.totalNuevo)],
    ['Plan nuevo', `${datos.nCuotasNuevas} cuotas de ${window.fmtMoney(datos.cuotaNueva)}`],
    ['Metodo', 'Renovacion'],
    ['Estado', 'RENOVADO']
  ];
  for (const [label, value] of filas) {
    doc.setFont(undefined, 'bold'); doc.text(`${label}:`, 10, y);
    doc.setFont(undefined, 'normal');
    const lineas = doc.splitTextToSize(String(value), 58);
    doc.text(lineas, 42, y);
    y += Math.max(6, lineas.length * 4.5);
  }
  y += 2;
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize('La compensacion cancela deuda del prestamo anterior y no representa ingreso de efectivo.', 85), 10, y);
  doc.save(`renovacion_${datos.prestamoOrigenId}_${datos.preId}.pdf`);
}

function mostrarComprobanteRenovacion(datos) {
  const { prestamoOrigenId, preId, montoNominal, montoCompensado, montoEntregado } = datos;
  const body = document.getElementById('sheet-comprobante-body');
  if (!body) return;
  const fechaTexto = datos.fechaTexto || new Date().toLocaleDateString('es-AR');
  const cuotaTexto = datos.cuotaTexto || 'Deuda pendiente compensada';
  const esRenovacionCapital = datos.renovacionTipo === RENOVACION_CAPITAL_TIPO;
  const importePrincipal = esRenovacionCapital ? Number(datos.interesCobrado || 0) : montoEntregado;
  const comprobante = { ...datos, fechaTexto, cuotaTexto };
  body.innerHTML = `
    <div class="receipt-paper">
      <div class="receipt-head">
        <div class="receipt-head-grid">
          <div class="receipt-head-left"><div class="receipt-kicker">Comprobante de renovación</div><div class="receipt-subtitle">Operación confirmada localmente</div></div>
          <div class="receipt-head-right"><div class="receipt-brand">PrestControl</div><div class="receipt-date">${window.esc(fechaTexto)}</div></div>
        </div>
        ${esRenovacionCapital ? '<div class="receipt-kicker">Interés cobrado</div>' : ''}
        <div class="receipt-amount">${window.fmtMoney(importePrincipal)}</div>
      </div>
      <div class="receipt-details">
        <div class="receipt-row"><span class="receipt-label">Cliente</span><span class="receipt-value">${window.esc(datos.clienteNombre || '—')}</span></div>
        <div class="receipt-row"><span class="receipt-label">Fecha</span><span class="receipt-value">${window.esc(fechaTexto)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Préstamo anterior</span><span class="receipt-value">${window.esc(prestamoOrigenId)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Préstamo nuevo</span><span class="receipt-value">${window.esc(preId)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Deuda pendiente al renovar</span><span class="receipt-value">${window.esc(cuotaTexto)}</span></div>
        <div class="receipt-row"><span class="receipt-label">${esRenovacionCapital ? 'Interés cobrado' : 'Abonado previamente'}</span><span class="receipt-value">${window.fmtMoney(esRenovacionCapital ? datos.interesCobrado : (datos.montoAbonadoPrevio || 0))}</span></div>
        <div class="receipt-row"><span class="receipt-label">${esRenovacionCapital ? 'Capital renovado' : 'Capital nominal nuevo'}</span><span class="receipt-value">${window.fmtMoney(montoNominal)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Compensado por renovación</span><span class="receipt-value">${window.fmtMoney(montoCompensado)}</span></div>
        <div class="receipt-row"><span class="receipt-label">${esRenovacionCapital ? 'Efectivo nuevo entregado' : 'Dinero realmente entregado'}</span><span class="receipt-value">${window.fmtMoney(montoEntregado)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Total del préstamo nuevo</span><span class="receipt-value">${window.fmtMoney(datos.totalNuevo)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Plan nuevo</span><span class="receipt-value">${window.esc(`${datos.nCuotasNuevas} cuotas de ${window.fmtMoney(datos.cuotaNueva)}`)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Método</span><span class="receipt-value">Renovación</span></div>
      </div>
      <div class="receipt-note"><b>Compensación contable</b><br>No ingresó efectivo por ${window.fmtMoney(montoCompensado)}.</div>
      <div class="receipt-status">RENOVADO</div>
    </div>
    <div class="receipt-actions">
      <button class="btn btn-grn" data-ren-wa>WhatsApp</button>
      <button class="btn btn-ghost" data-ren-pdf>PDF</button>
    </div>
    <button class="btn btn-ghost btn-full receipt-close" onclick="closeSheet()">Cerrar</button>
    <div class="receipt-meta">PrestControl · Comprobante generado digitalmente</div>`;

  const btnWA = body.querySelector('[data-ren-wa]');
  btnWA?.addEventListener('click', async () => {
    if (btnWA.dataset.submitting === 'true') return;
    btnWA.dataset.submitting = 'true'; btnWA.disabled = true;
    try {
      const cliente = datos.clienteId ? await window.dbGet('clientes', datos.clienteId) : null;
      if (!cliente?.telefono) return window.toast('El cliente no tiene teléfono registrado');
      const lineaCobro = esRenovacionCapital
        ? `Interés cobrado: ${window.fmtMoney(datos.interesCobrado || 0)}`
        : `Abonado previamente: ${window.fmtMoney(datos.montoAbonadoPrevio || 0)}`;
      const lineaCapital = esRenovacionCapital ? 'Capital renovado' : 'Capital nominal nuevo';
      const lineaEntrega = esRenovacionCapital ? 'Efectivo nuevo entregado' : 'Dinero entregado';
      const mensaje = `*PrestControl · Renovación*\nCliente: *${datos.clienteNombre || cliente.nombre || '—'}*\nFecha: ${fechaTexto}\nPréstamo anterior: ${prestamoOrigenId}\nPréstamo nuevo: ${preId}\nDeuda pendiente al renovar: ${cuotaTexto}\n${lineaCobro}\nCompensado: ${window.fmtMoney(montoCompensado)} (sin ingreso de efectivo)\n${lineaCapital}: ${window.fmtMoney(montoNominal)}\n${lineaEntrega}: *${window.fmtMoney(montoEntregado)}*\nTotal nuevo: ${window.fmtMoney(datos.totalNuevo)}\nPlan nuevo: ${datos.nCuotasNuevas} cuotas de ${window.fmtMoney(datos.cuotaNueva)}\nEstado: *RENOVADO*`;
      window.abrirWhatsAppSeguro(cliente.telefono, mensaje);
    } finally {
      btnWA.disabled = false; delete btnWA.dataset.submitting;
    }
  });
  body.querySelector('[data-ren-pdf]')?.addEventListener('click', () => descargarComprobanteRenovacionPDF(comprobante));
  window.openSheet('sheet-comprobante');
}

export async function abrirComprobanteRenovacion(prestamoId) {
  const [prestamos, cuotas, clientes] = await Promise.all([
    window.dbAllIncludeDeleted('prestamos'),
    window.dbAllIncludeDeleted('cuotas'),
    window.dbAllIncludeDeleted('clientes')
  ]);
  const porId = new Map(prestamos.map(prestamo => [prestamo.id, prestamo]));
  const seleccionado = porId.get(prestamoId);
  if (!seleccionado || seleccionado._deleted === true) {
    return window.toast('Préstamo no encontrado');
  }

  const prestamoOrigen = ['renovacion', 'renovacion_capital'].includes(seleccionado.cerradoPor)
    ? seleccionado
    : porId.get(seleccionado.prestamoOrigenId);
  const prestamoNuevo = seleccionado.origen === 'renovacion'
    ? seleccionado
    : porId.get(seleccionado.prestamoRenovacionId);
  if (!prestamoOrigen || !prestamoNuevo) {
    return window.toast('No se pudo reconstruir la relación de renovación');
  }

  const idsPersistidos = new Set(
    Array.isArray(prestamoNuevo.cuotasCompensadas)
      ? prestamoNuevo.cuotasCompensadas
      : []
  );
  const compensadas = cuotas
    .filter(cuota =>
      cuota?._deleted !== true &&
      cuota.prestamoId === prestamoOrigen.id &&
      ['renovacion_descuento', ORIGEN_COBRO_INTERES_RENOVACION].includes(cuota.origenPago) &&
      (idsPersistidos.size === 0 || idsPersistidos.has(cuota.id))
    )
    .sort((a, b) => Number(a.nro || 0) - Number(b.nro || 0));
  if (!compensadas.length) {
    return window.toast('No se encontraron las cuotas compensadas de la renovación');
  }

  const montoCompensado = window.round2(compensadas.reduce(
    (total, cuota) => total + Number(cuota.montoCompensado ?? cuota.monto ?? 0),
    0
  ));
  const montoAbonadoPrevio = window.round2(compensadas.reduce(
    (total, cuota) => total + Number(cuota.totalAbonadoAlRenovar ?? cuota.totalAbonado ?? 0),
    0
  ));
  const cliente = clientes.find(item => item.id === prestamoNuevo.clienteId);
  const fechaISO = prestamoOrigen.renovadoEn || compensadas[0]?.fechaPago || prestamoNuevo.creadoEn || prestamoNuevo.createdAt;
  const numeros = compensadas.map(cuota => cuota.nro ?? cuota.id).join(', ');

  mostrarComprobanteRenovacion({
    prestamoOrigenId: prestamoOrigen.id,
    preId: prestamoNuevo.id,
    clienteId: prestamoNuevo.clienteId,
    clienteNombre: prestamoNuevo.clienteNombre || cliente?.nombre || '',
    fechaTexto: fechaISO ? new Date(fechaISO).toLocaleDateString('es-AR') : '—',
    cuotaTexto: `Cuotas ${numeros} · ${window.fmtMoney(montoCompensado)} · canceladas por renovación`,
    montoNominal: Number(prestamoNuevo.montoNominal ?? prestamoNuevo.monto ?? 0),
    montoCompensado,
    montoAbonadoPrevio,
    renovacionTipo: prestamoNuevo.renovacionTipo || prestamoOrigen.renovacionTipo || '',
    interesCobrado: Number(prestamoNuevo.montoInteresCobradoRenovacion ?? compensadas.reduce((total, cuota) => total + Number(cuota.interesCobradoReal || 0), 0)),
    montoEntregado: Number(prestamoNuevo.montoEntregado ?? 0),
    totalNuevo: Number(prestamoNuevo.total || 0),
    nCuotasNuevas: Number(prestamoNuevo.nCuotas || 0),
    cuotaNueva: Number(prestamoNuevo.cuota || 0)
  });
}

export async function confirmarRenovacionPrestamo() {
  const btn = document.getElementById('ren-save');
  const prestamoOrigenId = window._renovacionPrestamoId;
  if (!prestamoOrigenId) return;
  const confirmacion = document.getElementById('ren-confirm-text')?.value.trim().toUpperCase();
  if (confirmacion !== 'RENOVAR') {
    setRenovacionError('Escribí RENOVAR para confirmar la operación');
    document.getElementById('ren-confirm-text')?.focus();
    return;
  }
  const operacion = window.iniciarOperacionProtegida?.(`prestamo:renovar:${prestamoOrigenId}`, btn, 'Renovando...');
  if (!operacion) return;
  setRenovacionError('');
  let renovacionCreadaId = '';

  try {
    if (await window.bloquearEscrituraPorRestorePending?.()) return;
    if (await window.bloquearFinanzasDuranteCargaHistorica?.()) return;
    const { montoNominal, interesPorCuota, nCuotas, tipo, fechaRaw } = getRenovacionInputs();
    window.prestamoService.validarDatosPrestamo({
      clienteId: 'renovacion',
      monto: montoNominal,
      tasaPorCuota: interesPorCuota,
      nCuotas,
      fecha: fechaRaw
    });
    if (!['Mensual', 'Semanal'].includes(tipo)) throw new Error('Selecciona una frecuencia valida');

    const [prestamoOrigen, prestamos, cuotasTodas, prendasTodas] = await Promise.all([
      window.dbGet('prestamos', prestamoOrigenId),
      window.dbAllIncludeDeleted('prestamos'),
      window.dbAllIncludeDeleted('cuotas'),
      window.dbAllIncludeDeleted('prendas')
    ]);
    if (!prestamoOrigen || prestamoOrigen._deleted) throw new Error('Prestamo origen no encontrado');
    if (prestamoOrigen.prestamoRenovacionId) {
      const destinoExistente = prestamoOrigen.prestamoRenovacionId;
      const pendientesDeTraslado = prepararGarantiasRenovacion(prendasTodas, prestamoOrigenId, destinoExistente, new Date().toISOString());
      for (const prenda of pendientesDeTraslado) {
        await window.dbPut('prendas', prenda);
        const persistida = await window.dbGet('prendas', prenda.id);
        await window.addToSyncQueueOrThrow('prendas', prenda.id, persistida, 'upsert');
      }
      if (pendientesDeTraslado.length) window.scheduleDriveSync?.();
      window.closeSheet();
      window.toast(`La renovación ya existía como ${destinoExistente}; no se creó otra${pendientesDeTraslado.length ? ` y se completó el traslado de ${pendientesDeTraslado.length} garantía${pendientesDeTraslado.length !== 1 ? 's' : ''}` : ''}`);
      await window.openPrestamoDetail(destinoExistente);
      return;
    }
    if (!['Activo', 'Atrasado'].includes(prestamoOrigen.estado)) throw new Error('Solo se pueden renovar prestamos activos o atrasados');

    const cliente = await window.dbGet('clientes', prestamoOrigen.clienteId);
    if (cliente?.estado === 'Bloqueado') throw new Error('Cliente bloqueado. No puede recibir nuevos prestamos.');

    const cuotasCompensadas = cuotasPendientesRenovacion(cuotasTodas, prestamoOrigenId);
    if (!cuotasCompensadas.length) throw new Error('El préstamo no tiene deuda pendiente para renovar');
    const incluyeCuotasParciales = cuotasCompensadas.some(cuota =>
      cuota.estado === 'Parcial' && saldoCobrableCuota(cuota) > 0
    );
    if (incluyeCuotasParciales && (!navigator.onLine || !window._fbUser || !window._fbDb?.runTransaction)) {
      throw new Error('La renovación con cuotas parciales requiere conexión para verificar el saldo actual.');
    }
    const montoCompensado = deudaPendienteRenovacion(cuotasCompensadas);
    const montoAbonadoPrevio = totalAbonadoPrevioRenovacion(cuotasCompensadas);
    const montoEntregado = window.round2(montoNominal - montoCompensado);
    if (montoEntregado < 0) {
      throw new Error(
        `El monto nominal no alcanza para cancelar la deuda anterior. Faltan ${window.fmtMoney(Math.abs(montoEntregado))} ` +
        `(deuda ${window.fmtMoney(montoCompensado)}).`
      );
    }
    const medioEntrega = document.getElementById('ren-medio-entrega')?.value || '';
    if (montoEntregado > 0) {
      if (!MEDIOS_ENTREGA.has(medioEntrega)) throw new Error('Seleccioná un medio de entrega válido');
      if (!(await cajaEstaIniciada())) {
        ofrecerIrACaja();
        return;
      }
    }

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
      renovacionTipo: 'refinanciacion_deuda_total',
      montoNominal,
      montoEntregado,
      montoCompensado,
      montoAbonadoPrevioRenovacion: montoAbonadoPrevio,
      medioEntrega: montoEntregado > 0 ? medioEntrega : null,
      cuotasCompensadas: cuotasCompensadas.map(cuota => cuota.id),
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

    const cuotasOrigenActualizadas = cerrarCuotasPorRenovacion(cuotasCompensadas, preId, nowISO);

    const prestamoOrigenActualizado = {
      ...prestamoOrigen,
      estado: 'Pagado',
      cerradoPor: 'renovacion',
      prestamoRenovacionId: preId,
      renovadoEn: nowISO,
      updatedAt: nowISO
    };

    const garantiasTrasladadas = prepararGarantiasRenovacion(prendasTodas, prestamoOrigenId, preId, nowISO);

    const operationIdRenovacion = nuevaOperacionFinanciera('renovacion');
    nuevoPrestamo.operationId = operationIdRenovacion;
    let movimientoCaja = null;
    if (montoEntregado > 0) {
      const sourceKey = `DESEMBOLSO_RENOVACION:${preId}`;
      movimientoCaja = window.cajaService.crearMovimiento({
        id: window.cajaService.generarIdAutomatico(sourceKey),
        tipo: 'DESEMBOLSO_RENOVACION', direccion: 'egreso', monto: montoEntregado,
        fecha: fechaRaw, concepto: `Efectivo entregado renovación ${preId}`,
        medioPago: medioEntrega, cuentaId: 'GENERAL', eventoTipo: 'RENOVACION', eventoId: preId,
        prestamoId: preId, clienteId: prestamoOrigen.clienteId, automatico: true, sourceKey,
        operationId: operationIdRenovacion, createdByUid: window._fbUser?.uid || null,
        deviceId: window.DEVICE_ID || null
      });
      const existente = (await window.dbAll('movimientos_caja')).find(m => m.sourceKey === sourceKey || m.id === movimientoCaja.id);
      if (existente) {
        if (!movimientoCajaCompatible(existente, movimientoCaja)) throw new Error(`Conflicto de integridad en Caja para ${preId}`);
        movimientoCaja = null;
      }
    }
    const registrosRenovacion = [
      { store: 'prestamos', data: nuevoPrestamo },
      ...cuotasNuevas.map(data => ({ store: 'cuotas', data })),
      ...cuotasOrigenActualizadas.map(data => ({ store: 'cuotas', data })),
      { store: 'prestamos', data: prestamoOrigenActualizado },
      ...garantiasTrasladadas.map(data => ({ store: 'prendas', data })),
      ...(movimientoCaja ? [{ store: 'movimientos_caja', data: movimientoCaja }] : [])
    ];
    if (incluyeCuotasParciales) {
      await confirmarRenovacionParcialEnFirebase({
        prestamoOrigen,
        cuotasOrigen: cuotasCompensadas,
        registros: registrosRenovacion
      });
    }
    await window.dbCommitOperacionPrestamoCajaAtomic(registrosRenovacion);
    renovacionCreadaId = preId;

    await window.logBitacora('renovacion',
      `Renovacion: ${prestamoOrigenId} -> ${preId} · Nominal ${window.fmtMoney(montoNominal)} · Compensado ${window.fmtMoney(montoCompensado)} · Entregado ${window.fmtMoney(montoEntregado)}`,
      prestamoOrigen.clienteId
    );
    if (montoEntregado > 0) await window.logBitacora('caja_desembolso_renovacion', `Efectivo entregado registrado en Caja: ${preId} · ${window.fmtMoney(montoEntregado)} · ${medioEntrega}`, preId);
    window.closeSheet();
    window.toast(`Préstamo ${preId} renovado correctamente${garantiasTrasladadas.length ? ` · ${garantiasTrasladadas.length} garantía${garantiasTrasladadas.length !== 1 ? 's' : ''} trasladada${garantiasTrasladadas.length !== 1 ? 's' : ''}` : ''}`);
    Promise.resolve(window.updateBadges()).catch(error => console.warn('No se pudieron actualizar badges tras renovar:', error));
    Promise.resolve(window.openPrestamoDetail(preId)).catch(error => {
      console.warn('No se pudo abrir el detalle tras renovar:', error);
      window.goPage('prestamos');
    });
    mostrarComprobanteRenovacion({
      prestamoOrigenId,
      preId,
      clienteId: prestamoOrigen.clienteId,
      clienteNombre: prestamoOrigen.clienteNombre,
      fechaTexto: new Date(nowISO).toLocaleDateString('es-AR'),
      cuotaTexto: `${cuotasCompensadas.length} cuotas · ${window.fmtMoney(montoCompensado)} · canceladas por renovación`,
      montoNominal,
      montoCompensado,
      montoAbonadoPrevio,
      montoEntregado,
      totalNuevo: total,
      nCuotasNuevas: nCuotas,
      cuotaNueva: cuotaMonto
    });

    const syncTerminada = await Promise.race([
      Promise.resolve(window.pushInmediato()).then(resultado => resultado !== false).catch(() => false),
      new Promise(resolve => setTimeout(() => resolve(false), 8000))
    ]);
    if (!syncTerminada) {
      window.scheduleDriveSync?.();
      window.toast(`La renovación ${preId} quedó guardada localmente y pendiente de sincronización`);
    }
  } catch (e) {
    if (renovacionCreadaId) {
      window.closeSheet();
      window.scheduleDriveSync?.();
      window.toast(`La renovación ${renovacionCreadaId} quedó guardada localmente; la finalización visual o sincronización quedó pendiente`);
    } else {
      setRenovacionError(e.message || 'No se pudo renovar el prestamo');
    }
  } finally {
    operacion.liberar();
  }
}

export async function confirmarBorrarPrestamo(id) {
  const p = await window.dbGet('prestamos', id);
  if (!p) return;
  window._deletePrestamoId = id;
  window._deletePrestamoMotivo = null;
  window._ejecucionReturnPrendaId = '';
  document.getElementById('dp-title').textContent = '🗑️ Eliminar Préstamo';
  document.getElementById('dp-motivos-wrap').style.display = '';
  document.getElementById('dp-help').innerHTML = 'Las cuotas ya pagadas se conservan en el historial y balance.<br>Las cuotas pendientes se marcarán como eliminadas.';
  const finalBtn = document.getElementById('dp-confirm-final');
  finalBtn.textContent = 'Eliminar';
  finalBtn.className = 'btn btn-red';

  const cuotas = (await window.dbAll('cuotas')).filter(c => c.prestamoId === id);
  if (cuotas.some(c => c.estado === 'Parcial' && Number(c.saldoPendiente || 0) > 0)) {
    return window.toast('Este préstamo tiene cuotas con abonos parciales y no puede eliminarse en esta fase.');
  }
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

export async function confirmarEjecutarPrestamo(id, volverAPrendaId = '') {
  const [prestamo, prendas, cuotas] = await Promise.all([
    window.dbGet('prestamos', id),
    window.dbAll('prendas'),
    window.dbAll('cuotas')
  ]);
  const normalizar = value => String(value || '').trim().toLocaleLowerCase('es-AR');
  const garantias = prendas.filter(prenda =>
    normalizar(prenda.prestamoId) === normalizar(id) && prenda._deleted !== true && normalizar(prenda.estado) === 'en garantía'
  );
  if (!prestamo || prestamo._deleted || !['activo', 'atrasado'].includes(normalizar(prestamo.estado))) {
    return window.toast('Solo se pueden ejecutar préstamos activos o atrasados');
  }
  if (!garantias.length) return window.toast('El préstamo no tiene garantías activas para ejecutar');

  window._deletePrestamoId = id;
  window._deletePrestamoMotivo = 'perdon';
  window._ejecucionReturnPrendaId = volverAPrendaId;
  const vinculadas = cuotas.filter(c => c.prestamoId === id && !c._deleted);
  if (vinculadas.some(c => c.estado === 'Parcial' && Number(c.saldoPendiente || 0) > 0)) {
    return window.toast('Este préstamo tiene cuotas con abonos parciales y no puede ejecutarse en esta fase.');
  }
  const pagadas = vinculadas.filter(c => c.estado === 'Pagado').length;
  const pendientes = vinculadas.length - pagadas;
  document.getElementById('dp-title').textContent = 'Ejecutar préstamo';
  document.getElementById('dp-info').innerHTML =
    `<b>${prestamo.clienteNombre}</b> · ${window.fmtMoney(prestamo.monto)} · ${garantias.length} garantía${garantias.length !== 1 ? 's' : ''}<br>` +
    `<span style="color:var(--grn)">✅ ${pagadas} pagadas</span> &nbsp; <span style="color:var(--yel)">⏳ ${pendientes} a ejecutar</span>`;
  document.getElementById('dp-motivos-wrap').style.display = 'none';
  document.getElementById('dp-mot-texto').value = '';
  document.getElementById('dp-pass').value = '';
  document.getElementById('dp-err').classList.remove('on');
  document.getElementById('dp-help').innerHTML = 'Las cuotas pagadas se conservarán. Las pendientes pasarán a Ejecutada y las garantías activas quedarán disponibles para venta.';
  const finalBtn = document.getElementById('dp-confirm-final');
  finalBtn.textContent = 'Ejecutar préstamo';
  finalBtn.className = 'btn btn-red';
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

  if (!motivo || !pass) {
    if (!motivo) window.toast('Selecciona un motivo');
    else { errEl.textContent = 'Ingresa tu contrasena para confirmar'; errEl.classList.add('on'); }
    return;
  }
  const operacion = window.iniciarOperacionProtegida?.(
    `prestamo:cerrar:${id}`,
    document.activeElement,
    'Procesando...'
  );
  if (!operacion) return;
  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  if (await window.bloquearFinanzasDuranteCargaHistorica?.()) return;

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
    errEl.textContent = 'Se requiere una sesión Firebase activa para confirmar';
    errEl.classList.add('on');
    return;
  }

  if (!passValida) {
    errEl.textContent = 'Contraseña incorrecta';
    errEl.classList.add('on');
    document.getElementById('dp-pass').value = '';
    return;
  }
  errEl.classList.remove('on');

  const pre = await window.dbGet('prestamos', id);
  if (pre?.cargaInicial && ['error','otro'].includes(motivo)) throw new Error('El registro histórico auditado no puede eliminarse. Se requiere revisión de la corrección.');
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
      await window.registrarCobroCuotaCaja(c.id, 'Cancelación total', fechaPago, {
        notas: (c.notas || '') + (motTexto ? ` · ${motTexto}` : '')
      });
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
      await window.addToSyncQueueOrThrow('prestamos', id, preActualizado, 'upsert');
    }
    await window.logBitacora('pago_completo',
      `Préstamo cancelado por pago total: ${pre?.clienteNombre || id} · ${pre ? window.fmtMoney(pre.total) : ''} · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} cerrada${cuotasPendientes.length!==1?'s':''}`,
      pre?.clienteId
    );
    await window.pushInmediato();
    window.closeSheet();
    window.toast(`✅ Préstamo cerrado como pagado · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} cancelada${cuotasPendientes.length!==1?'s':''}`);
    await window.goPage('prestamos');
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
      await window.addToSyncQueueOrThrow('cuotas', c.id, cEjec, 'upsert');
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
      await window.addToSyncQueueOrThrow('prestamos', id, preActualizado, 'upsert');
    }
    const yaPagadas = cuotas.filter(c => c.prestamoId === id && !c._deleted && c.estado === 'Pagado').length;
    await window.logBitacora('prenda_ejecutada',
      `Préstamo cerrado por ejecución de prenda: ${pre?.clienteNombre || id} · ${yaPagadas} cuota${yaPagadas!==1?'s':''} cobrada${yaPagadas!==1?'s':''} previamente · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} ejecutada${cuotasPendientes.length!==1?'s':''}`,
      pre?.clienteId
    );
    await window.pushInmediato();
    window.closeSheet();
    window.toast(`🔒 Préstamo cerrado por prenda · ${cuotasPendientes.length} cuota${cuotasPendientes.length!==1?'s':''} ejecutada${cuotasPendientes.length!==1?'s':''}`);
    const volverAPrendaId = window._ejecucionReturnPrendaId;
    window._ejecucionReturnPrendaId = '';
    if (volverAPrendaId) await window.openPrendaDetail(volverAPrendaId, { push: false });
    else await window.goPage('prestamos');
    return;
  }

  // ── ERROR DE CARGA / OTRO MOTIVO ──
  // Borrado lógico total (como antes) - para eliminar errores sin afectar balance
  if (pre) {
    await window.dbPut('prestamos', { ...pre, estado: 'Cancelado', motivoCancelacion: motivoFinal, canceladoEn: nowISO, updatedAt: nowISO });
  }
  for (const c of cuotasPendientes) {
    await window.dbSoftDeleteAndQueue('cuotas', c.id);
  }
  await window.dbSoftDeleteAndQueue('prestamos', id);

  await window.logBitacora('eliminacion',
    `Préstamo eliminado [${motivoFinal}]: ${pre?.clienteNombre || id} · ${pre ? window.fmtMoney(pre.monto) : ''}`,
    pre?.clienteId
  );
  await window.pushInmediato();

  window.closeSheet();
  window.toast(`🗑️ Préstamo eliminado · ${motivoLabel}`);
  await window.goPage('prestamos');
  } catch (error) {
    if (error?.code === 'CAJA_NO_INICIADA') {
      window.closeSheet();
      if (window.confirm(`${error.message}\n\n¿Ir a Caja?`)) await window.goPage('caja');
    } else {
      window.toast('⚠️ ' + (error?.message || 'No se pudo completar la operación'));
    }
  } finally {
    operacion.liberar();
  }
}
