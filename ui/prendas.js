// Inventario de Prendas — sincronizado mediante la cola oficial de PrestControl.

const ESTADOS_PRENDA = [
  'En garantía',
  'Ejecutada',
  'En venta',
  'Vendida'
];

let prestamoOriginalEdicion = '';
let altaForzadaPrestamoId = '';
const MEDIOS_VENTA = new Set(['Efectivo', 'Transferencia', 'MercadoPago', 'Otro']);

export function prendaEstadoBadge(estado) {
  return ({
    'En garantía': 'bg-yel',
    'Ejecutada': 'badge-prenda-ejecutada',
    'En venta': 'badge-info',
    'Vendida': 'badge-success'
  })[estado] || 'badge-muted';
}

async function encolarPrenda(prenda, operation = 'upsert', { esperarPush = true } = {}) {
  const payload = operation === 'delete'
    ? {
        id: prenda.id,
        _deleted: true,
        deletedAt: prenda.deletedAt,
        updatedAt: prenda.updatedAt,
        _restoreAuthority: prenda._restoreAuthority || null
      }
    : prenda;
  const queued = await window.addToSyncQueue('prendas', prenda.id, payload, operation);
  if (!queued?.opId) {
    console.warn('[PRENDAS SYNC] Escritura local sin encolado confirmado', { id: prenda.id, operation });
    window.toast(`⚠️ ${prenda.id} quedó guardada localmente, pero pendiente de sincronización`);
    throw new Error(`La prenda ${prenda.id} quedó guardada localmente, pero no pudo encolarse para sincronización`);
  }
  if (esperarPush) {
    await window.pushInmediato();
  } else {
    void Promise.resolve(window.pushInmediato()).catch(error => {
      console.warn('[PRENDAS SYNC] Publicación remota pendiente; se conserva sync_queue', {
        id: prenda.id,
        operation,
        error
      });
    });
  }
  return queued;
}

async function guardarPrendaSincronizada(prenda, opcionesSync) {
  await window.dbPut('prendas', prenda);
  const persistida = await window.dbGet('prendas', prenda.id);
  await encolarPrenda(persistida, 'upsert', opcionesSync);
  return persistida;
}

async function eliminarPrendaSincronizada(id) {
  await window.dbSoftDelete('prendas', id);
  const tombstone = await window.dbGet('prendas', id);
  if (!tombstone?._deleted) throw new Error(`No se pudo confirmar el borrado lógico de ${id}`);
  await encolarPrenda(tombstone, 'delete');
  return tombstone;
}

function valor(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function normalizarRelacion(value) {
  return String(value || '').trim().toLocaleLowerCase('es-AR');
}

function ubicacionPrenda(prenda) {
  return [prenda.deposito, prenda.estante, prenda.caja].filter(Boolean).join(' · ') || 'Sin ubicación';
}

function opcionesEstados(seleccionado = 'En garantía') {
  return ESTADOS_PRENDA.map(estado =>
    `<option value="${window.esc(estado)}"${estado === seleccionado ? ' selected' : ''}>${window.esc(estado)}</option>`
  ).join('');
}

async function contextoPrendas() {
  const [prendas, clientes, prestamosTodos] = await Promise.all([
    window.dbAll('prendas'),
    window.dbAll('clientes'),
    window.dbAllIncludeDeleted('prestamos')
  ]);
  const prestamosTodosMap = new Map(prestamosTodos.map(prestamo => [prestamo.id, prestamo]));
  const prendasVigentes = [];
  for (const prenda of prendas) {
    const prestamo = prestamosTodosMap.get(prenda.prestamoId);
    if (!prestamo || prestamo._deleted === true) {
      console.warn('[PRENDAS] Relación no disponible; la prenda permanece visible hasta completar la sincronización', {
        prendaId: prenda.id,
        prestamoId: prenda.prestamoId
      });
    }
    prendasVigentes.push(prenda);
  }
  const prestamos = prestamosTodos.filter(prestamo => prestamo._deleted !== true);
  return {
    prendas: prendasVigentes,
    clientes,
    prestamos,
    clientesMap: new Map(clientes.map(cliente => [cliente.id, cliente])),
    prestamosMap: new Map(prestamos.map(prestamo => [prestamo.id, prestamo]))
  };
}

function prestamosPermitidos(prestamos, clienteId, prestamoConservado = '') {
  return prestamos.filter(prestamo =>
    prestamo.clienteId === clienteId &&
    (['Activo', 'Atrasado'].includes(prestamo.estado) || prestamo.id === prestamoConservado)
  );
}

export async function actualizarPrestamosPrenda(prestamoSeleccionado = '') {
  const clienteId = valor('pda-cliente');
  const select = document.getElementById('pda-prestamo');
  if (!select) return;

  const prestamos = await window.dbAll('prestamos');
  const permitidoActual = prestamoSeleccionado || select.value || prestamoOriginalEdicion;
  const disponibles = prestamosPermitidos(prestamos, clienteId, prestamoOriginalEdicion);
  select.innerHTML = '<option value="">Seleccionar préstamo</option>' + disponibles.map(prestamo =>
    `<option value="${window.esc(prestamo.id)}"${prestamo.id === permitidoActual ? ' selected' : ''}>${window.esc(prestamo.id)} · ${window.esc(prestamo.estado)} · ${window.fmtMoney(prestamo.monto || 0)}</option>`
  ).join('');
  select.disabled = !clienteId;
}

export async function openSheetPrenda(editId = '') {
  const [clientes, prenda] = await Promise.all([
    window.dbAll('clientes'),
    editId ? window.dbGet('prendas', editId) : Promise.resolve(null)
  ]);
  if (editId && (!prenda || prenda._deleted)) {
    window.toast('Prenda no encontrada');
    return;
  }
  if (editId && prenda.estado === 'Vendida') {
    window.toast('La garantía vendida está cerrada y no admite modificaciones');
    return;
  }

  altaForzadaPrestamoId = '';
  document.getElementById('pda-edit-id').value = editId;
  document.getElementById('sh-prenda-title').textContent = editId ? '✏️ Editar Prenda' : '🏷️ Nueva Prenda';
  prestamoOriginalEdicion = prenda?.prestamoId || '';

  const clienteSelect = document.getElementById('pda-cliente');
  clienteSelect.disabled = false;
  document.getElementById('pda-prestamo').disabled = false;
  clienteSelect.innerHTML = '<option value="">Seleccionar cliente</option>' + clientes.map(cliente =>
    `<option value="${window.esc(cliente.id)}">${window.esc(cliente.nombre)} · ${window.esc(cliente.id)}</option>`
  ).join('');

  const campos = {
    'pda-descripcion': prenda?.descripcion,
    'pda-categoria': prenda?.categoria,
    'pda-marca': prenda?.marca,
    'pda-modelo': prenda?.modelo,
    'pda-serie': prenda?.numeroSerie,
    'pda-imei': prenda?.imei,
    'pda-motor': prenda?.numeroMotor,
    'pda-chasis': prenda?.numeroChasis,
    'pda-color': prenda?.color,
    'pda-estado-fisico': prenda?.estadoFisico,
    'pda-observaciones': prenda?.observaciones,
    'pda-valor': prenda?.valorEstimado,
    'pda-valor-minimo': prenda?.valorMinimo,
    'pda-fecha': prenda?.fechaIngreso ? String(prenda.fechaIngreso).slice(0, 10) : new Date().toISOString().slice(0, 10),
    'pda-deposito': prenda?.deposito,
    'pda-estante': prenda?.estante,
    'pda-caja': prenda?.caja
  };
  Object.entries(campos).forEach(([id, dato]) => {
    document.getElementById(id).value = dato ?? '';
  });
  clienteSelect.value = prenda?.clienteId || '';
  document.getElementById('pda-estado').innerHTML = opcionesEstados(prenda?.estado || 'En garantía');
  document.getElementById('pda-estado').disabled = true;
  await actualizarPrestamosPrenda(prenda?.prestamoId || '');
  window.openSheet('sh-prenda');
}

export function toggleGarantiaNuevoPrestamo() {
  const activa = document.getElementById('pre-garantia-activa')?.checked === true;
  const bloque = document.getElementById('pre-garantia-campos');
  if (bloque) bloque.style.display = activa ? '' : 'none';
}

export function resetGarantiaNuevoPrestamo() {
  const check = document.getElementById('pre-garantia-activa');
  if (check) check.checked = false;
  ['descripcion','categoria','marca','modelo','serie','imei','motor','chasis','color','estado-fisico','valor','valor-minimo','deposito','estante','caja','observaciones']
    .forEach(sufijo => {
      const campo = document.getElementById('pre-gar-' + sufijo);
      if (campo) campo.value = '';
    });
  const fecha = document.getElementById('pre-gar-fecha');
  if (fecha) fecha.value = new Date().toISOString().slice(0, 10);
  limpiarErroresGarantia();
  toggleGarantiaNuevoPrestamo();
}

function limpiarErroresGarantia() {
  const bloque = document.getElementById('pre-garantia-campos');
  bloque?.querySelectorAll('[aria-invalid="true"]').forEach(campo => campo.removeAttribute('aria-invalid'));
  bloque?.querySelectorAll('.garantia-field-error').forEach(error => error.remove());
}

function invalidarCampoGarantia(campoId, mensaje) {
  const campo = document.getElementById(campoId);
  if (campo) {
    campo.setAttribute('aria-invalid', 'true');
    const error = document.createElement('div');
    error.className = 'form-help garantia-field-error';
    error.style.color = 'var(--red)';
    error.textContent = mensaje;
    campo.closest('.field')?.appendChild(error);
    campo.addEventListener('input', () => {
      campo.removeAttribute('aria-invalid');
      error.remove();
    }, { once: true });
    campo.focus({ preventScroll: true });
    requestAnimationFrame(() => campo.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  throw new Error(mensaje);
}

export function obtenerGarantiaNuevoPrestamo() {
  if (document.getElementById('pre-garantia-activa')?.checked !== true) return null;
  limpiarErroresGarantia();
  const leer = sufijo => document.getElementById('pre-gar-' + sufijo)?.value?.trim() || '';
  const datos = {
    descripcion: leer('descripcion'),
    categoria: leer('categoria'),
    marca: leer('marca'),
    modelo: leer('modelo'),
    numeroSerie: leer('serie'),
    imei: leer('imei'),
    numeroMotor: leer('motor'),
    numeroChasis: leer('chasis'),
    color: leer('color'),
    estadoFisico: leer('estado-fisico'),
    valorEstimado: Number(leer('valor') || 0),
    valorMinimo: Number(leer('valor-minimo') || 0),
    fechaIngreso: leer('fecha'),
    deposito: leer('deposito'),
    estante: leer('estante'),
    caja: leer('caja'),
    observaciones: leer('observaciones'),
    estado: 'En garantía'
  };
  if (!datos.descripcion) invalidarCampoGarantia('pre-gar-descripcion', 'Ingresá la descripción de la garantía');
  if (!datos.fechaIngreso) invalidarCampoGarantia('pre-gar-fecha', 'Ingresá la fecha de ingreso de la garantía');
  if (!Number.isFinite(datos.valorEstimado) || datos.valorEstimado < 0) invalidarCampoGarantia('pre-gar-valor', 'Ingresá un valor estimado válido');
  if (!Number.isFinite(datos.valorMinimo) || datos.valorMinimo < 0) invalidarCampoGarantia('pre-gar-valor-minimo', 'Ingresá un valor mínimo válido');
  return datos;
}

export async function crearPrendaLocalParaPrestamo(clienteId, prestamoId, datos) {
  if (await window.bloquearEscrituraPorRestorePending?.()) {
    throw new Error('Modo solo lectura por restauración pendiente');
  }
  if (!clienteId || !prestamoId || !datos?.descripcion) throw new Error('Datos de garantía incompletos');
  const prestamo = await window.dbGet('prestamos', prestamoId);
  if (!prestamo || prestamo._deleted || prestamo.clienteId !== clienteId) {
    throw new Error('La relación cliente/préstamo de la garantía no es válida');
  }
  const todos = await window.dbAllIncludeDeleted('prendas');
  const id = window.nextId('PD', todos);
  const prenda = {
    id,
    clienteId,
    prestamoId,
    ...datos,
    estado: 'En garantía',
    _deleted: false,
    deletedAt: null
  };
  await guardarPrendaSincronizada(prenda);
  await window.logBitacora('prenda_creada', `Prenda creada: ${id} · ${prenda.descripcion} · préstamo ${prestamoId}`, id);
  return prenda;
}

export async function openAgregarGarantiaPrestamo(prestamoId) {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prestamo = await window.dbGet('prestamos', prestamoId);
  if (!prestamo || prestamo._deleted) return window.toast('Préstamo no encontrado');
  if (!['Activo', 'Atrasado'].includes(prestamo.estado)) {
    return window.toast('Solo podés agregar garantías a préstamos activos o atrasados');
  }

  await openSheetPrenda();
  altaForzadaPrestamoId = prestamo.id;
  prestamoOriginalEdicion = prestamo.id;
  document.getElementById('sh-prenda-title').textContent = '🏷️ Agregar garantía';
  document.getElementById('pda-cliente').value = prestamo.clienteId;
  await actualizarPrestamosPrenda(prestamo.id);
  document.getElementById('pda-prestamo').value = prestamo.id;
  document.getElementById('pda-cliente').disabled = true;
  document.getElementById('pda-prestamo').disabled = true;
}

export async function cargarGarantiasEdicionPrestamo(prestamoId) {
  const contenedor = document.getElementById('edit-pre-garantias');
  if (!contenedor) return;
  const idNormalizado = String(prestamoId || '').trim().toUpperCase();
  const prendas = (await window.dbAllIncludeDeleted('prendas')).filter(prenda =>
    prenda?._deleted !== true && String(prenda.prestamoId || '').trim().toUpperCase() === idNormalizado
  );
  contenedor.innerHTML = `${prendas.length
    ? prendas.map(prenda => `<button class="btn btn-ghost btn-full" style="margin-bottom:6px" onclick="closeSheet();openPrendaDetail('${window.esc(prenda.id)}')">${window.esc(prenda.id)} · ${window.esc(prenda.descripcion)} <span class="badge ${prendaEstadoBadge(prenda.estado)}" style="margin-left:5px">${window.esc(prenda.estado)}</span></button>`).join('')
    : '<div class="form-help" style="margin-bottom:8px">Sin garantías vinculadas.</div>'}
    <button class="btn btn-ghost btn-full" onclick="closeSheet();openAgregarGarantiaPrestamo('${window.esc(prestamoId)}')">Agregar garantía</button>`;
}

function datosFormularioPrenda() {
  return {
    clienteId: valor('pda-cliente'),
    prestamoId: valor('pda-prestamo'),
    descripcion: valor('pda-descripcion'),
    categoria: valor('pda-categoria'),
    marca: valor('pda-marca'),
    modelo: valor('pda-modelo'),
    numeroSerie: valor('pda-serie'),
    imei: valor('pda-imei'),
    numeroMotor: valor('pda-motor'),
    numeroChasis: valor('pda-chasis'),
    color: valor('pda-color'),
    estadoFisico: valor('pda-estado-fisico'),
    observaciones: valor('pda-observaciones'),
    valorEstimado: Number(valor('pda-valor') || 0),
    valorMinimo: Number(valor('pda-valor-minimo') || 0),
    fechaIngreso: valor('pda-fecha'),
    deposito: valor('pda-deposito'),
    estante: valor('pda-estante'),
    caja: valor('pda-caja'),
    estado: valor('pda-estado')
  };
}

async function validarPrenda(datos, editId, original) {
  if (!datos.descripcion) throw new Error('Ingresá una descripción');
  if (!datos.clienteId) throw new Error('Seleccioná un cliente');
  if (!datos.prestamoId) throw new Error('Seleccioná un préstamo');
  if (!ESTADOS_PRENDA.includes(datos.estado)) throw new Error('Estado de prenda inválido');
  if (datos.valorEstimado < 0 || datos.valorMinimo < 0) throw new Error('Los valores no pueden ser negativos');

  const [cliente, prestamo] = await Promise.all([
    window.dbGet('clientes', datos.clienteId),
    window.dbGet('prestamos', datos.prestamoId)
  ]);
  if (!cliente || cliente._deleted) throw new Error('El cliente seleccionado no existe');
  if (!prestamo || prestamo._deleted) throw new Error('El préstamo seleccionado no existe');
  if (prestamo.clienteId !== datos.clienteId) throw new Error('El préstamo no pertenece al cliente seleccionado');

  const conservaRelacion = Boolean(editId && original?.prestamoId === datos.prestamoId);
  if (!conservaRelacion && !['Activo', 'Atrasado'].includes(prestamo.estado)) {
    throw new Error('Solo podés vincular préstamos activos o atrasados');
  }
}

export async function savePrenda() {
  const editId = valor('pda-edit-id');
  const operacion = window.iniciarOperacionProtegida?.(
    `prenda:guardar:${editId || 'nueva'}`,
    document.getElementById('pda-save'),
    'Guardando...'
  );
  if (!operacion) return;
  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const original = editId ? await window.dbGet('prendas', editId) : null;
  if (original?.estado === 'Vendida') return window.toast('La garantía vendida está cerrada y no admite modificaciones');
  const datos = datosFormularioPrenda();

  try {
    await validarPrenda(datos, editId, original);
  } catch (error) {
    window.toast('⚠️ ' + error.message);
    return;
  }

  const todos = await window.dbAllIncludeDeleted('prendas');
  const id = editId || window.nextId('PD', todos);
  const prenda = {
    ...(original || {}),
    id,
    ...datos,
    _deleted: false,
    deletedAt: null
  };

  // Al agregar una garantía desde un préstamo, la UX termina cuando IndexedDB
  // y sync_queue quedaron confirmados. Firebase continúa mediante el retry normal.
  await guardarPrendaSincronizada(prenda, {
    esperarPush: !altaForzadaPrestamoId
  });
  await window.logBitacora(
    editId ? 'prenda_editada' : (altaForzadaPrestamoId ? 'garantia_agregada' : 'prenda_creada'),
    altaForzadaPrestamoId
      ? `Garantía agregada al préstamo ${altaForzadaPrestamoId}: ${id} · ${datos.descripcion}`
      : `Prenda ${editId ? 'editada' : 'creada'}: ${id} · ${datos.descripcion}`,
    id
  );
  if (editId && original?.estado !== datos.estado) {
    await window.logBitacora(
      'prenda_estado',
      `Estado de prenda ${id}: ${original?.estado || 'Sin estado'} → ${datos.estado}`,
      id
    );
  }

  window.closeSheet();
  window.toast(editId ? '✅ Prenda actualizada' : `✅ Prenda creada · ${id}`);
  const volverPrestamoId = altaForzadaPrestamoId;
  altaForzadaPrestamoId = '';
  document.getElementById('pda-cliente').disabled = false;
  document.getElementById('pda-prestamo').disabled = false;
  if (volverPrestamoId) await window.openPrestamoDetail(volverPrestamoId, { push: false });
  else if (editId && window.curPage === 'prenda-detail') await openPrendaDetail(id, { push: false });
  else await window.renderPage('prendas');
  } finally {
    operacion.liberar();
  }
}

function numeroNoNegativo(campoId) {
  const texto = valor(campoId);
  const numero = Number(texto || 0);
  if (!Number.isFinite(numero) || numero < 0) throw new Error('Ingresá importes válidos');
  return numero;
}

function resultadoFinancieroPrenda(prenda) {
  const cuotasCobradas = Number(prenda?.ejecucionFinanciera?.montoCuotasCobradas || 0);
  const precioVenta = Number(prenda?.precioVenta || 0);
  const gastosReales = Number(prenda?.gastosReales || 0);
  const capitalPrestado = Number(prenda?.ejecucionFinanciera?.capitalPrestado || 0);
  const ventaNeta = precioVenta - gastosReales;
  const recuperacionReal = cuotasCobradas + ventaNeta;
  const resultadoFinal = recuperacionReal - capitalPrestado;
  return {
    ventaNeta,
    recuperacionReal,
    resultadoFinal,
    gananciaReal: Math.max(resultadoFinal, 0),
    perdidaReal: Math.max(-resultadoFinal, 0)
  };
}

export function agregadosFinancierosInventario(prendas) {
  const porPrestamo = new Map();
  for (const prenda of prendas) {
    const key = prenda.prestamoId || `sin-prestamo:${prenda.id}`;
    if (!porPrestamo.has(key)) porPrestamo.set(key, []);
    porPrestamo.get(key).push(prenda);
  }
  let recuperacionReal = 0;
  let gananciaReal = 0;
  let perdidaReal = 0;
  for (const grupo of porPrestamo.values()) {
    const vendidas = grupo.filter(prenda => prenda.estado === 'Vendida');
    if (!vendidas.length) continue;
    const snapshots = grupo.map(prenda => prenda.ejecucionFinanciera).filter(Boolean);
    const cuotasCobradas = snapshots.reduce((maximo, item) => Math.max(maximo, Number(item.montoCuotasCobradas || 0)), 0);
    const capitalPrestado = snapshots.reduce((maximo, item) => Math.max(maximo, Number(item.capitalPrestado || 0)), 0);
    const ventasNetas = vendidas.reduce((total, prenda) =>
      total + Number(prenda.precioVenta || 0) - Number(prenda.gastosReales || 0), 0);
    const recuperacionPrestamo = cuotasCobradas + ventasNetas;
    const resultadoPrestamo = recuperacionPrestamo - capitalPrestado;
    recuperacionReal += recuperacionPrestamo;
    gananciaReal += Math.max(resultadoPrestamo, 0);
    perdidaReal += Math.max(-resultadoPrestamo, 0);
  }
  return { recuperacionReal, gananciaReal, perdidaReal };
}

function tiempoPrenda(value) {
  if (!value) return 0;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  const tiempo = fecha.getTime();
  return Number.isFinite(tiempo) ? tiempo : 0;
}

function ordenarPrendas(lista, criterio) {
  const ordenadas = [...lista];
  const valor = (prenda, campo) => Number(prenda?.[campo] || 0);
  const prioridadEstado = {
    'En garantía': 1,
    'Ejecutada': 2,
    'En venta': 3,
    'Vendida': 4
  };
  const fechaOperativa = prenda => {
    if (prenda?.estado === 'Vendida') return prenda.fechaVenta || prenda.updatedAt;
    if (prenda?.estado === 'En venta') return prenda.fechaPublicacion || prenda.updatedAt;
    if (prenda?.estado === 'Ejecutada') return prenda.fechaEjecucion || prenda.ejecucionFinanciera?.fechaEjecucion || prenda.updatedAt;
    return prenda?.fechaIngreso || prenda?.createdAt;
  };
  ordenadas.sort((a, b) => {
    if (criterio === 'prioridad') {
      const diferenciaEstado = (prioridadEstado[a.estado] || 99) - (prioridadEstado[b.estado] || 99);
      if (diferenciaEstado) return diferenciaEstado;
      return tiempoPrenda(fechaOperativa(b)) - tiempoPrenda(fechaOperativa(a));
    }
    if (criterio === 'fecha-ejecucion') return tiempoPrenda(b.fechaEjecucion || b.ejecucionFinanciera?.fechaEjecucion) - tiempoPrenda(a.fechaEjecucion || a.ejecucionFinanciera?.fechaEjecucion);
    if (criterio === 'fecha-venta') return tiempoPrenda(b.fechaVenta) - tiempoPrenda(a.fechaVenta);
    if (criterio === 'valor-estimado') return valor(b, 'valorEstimado') - valor(a, 'valorEstimado');
    if (criterio === 'valor-vendido') return valor(b, 'precioVenta') - valor(a, 'precioVenta');
    return tiempoPrenda(b.fechaIngreso || b.createdAt) - tiempoPrenda(a.fechaIngreso || a.createdAt);
  });
  return ordenadas;
}

function historialPrendaHTML(prenda) {
  const eventos = [];
  const agregar = (fecha, texto) => {
    if (fecha) eventos.push({ fecha, texto, tiempo: tiempoPrenda(fecha) });
  };
  agregar(prenda.createdAt || prenda.fechaIngreso, 'Garantía creada.');
  agregar(prenda.fechaEjecucion || prenda.ejecucionFinanciera?.fechaEjecucion, 'Préstamo ejecutado.');
  agregar(prenda.fechaPublicacion, `Publicada para venta${Number(prenda.precioPublicado || 0) > 0 ? ` por ${window.fmtMoney(prenda.precioPublicado)}` : ''}.`);
  const correcciones = Array.isArray(prenda.ventaCorrecciones) ? prenda.ventaCorrecciones : [];
  if (correcciones.length) {
    const original = correcciones[0]?.original || {};
    agregar(original.fechaVenta || original.registradoAt || prenda.fechaVentaOriginal, `Venta original registrada por ${window.fmtMoney(original.precioVenta ?? prenda.precioVentaOriginal ?? 0)}.`);
    correcciones.forEach(correccion => {
      const anterior = correccion?.original || {};
      const nueva = correccion?.corregido || {};
      agregar(correccion.corregidoAt, `Venta corregida: ${window.fmtMoney(anterior.precioVenta || 0)} → ${window.fmtMoney(nueva.precioVenta || 0)} · Gastos: ${window.fmtMoney(nueva.gastosReales || 0)} · Motivo: ${correccion.motivo || 'Sin detalle'}.`);
    });
  } else {
    agregar(prenda.fechaVenta, `Vendida por ${window.fmtMoney(prenda.precioVenta || 0)}.`);
  }
  (Array.isArray(prenda.historial) ? prenda.historial : [])
    .filter(evento => !correcciones.length || !['venta_original_preservada', 'venta_corregida'].includes(evento?.tipo))
    .forEach(evento => agregar(evento.fecha, evento.texto || evento.tipo || 'Evento de garantía.'));
  eventos.sort((a, b) => a.tiempo - b.tiempo);
  return eventos.length
    ? eventos.map(evento => `<div class="card-sm" style="margin-bottom:7px"><div class="li-sub">${window.esc(new Date(evento.tiempo).toLocaleDateString('es-AR'))}</div><div class="li-name" style="font-size:13px">${window.esc(evento.texto)}</div></div>`).join('')
    : '<div class="form-help">Sin eventos registrados.</div>';
}

export async function openPonerPrendaEnVenta(id) {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted || prenda.estado !== 'Ejecutada') {
    return window.toast('Solo una garantía ejecutada puede ponerse en venta');
  }
  document.getElementById('pda-publicar-id').value = id;
  document.getElementById('pda-precio-publicado').value = prenda.precioPublicado || '';
  document.getElementById('pda-gastos-estimados').value = prenda.gastosEstimados || '';
  document.getElementById('pda-publicar-observaciones').value = prenda.observacionesPublicacion || '';
  window.openSheet('sh-prenda-publicar');
}

export async function guardarPrendaEnVenta() {
  const id = valor('pda-publicar-id');
  const operacion = window.iniciarOperacionProtegida?.(
    `prenda:publicar:${id}`,
    document.getElementById('pda-publicar-save'),
    'Publicando...'
  );
  if (!operacion) return;
  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted || prenda.estado !== 'Ejecutada') return window.toast('Garantía no disponible para venta');
    const precioPublicado = numeroNoNegativo('pda-precio-publicado');
    const gastosEstimados = numeroNoNegativo('pda-gastos-estimados');
    await guardarPrendaSincronizada({
      ...prenda,
      estado: 'En venta',
      precioPublicado,
      gastosEstimados,
      observacionesPublicacion: valor('pda-publicar-observaciones'),
      fechaPublicacion: new Date().toISOString()
    });
    await window.logBitacora('prenda_en_venta', `Garantía ${id} puesta en venta por ${window.fmtMoney(precioPublicado)}`, id);
    window.closeSheet();
    window.toast('✅ Garantía puesta en venta');
    await openPrendaDetail(id, { push: false });
  } catch (error) {
    window.toast('⚠️ ' + error.message);
  } finally {
    operacion.liberar();
  }
}

export async function openRegistrarVentaPrenda(id) {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted || !['Ejecutada', 'En venta'].includes(prenda.estado)) {
    return window.toast('La garantía no está disponible para registrar una venta');
  }
  document.getElementById('pda-venta-id').value = id;
  document.getElementById('pda-precio-venta').value = prenda.precioVenta || '';
  document.getElementById('pda-medio-venta').value = prenda.medioVenta || 'Efectivo';
  document.getElementById('pda-gastos-reales').value = prenda.gastosReales || '';
  document.getElementById('pda-medio-gasto').value = prenda.medioGastoVenta || 'Efectivo';
  document.getElementById('pda-fecha-venta').value = prenda.fechaVenta ? String(prenda.fechaVenta).slice(0, 10) : new Date().toISOString().slice(0, 10);
  document.getElementById('pda-comprador').value = prenda.comprador || '';
  document.getElementById('pda-venta-observaciones').value = prenda.observacionesVenta || '';
  await actualizarResumenVentaPrenda(prenda);
  window.openSheet('sh-prenda-venta');
}

export async function actualizarResumenVentaPrenda(prendaRecibida = null) {
  const id = valor('pda-venta-id');
  const prenda = prendaRecibida || (id ? await window.dbGet('prendas', id) : null);
  const precioVenta = Number(valor('pda-precio-venta') || 0);
  const gastosReales = Number(valor('pda-gastos-reales') || 0);
  const precioPublicado = Number(prenda?.precioPublicado || 0);
  const capitalPrestado = Number(prenda?.ejecucionFinanciera?.capitalPrestado || 0);
  const cuotasCobradas = Number(prenda?.ejecucionFinanciera?.montoCuotasCobradas || 0);
  const ventaNeta = precioVenta - gastosReales;
  const resultado = cuotasCobradas + ventaNeta - capitalPrestado;
  const resumen = document.getElementById('pda-venta-resumen');
  if (resumen) resumen.innerHTML = `Precio real: <b>${window.fmtMoney(precioVenta)}</b><br>Gastos: <b>${window.fmtMoney(gastosReales)}</b><br>Neto recibido: <b>${window.fmtMoney(ventaNeta)}</b><br>Resultado estimado: <b>${window.fmtMoney(resultado)}</b>`;
  const advertencias = [];
  if (precioVenta > 0 && gastosReales >= precioVenta) advertencias.push('Los gastos son iguales o superiores al precio de venta. Revisá los importes antes de confirmar.');
  if (precioVenta > 0 && precioPublicado > 0 && (precioVenta < precioPublicado * 0.5 || precioVenta > precioPublicado * 1.5)) {
    advertencias.push(`El precio de venta ingresado difiere considerablemente del precio publicado (${window.fmtMoney(precioPublicado)}).`);
  }
  const alerta = document.getElementById('pda-venta-advertencia');
  if (alerta) {
    alerta.textContent = advertencias.join('\n');
    alerta.style.display = advertencias.length ? '' : 'none';
  }
  return { precioVenta, gastosReales, precioPublicado, ventaNeta, resultado, advertencias };
}

function datosBaseMovimientoVenta(prenda, operationId) {
  return {
    prendaId: prenda.id,
    prestamoId: prenda.prestamoId || null,
    clienteId: prenda.clienteId || null,
    cuentaId: 'GENERAL',
    automatico: true,
    operationId,
    createdByUid: window._fbUser?.uid || null,
    deviceId: window.DEVICE_ID || null
  };
}

function crearMovimientoCorreccionVenta({ prenda, movimientos, correctionId, tipo, direccion, monto, medioPago, sufijo, concepto, reversaDeMovimientoId = null }) {
  const sourceKey = `CORRECCION_VENTA:${prenda.id}:${correctionId}:${sufijo}`;
  return window.cajaService.crearMovimiento({
    ...datosBaseMovimientoVenta(prenda, correctionId),
    id: window.cajaService.generarIdAutomatico(sourceKey), tipo, direccion, monto,
    fecha: new Date().toISOString(), concepto, medioPago,
    eventoTipo: 'CORRECCION_VENTA', eventoId: correctionId, sourceKey,
    reversaDeMovimientoId,
    movimientosExistentes: movimientos
  });
}

export async function guardarVentaPrenda() {
  const id = valor('pda-venta-id');
  const operacion = window.iniciarOperacionProtegida?.(
    `prenda:vender:${id}`,
    document.getElementById('pda-venta-save'),
    'Registrando...'
  );
  if (!operacion) return;
  try {
  // Ceder un turno al navegador para que pinte disabled + "Registrando..."
  // antes de iniciar las lecturas y escrituras asincronas de la venta.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted || !['Ejecutada', 'En venta'].includes(prenda.estado)) return window.toast('Garantía no disponible para venta');
    const movimientosCaja = await window.dbAll('movimientos_caja');
    if (!window.cajaService.esCajaIniciada(movimientosCaja)) {
      window.closeSheet();
      const irACaja = window.confirm('Primero iniciá Caja / Tesorería para registrar correctamente el dinero recibido por la venta.\n\n¿Ir a Caja?');
      if (irACaja) await window.goPage('caja');
      return;
    }
    const precioVenta = Number(valor('pda-precio-venta'));
    const gastosReales = numeroNoNegativo('pda-gastos-reales');
    const fechaVenta = valor('pda-fecha-venta');
    const medioVenta = valor('pda-medio-venta');
    const medioGastoVenta = valor('pda-medio-gasto');
    if (!Number.isFinite(precioVenta) || precioVenta <= 0) throw new Error('Ingresá el precio real de venta');
    if (!fechaVenta) throw new Error('Ingresá la fecha de venta');
    if (!MEDIOS_VENTA.has(medioVenta)) throw new Error('Seleccioná un medio de cobro válido');
    if (gastosReales > 0 && !MEDIOS_VENTA.has(medioGastoVenta)) throw new Error('Seleccioná un medio válido para el gasto');
    const evaluacion = await actualizarResumenVentaPrenda(prenda);
    const resumenConfirmacion = `Precio real: ${window.fmtMoney(precioVenta)}\nGastos: ${window.fmtMoney(gastosReales)}\nNeto recibido: ${window.fmtMoney(precioVenta - gastosReales)}\nResultado estimado: ${window.fmtMoney(evaluacion.resultado)}`;
    if (!window.confirm(`Confirmá los datos de la venta:\n\n${resumenConfirmacion}`)) return;
    if (evaluacion.advertencias.length && !window.confirm(`${evaluacion.advertencias.join('\n\n')}\n\n¿Confirmar igualmente?`)) return;
    const venta = {
      ...prenda,
      estado: 'Vendida',
      precioVenta,
      gastosReales,
      fechaVenta,
      medioVenta,
      medioGastoVenta: gastosReales > 0 ? medioGastoVenta : null,
      ventaRegistradaPorUid: window._fbUser?.uid || prenda.ventaRegistradaPorUid || null,
      ventaRegistradaAt: new Date().toISOString(),
      comprador: valor('pda-comprador'),
      observacionesVenta: valor('pda-venta-observaciones')
    };
    Object.assign(venta, resultadoFinancieroPrenda(venta));
    const operationId = globalThis.crypto?.randomUUID?.() || `venta_prenda_${id}_${Date.now()}`;
    const descripcion = String(prenda.descripcion || prenda.id);
    const sourceVenta = `VENTA_PRENDA:${id}`;
    const movimientoVenta = window.cajaService.crearMovimiento({
      id: window.cajaService.generarIdAutomatico(sourceVenta),
      tipo: 'VENTA_PRENDA',
      direccion: 'ingreso',
      monto: precioVenta,
      fecha: fechaVenta,
      concepto: `Venta prenda ${descripcion}${prenda.prestamoId ? ` · ${prenda.prestamoId}` : ''}`,
      medioPago: medioVenta,
      cuentaId: 'GENERAL',
      eventoTipo: 'VENTA_PRENDA',
      eventoId: id,
      prendaId: id,
      prestamoId: prenda.prestamoId || null,
      clienteId: prenda.clienteId || null,
      automatico: true,
      sourceKey: sourceVenta,
      operationId,
      createdByUid: window._fbUser?.uid || null,
      deviceId: window.DEVICE_ID || null,
      movimientosExistentes: movimientosCaja
    });
    let movimientoGasto = null;
    if (gastosReales > 0) {
      const sourceGasto = `GASTO_VENTA_PRENDA:${id}`;
      movimientoGasto = window.cajaService.crearMovimiento({
        id: window.cajaService.generarIdAutomatico(sourceGasto),
        tipo: 'GASTO_VENTA_PRENDA',
        direccion: 'egreso',
        monto: gastosReales,
        fecha: fechaVenta,
        concepto: `Gasto venta prenda ${descripcion}`,
        medioPago: medioGastoVenta,
        cuentaId: 'GENERAL',
        eventoTipo: 'GASTO_VENTA_PRENDA',
        eventoId: id,
        prendaId: id,
        prestamoId: prenda.prestamoId || null,
        clienteId: prenda.clienteId || null,
        automatico: true,
        sourceKey: sourceGasto,
        operationId,
        createdByUid: window._fbUser?.uid || null,
        deviceId: window.DEVICE_ID || null,
        movimientosExistentes: movimientosCaja
      });
    }
    await window.dbCommitOperacionPrestamoCajaAtomic([
      { store: 'prendas', data: venta },
      { store: 'movimientos_caja', data: movimientoVenta },
      ...(movimientoGasto ? [{ store: 'movimientos_caja', data: movimientoGasto }] : [])
    ]);
    window.closeSheet();
    window.toast('✅ Venta registrada');
    await openPrendaDetail(id, { push: false });
    void Promise.resolve(window.logBitacora('prenda_vendida', `Garantía ${id} vendida por ${window.fmtMoney(precioVenta)} · resultado ${window.fmtMoney(venta.resultadoFinal)}`, id)).catch(() => null);
    void Promise.resolve(window.logBitacora('caja_venta_prenda', `Ingreso de venta en Caja: ${id} · ${window.fmtMoney(precioVenta)} · ${medioVenta}`, id)).catch(() => null);
    if (movimientoGasto) void Promise.resolve(window.logBitacora('caja_gasto_venta_prenda', `Gasto de venta en Caja: ${id} · ${window.fmtMoney(gastosReales)} · ${medioGastoVenta}`, id)).catch(() => null);
    void Promise.resolve(window.pushInmediato()).catch(error => {
      console.warn('[PRENDAS SYNC] Venta confirmada localmente; publicación remota pendiente', { id, error });
    });
  } catch (error) {
    window.toast('⚠️ ' + error.message);
  } finally {
    operacion.liberar();
  }
}

export async function openCorregirVentaPrenda(id) {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted || prenda.estado !== 'Vendida') return window.toast('Solo puede corregirse una garantía vendida');
  document.getElementById('pda-correccion-id').value = id;
  document.getElementById('pda-correccion-operation-id').value = globalThis.crypto?.randomUUID?.() || `correccion_${id}_${Date.now()}`;
  document.getElementById('pda-correccion-precio').value = prenda.precioVenta || '';
  document.getElementById('pda-correccion-medio-venta').value = prenda.medioVenta || 'Efectivo';
  document.getElementById('pda-correccion-gastos').value = prenda.gastosReales || '';
  document.getElementById('pda-correccion-medio-gasto').value = prenda.medioGastoVenta || 'Efectivo';
  document.getElementById('pda-correccion-motivo').value = '';
  document.getElementById('pda-correccion-password').value = '';
  window.openSheet('sh-prenda-corregir-venta');
}

export async function guardarCorreccionVentaPrenda() {
  const id = valor('pda-correccion-id');
  const correctionId = valor('pda-correccion-operation-id');
  const operacion = window.iniciarOperacionProtegida?.(`prenda:corregir-venta:${id}:${correctionId}`, document.getElementById('pda-correccion-save'), 'Corrigiendo...');
  if (!operacion) return;
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (await window.bloquearEscrituraPorRestorePending?.()) return;
    const prenda = await window.dbGet('prendas', id);
    if (!prenda || prenda._deleted || prenda.estado !== 'Vendida') throw new Error('La venta ya no está disponible para corrección');
    if (!correctionId) throw new Error('La operación de corrección venció');
    if ((Array.isArray(prenda.ventaCorrecciones) ? prenda.ventaCorrecciones : []).some(item => item?.correctionId === correctionId)) {
      window.closeSheet();
      await openPrendaDetail(id, { push: false });
      return window.toast('La corrección ya había sido registrada');
    }
    const precioVenta = Number(valor('pda-correccion-precio'));
    const gastosReales = numeroNoNegativo('pda-correccion-gastos');
    const medioVenta = valor('pda-correccion-medio-venta');
    const medioGastoVenta = valor('pda-correccion-medio-gasto');
    const motivo = valor('pda-correccion-motivo');
    const password = document.getElementById('pda-correccion-password')?.value || '';
    if (!Number.isFinite(precioVenta) || precioVenta <= 0) throw new Error('Ingresá el nuevo precio real de venta');
    if (!MEDIOS_VENTA.has(medioVenta)) throw new Error('Seleccioná un medio de cobro válido');
    if (gastosReales > 0 && !MEDIOS_VENTA.has(medioGastoVenta)) throw new Error('Seleccioná un medio válido para el gasto');
    if (!motivo) throw new Error('Ingresá el motivo de la corrección');
    if (!password) throw new Error('Ingresá tu contraseña para confirmar');
    const movimientos = await window.dbAll('movimientos_caja');
    if (!window.cajaService.esCajaIniciada(movimientos)) throw new Error('Caja / Tesorería no está inicializada');
    const correccionesPrevias = Array.isArray(prenda.ventaCorrecciones) ? prenda.ventaCorrecciones : [];
    const ultimaCorreccionId = correccionesPrevias.at(-1)?.correctionId || null;
    const movimientoVentaVigente = ultimaCorreccionId
      ? movimientos.find(item => item._deleted !== true && item.sourceKey === `CORRECCION_VENTA:${id}:${ultimaCorreccionId}:NUEVO_INGRESO`)
      : movimientos.find(item => item._deleted !== true && item.sourceKey === `VENTA_PRENDA:${id}`);
    const movimientoGastoVigente = ultimaCorreccionId
      ? movimientos.find(item => item._deleted !== true && item.sourceKey === `CORRECCION_VENTA:${id}:${ultimaCorreccionId}:NUEVO_GASTO`)
      : movimientos.find(item => item._deleted !== true && item.sourceKey === `GASTO_VENTA_PRENDA:${id}`);
    // Última barrera antes de cualquier escritura: Firebase Auth sigue siendo
    // la única fuente de identidad válida para esta operación sensible.
    const autorizacion = await window.reautenticarOperacionSensible(password);
    const fechaCorreccion = new Date().toISOString();
    const snapshot = {
      correctionId, corregidoAt: fechaCorreccion,
      corregidoPorUid: autorizacion.uid, reautenticadoAt: autorizacion.authenticatedAt, motivo,
      original: {
        precioVenta: Number(prenda.precioVenta || 0), gastosReales: Number(prenda.gastosReales || 0),
        fechaVenta: prenda.fechaVenta || null, medioVenta: prenda.medioVenta || null,
        medioGastoVenta: prenda.medioGastoVenta || null,
        registradoAt: prenda.ventaRegistradaAt || prenda.updatedAt || null,
        registradoPorUid: prenda.ventaRegistradaPorUid || null
      },
      corregido: { precioVenta, gastosReales, medioVenta, medioGastoVenta: gastosReales > 0 ? medioGastoVenta : null }
    };
    const historial = [...(Array.isArray(prenda.historial) ? prenda.historial : [])];
    historial.push({ fecha: prenda.fechaVenta || prenda.ventaRegistradaAt || prenda.updatedAt, tipo: 'venta_original_preservada', texto: `Vendida por ${window.fmtMoney(prenda.precioVenta || 0)}.` });
    historial.push({ fecha: fechaCorreccion, tipo: 'venta_corregida', correctionId, texto: `Venta corregida: precio ${window.fmtMoney(precioVenta)} · motivo: ${motivo}` });
    const corregida = {
      ...prenda,
      precioVentaOriginal: prenda.precioVentaOriginal ?? Number(prenda.precioVenta || 0),
      gastosOriginales: prenda.gastosOriginales ?? Number(prenda.gastosReales || 0),
      fechaVentaOriginal: prenda.fechaVentaOriginal || prenda.fechaVenta || null,
      medioVentaOriginal: prenda.medioVentaOriginal || prenda.medioVenta || null,
      medioGastoVentaOriginal: prenda.medioGastoVentaOriginal || prenda.medioGastoVenta || null,
      ventaRegistradaPorUidOriginal: prenda.ventaRegistradaPorUidOriginal || prenda.ventaRegistradaPorUid || null,
      precioVenta, gastosReales, medioVenta,
      medioGastoVenta: gastosReales > 0 ? medioGastoVenta : null,
      ventaCorrecciones: [...(Array.isArray(prenda.ventaCorrecciones) ? prenda.ventaCorrecciones : []), snapshot],
      historial
    };
    Object.assign(corregida, resultadoFinancieroPrenda(corregida));
    const items = [{ store: 'prendas', data: corregida }];
    const agregarMovimiento = datos => items.push({ store: 'movimientos_caja', data: crearMovimientoCorreccionVenta({ prenda, movimientos, correctionId, ...datos }) });
    if (movimientoVentaVigente) agregarMovimiento({ tipo: 'REVERSA_CORRECCION_VENTA', direccion: 'egreso', monto: Number(movimientoVentaVigente.monto), medioPago: movimientoVentaVigente.medioPago, sufijo: 'REVERSA_INGRESO', concepto: `Reversa por corrección de venta ${id}`, reversaDeMovimientoId: movimientoVentaVigente.id });
    if (movimientoGastoVigente) agregarMovimiento({ tipo: 'REVERSA_CORRECCION_GASTO', direccion: 'ingreso', monto: Number(movimientoGastoVigente.monto), medioPago: movimientoGastoVigente.medioPago, sufijo: 'REVERSA_GASTO', concepto: `Reversa por corrección de gasto ${id}`, reversaDeMovimientoId: movimientoGastoVigente.id });
    agregarMovimiento({ tipo: 'VENTA_PRENDA_CORREGIDA', direccion: 'ingreso', monto: precioVenta, medioPago: medioVenta, sufijo: 'NUEVO_INGRESO', concepto: `Venta corregida de prenda ${id}` });
    if (gastosReales > 0) agregarMovimiento({ tipo: 'GASTO_VENTA_PRENDA_CORREGIDO', direccion: 'egreso', monto: gastosReales, medioPago: medioGastoVenta, sufijo: 'NUEVO_GASTO', concepto: `Gasto corregido de venta ${id}` });
    await window.dbCommitOperacionPrestamoCajaAtomic(items);
    window.closeSheet();
    window.toast('✅ Venta corregida con trazabilidad');
    await openPrendaDetail(id, { push: false });
    void Promise.resolve(window.logBitacora('prenda_venta_corregida', `Venta ${id} corregida · ${motivo}`, id)).catch(() => null);
    void Promise.resolve(window.pushInmediato()).catch(error => console.warn('[PRENDAS SYNC] Corrección local pendiente de publicación', { id, correctionId, error }));
  } catch (error) {
    window.toast('⚠️ ' + error.message);
  } finally {
    operacion.liberar();
  }
}

export async function renderPrendas() {
  const el = document.getElementById('pg-prendas');
  if (!el) return;
  const textoPrevio = document.getElementById('pda-filtro-texto')?.value || '';
  const estadoPrevio = document.getElementById('pda-filtro-estado')?.value || '';
  const clientePrevio = document.getElementById('pda-filtro-cliente')?.value || '';
  const ordenPrevio = document.getElementById('pda-orden')?.value || 'prioridad';
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';

  const { prendas, clientes, clientesMap, prestamosMap } = await contextoPrendas();
  const texto = textoPrevio.trim().toLowerCase();
  const filtradas = ordenarPrendas(prendas.filter(prenda => {
    const cliente = clientesMap.get(prenda.clienteId);
    const bolsa = [prenda.id, prenda.descripcion, prenda.categoria, prenda.marca, prenda.modelo, prenda.numeroSerie, prenda.imei, cliente?.nombre, prenda.prestamoId]
      .join(' ').toLowerCase();
    return (!texto || bolsa.includes(texto)) &&
      (!estadoPrevio || prenda.estado === estadoPrevio) &&
      (!clientePrevio || prenda.clienteId === clientePrevio);
  }), ordenPrevio);

  const enGarantia = prendas.filter(prenda => prenda.estado === 'En garantía');
  const ejecutadas = prendas.filter(prenda => prenda.estado === 'Ejecutada');
  const enVenta = prendas.filter(prenda => prenda.estado === 'En venta');
  const vendidas = prendas.filter(prenda => prenda.estado === 'Vendida');
  const valorEstimado = prendas.reduce((total, prenda) => total + Number(prenda.valorEstimado || 0), 0);
  const valorPublicado = prendas.reduce((total, prenda) => total + Number(prenda.precioPublicado || 0), 0);
  const valorVendido = vendidas.reduce((total, prenda) => total + Number(prenda.precioVenta || 0), 0);
  const { recuperacionReal, gananciaReal, perdidaReal } = agregadosFinancierosInventario(prendas);
  const grupos = new Map();
  for (const prenda of filtradas) {
    const key = prenda.prestamoId || '__sin_prestamo__';
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(prenda);
  }

  const tarjetaPrendaHTML = prenda => {
    const cliente = clientesMap.get(prenda.clienteId);
    return `<div class="li op-card" style="margin-bottom:8px">
      <div class="li-row">
        <div style="min-width:0">
          <div class="li-name">${window.esc(prenda.id)} · ${window.esc(prenda.descripcion)}</div>
          <div class="li-sub">${window.esc(cliente?.nombre || prenda.clienteId || 'Cliente no disponible')}</div>
          <div class="li-sub">📍 ${window.esc(ubicacionPrenda(prenda))}</div>
        </div>
        <div style="text-align:right">
          <div class="li-amt">${window.fmtMoney(prenda.valorEstimado || 0)}</div>
          <span class="badge ${prendaEstadoBadge(prenda.estado)}">${window.esc(prenda.estado)}</span>
        </div>
      </div>
      <div class="op-actions">
        <button class="btn btn-ghost btn-sm" onclick="openPrendaDetail('${window.esc(prenda.id)}')">Ver</button>
        ${prenda.estado !== 'Vendida' ? `<button class="btn btn-gold btn-sm" onclick="openSheetPrenda('${window.esc(prenda.id)}')">Editar</button>
        <button class="btn btn-red btn-sm" onclick="borrarPrenda('${window.esc(prenda.id)}')">Eliminar</button>` : ''}
      </div>
    </div>`;
  };

  const gruposHTML = [...grupos.entries()].map(([key, prendasGrupo]) => {
    const sinPrestamo = key === '__sin_prestamo__';
    const prestamo = sinPrestamo ? null : prestamosMap.get(key);
    const cliente = clientesMap.get(prendasGrupo[0]?.clienteId || prestamo?.clienteId);
    const totalGrupo = prendasGrupo.reduce(
      (total, prenda) => total + Number(prenda.valorEstimado || 0),
      0
    );
    return `<section class="card" style="padding:12px;margin-bottom:12px">
      <div class="li-row" style="align-items:flex-start;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div class="li-name">${sinPrestamo ? 'Sin préstamo asociado' : window.esc(prestamo?.id || key)}${cliente?.nombre ? ` · ${window.esc(cliente.nombre)}` : ''}</div>
          <div class="li-sub">${prendasGrupo.length} garantía${prendasGrupo.length === 1 ? '' : 's'} · Valor estimado total ${window.fmtMoney(totalGrupo)}</div>
        </div>
      </div>
      ${prendasGrupo.map(tarjetaPrendaHTML).join('')}
    </section>`;
  }).join('');

  el.innerHTML = `<div class="fadeIn">
    <button class="btn btn-gold btn-full" style="margin-bottom:12px" onclick="openSheetPrenda()">＋ Nueva prenda</button>
    <div class="card" style="padding:12px;margin-bottom:12px">
      <div class="form-section-title" style="margin-bottom:10px">Inventario de garantías</div>
      <div class="info-grid">
        <div class="info-cell"><div class="info-lbl">En garantía</div><div class="info-val">${enGarantia.length}</div></div>
        <div class="info-cell"><div class="info-lbl">Ejecutadas</div><div class="info-val">${ejecutadas.length}</div></div>
        <div class="info-cell"><div class="info-lbl">En venta</div><div class="info-val">${enVenta.length}</div></div>
        <div class="info-cell"><div class="info-lbl">Vendidas</div><div class="info-val">${vendidas.length}</div></div>
        <div class="info-cell"><div class="info-lbl">Valor estimado</div><div class="info-val">${window.fmtMoney(valorEstimado)}</div></div>
        <div class="info-cell"><div class="info-lbl">Valor publicado</div><div class="info-val">${window.fmtMoney(valorPublicado)}</div></div>
        <div class="info-cell"><div class="info-lbl">Valor vendido</div><div class="info-val">${window.fmtMoney(valorVendido)}</div></div>
        <div class="info-cell"><div class="info-lbl">Recuperación real</div><div class="info-val">${window.fmtMoney(recuperacionReal)}</div></div>
        <div class="info-cell"><div class="info-lbl">Ganancia acumulada</div><div class="info-val" style="color:var(--grn)">${window.fmtMoney(gananciaReal)}</div></div>
        <div class="info-cell"><div class="info-lbl">Pérdida acumulada</div><div class="info-val" style="color:var(--red)">${window.fmtMoney(perdidaReal)}</div></div>
      </div>
    </div>
    <div class="card" style="padding:12px;margin-bottom:12px">
      <div class="field"><input class="inp" id="pda-filtro-texto" placeholder="Buscar por ID, descripción, cliente, serie o IMEI" value="${window.esc(textoPrevio)}" oninput="renderPrendas()"></div>
      <div class="form-grid form-grid-3">
        <select class="inp" id="pda-filtro-estado" onchange="renderPrendas()">
          <option value="">Todas</option>
          <option value="En garantía"${estadoPrevio === 'En garantía' ? ' selected' : ''}>En garantía</option>
          <option value="Ejecutada"${estadoPrevio === 'Ejecutada' ? ' selected' : ''}>Ejecutadas</option>
          <option value="En venta"${estadoPrevio === 'En venta' ? ' selected' : ''}>En venta</option>
          <option value="Vendida"${estadoPrevio === 'Vendida' ? ' selected' : ''}>Vendidas</option>
        </select>
        <select class="inp" id="pda-filtro-cliente" onchange="renderPrendas()">
          <option value="">Todos los clientes</option>
          ${clientes.map(cliente => `<option value="${window.esc(cliente.id)}"${cliente.id === clientePrevio ? ' selected' : ''}>${window.esc(cliente.nombre)}</option>`).join('')}
        </select>
        <select class="inp" id="pda-orden" onchange="renderPrendas()">
          <option value="prioridad"${ordenPrevio === 'prioridad' ? ' selected' : ''}>Prioridad operativa</option>
          <option value="fecha-ingreso"${ordenPrevio === 'fecha-ingreso' ? ' selected' : ''}>Fecha ingreso</option>
          <option value="fecha-ejecucion"${ordenPrevio === 'fecha-ejecucion' ? ' selected' : ''}>Fecha ejecución</option>
          <option value="fecha-venta"${ordenPrevio === 'fecha-venta' ? ' selected' : ''}>Fecha venta</option>
          <option value="valor-estimado"${ordenPrevio === 'valor-estimado' ? ' selected' : ''}>Valor estimado</option>
          <option value="valor-vendido"${ordenPrevio === 'valor-vendido' ? ' selected' : ''}>Valor vendido</option>
        </select>
      </div>
    </div>
    <div class="sec-hdr"><div class="sec-title">Prendas (${filtradas.length})</div></div>
    ${filtradas.length ? gruposHTML : window.emptyHTML('🏷️', 'Sin prendas', 'Creá la primera prenda vinculada a un préstamo.')}
  </div>`;
}

export async function openPrendaDetail(id, opciones = {}) {
  const el = document.getElementById('pg-prenda-detail');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  window.goDetail('prenda-detail', {
    id,
    push: opciones.push !== false,
    history: opciones.history !== false
  });
  document.getElementById('hdr-title').textContent = '🏷️ Detalle Prenda';

  const [prenda, clientes, prestamos, cuotas] = await Promise.all([
    window.dbGet('prendas', id),
    window.dbAll('clientes'),
    window.dbAll('prestamos'),
    window.dbAll('cuotas')
  ]);
  if (!prenda || prenda._deleted) {
    window.toast('Prenda no encontrada');
    await window.goBack();
    return;
  }
  const cliente = clientes.find(item => item.id === prenda.clienteId);
  const prestamo = prestamos.find(item => normalizarRelacion(item.id) === normalizarRelacion(prenda.prestamoId));
  const cuotasPrestamo = cuotas.filter(cuota => cuota.prestamoId === prenda.prestamoId && cuota._deleted !== true);
  const cuotasPagadas = cuotasPrestamo.filter(cuota => cuota.estado === 'Pagado');
  const montoCuotasCobradas = cuotasPagadas.reduce((total, cuota) => total + (
    cuota.origenPago === 'renovacion_descuento'
      ? Number(cuota.montoEfectivo || 0)
      : (cuota.montoEfectivo != null ? Number(cuota.montoEfectivo || 0) : Number(cuota.monto || 0))
  ), 0);
  const totalPrestamo = Number(prestamo?.total || 0);
  const capitalPrestadoActual = Number(prestamo?.monto || 0);
  const capitalRecuperadoActual = totalPrestamo > 0 ? montoCuotasCobradas * capitalPrestadoActual / totalPrestamo : 0;
  const dato = (titulo, contenido) => contenido ? `<div class="info-cell"><div class="info-lbl">${titulo}</div><div class="info-val">${window.esc(contenido)}</div></div>` : '';
  const ejecucion = prenda.ejecucionFinanciera || {
    capitalPrestado: capitalPrestadoActual,
    totalCuotas: cuotasPrestamo.length,
    cuotasPagadas: cuotasPagadas.length,
    montoCuotasCobradas,
    capitalRecuperado: capitalRecuperadoActual,
    interesCobrado: montoCuotasCobradas - capitalRecuperadoActual,
    saldoPendiente: Math.max(totalPrestamo - montoCuotasCobradas, 0),
    fechaEjecucion: prenda.fechaEjecucion || ''
  };
  const resultado = resultadoFinancieroPrenda(prenda);
  const ejecutarPrestamoAccion = normalizarRelacion(prenda.estado) === 'en garantía' && prestamo && ['activo', 'atrasado'].includes(normalizarRelacion(prestamo.estado))
    ? `<button class="btn btn-red btn-full" style="margin-bottom:10px" onclick="confirmarEjecutarPrestamo('${window.esc(prestamo.id)}','${window.esc(prenda.id)}')">Ejecutar préstamo asociado</button>`
    : '';
  const accionesOperativas = ejecutarPrestamoAccion + (prenda.estado === 'Ejecutada'
    ? `<button class="btn btn-gold btn-full" style="margin-bottom:10px" onclick="openPonerPrendaEnVenta('${window.esc(id)}')">Poner en venta</button>
       <button class="btn btn-ghost btn-full" style="margin-bottom:10px" onclick="openRegistrarVentaPrenda('${window.esc(id)}')">Registrar venta</button>`
    : prenda.estado === 'En venta'
      ? `<button class="btn btn-gold btn-full" style="margin-bottom:10px" onclick="openRegistrarVentaPrenda('${window.esc(id)}')">Registrar venta</button>`
      : prenda.estado === 'Vendida'
        ? `<button class="btn btn-ghost btn-full" style="margin-bottom:10px" onclick="openCorregirVentaPrenda('${window.esc(id)}')">Corregir venta</button>`
        : '');

  el.innerHTML = `<div class="fadeIn">
    <div class="card">
      <div class="li-row"><div><div style="font-size:18px;font-weight:900">${window.esc(prenda.descripcion)}</div><div class="li-sub">${window.esc(prenda.id)}</div></div><span class="badge ${prendaEstadoBadge(prenda.estado)}">${window.esc(prenda.estado)}</span></div>
    </div>
    <div class="info-grid">
      ${dato('Cliente', cliente?.nombre || prenda.clienteId)}
      ${dato('Préstamo', prestamo?.id || prenda.prestamoId)}
      ${dato('Categoría', prenda.categoria)}${dato('Marca', prenda.marca)}${dato('Modelo', prenda.modelo)}${dato('Número de serie', prenda.numeroSerie)}
      ${dato('IMEI', prenda.imei)}${dato('Número de motor', prenda.numeroMotor)}${dato('Número de chasis', prenda.numeroChasis)}${dato('Color', prenda.color)}
      ${dato('Estado físico', prenda.estadoFisico)}${dato('Fecha de ingreso', prenda.fechaIngreso)}${dato('Ubicación', ubicacionPrenda(prenda))}
      <div class="info-cell"><div class="info-lbl">Valor estimado</div><div class="info-val" style="color:var(--gold)">${window.fmtMoney(prenda.valorEstimado || 0)}</div></div>
      <div class="info-cell"><div class="info-lbl">Valor mínimo</div><div class="info-val">${window.fmtMoney(prenda.valorMinimo || 0)}</div></div>
      ${prenda.observaciones ? `<div class="info-cell" style="grid-column:1/-1"><div class="info-lbl">Observaciones</div><div class="info-val">${window.esc(prenda.observaciones)}</div></div>` : ''}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="form-section-title" style="margin-bottom:10px">Resumen financiero histórico</div>
      <div class="info-grid">
        <div class="info-cell"><div class="info-lbl">Capital prestado</div><div class="info-val">${window.fmtMoney(ejecucion.capitalPrestado || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Total cuotas</div><div class="info-val">${Number(ejecucion.totalCuotas ?? cuotasPrestamo.length)}</div></div>
        <div class="info-cell"><div class="info-lbl">Cuotas pagadas</div><div class="info-val">${Number(ejecucion.cuotasPagadas || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Capital recuperado</div><div class="info-val">${window.fmtMoney(ejecucion.capitalRecuperado || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Interés cobrado</div><div class="info-val">${window.fmtMoney(ejecucion.interesCobrado || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Saldo pendiente</div><div class="info-val">${window.fmtMoney(ejecucion.saldoPendiente || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Fecha de ejecución</div><div class="info-val">${window.esc(String(ejecucion.fechaEjecucion || '—').slice(0,10))}</div></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="form-section-title" style="margin-bottom:10px">Venta</div>
      <div class="info-grid">
        <div class="info-cell"><div class="info-lbl">Fecha publicación</div><div class="info-val">${window.esc(String(prenda.fechaPublicacion || '—').slice(0,10))}</div></div>
        <div class="info-cell"><div class="info-lbl">Precio publicado</div><div class="info-val">${window.fmtMoney(prenda.precioPublicado || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Gastos estimados</div><div class="info-val">${window.fmtMoney(prenda.gastosEstimados || 0)}</div></div>
        ${prenda.estado === 'Vendida' ? `<div class="info-cell"><div class="info-lbl">Fecha venta</div><div class="info-val">${window.esc(String(prenda.fechaVenta || '—').slice(0,10))}</div></div>
        <div class="info-cell"><div class="info-lbl">Precio vendido</div><div class="info-val">${window.fmtMoney(prenda.precioVenta || 0)}</div></div>
        <div class="info-cell"><div class="info-lbl">Medio de cobro</div><div class="info-val">${window.esc(prenda.medioVenta || '—')}</div></div>
        <div class="info-cell"><div class="info-lbl">Gastos</div><div class="info-val">${window.fmtMoney(prenda.gastosReales || 0)}</div></div>
        ${Number(prenda.gastosReales || 0) > 0 ? `<div class="info-cell"><div class="info-lbl">Medio del gasto</div><div class="info-val">${window.esc(prenda.medioGastoVenta || '—')}</div></div>` : ''}
        <div class="info-cell"><div class="info-lbl">Venta neta</div><div class="info-val">${window.fmtMoney(resultado.ventaNeta)}</div></div>
        <div class="info-cell"><div class="info-lbl">Recuperación real</div><div class="info-val">${window.fmtMoney(resultado.recuperacionReal)}</div></div>
        <div class="info-cell" style="grid-column:1/-1"><div class="info-lbl">Ganancia / Pérdida</div><div class="info-val" style="color:${resultado.resultadoFinal >= 0 ? 'var(--grn)' : 'var(--red)'}">${window.fmtMoney(resultado.resultadoFinal)}</div></div>` : ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="form-section-title" style="margin-bottom:10px">Historial cronológico</div>
      ${historialPrendaHTML(prenda)}
    </div>
    ${accionesOperativas}
    <div class="form-actions" style="margin-bottom:10px">
      <button class="btn btn-ghost" onclick="openClienteDetail('${window.esc(prenda.clienteId)}')">Abrir cliente</button>
      <button class="btn btn-ghost" onclick="openPrestamoDetail('${window.esc(prenda.prestamoId)}')">Abrir préstamo</button>
    </div>
    ${prenda.estado !== 'Vendida' ? `<button class="btn btn-gold btn-full" style="margin-bottom:10px" onclick="openSheetPrenda('${window.esc(id)}')">Editar prenda</button>
    <button class="btn btn-red btn-full" onclick="borrarPrenda('${window.esc(id)}')">Eliminar prenda</button>` : '<div class="form-alert is-info">Venta cerrada: la garantía quedó bloqueada para modificaciones operativas.</div>'}
  </div>`;
}

export async function cambiarEstadoPrenda(id, nuevoEstado) {
  if (await window.bloquearEscrituraPorRestorePending?.()) {
    await openPrendaDetail(id, { push: false });
    return;
  }
  if (!ESTADOS_PRENDA.includes(nuevoEstado)) {
    window.toast('Estado de prenda inválido');
    return;
  }
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted || prenda.estado === nuevoEstado) return;
  window.toast('Usá las acciones del ciclo de vida para cambiar el estado de la garantía');
  await openPrendaDetail(id, { push: false });
}

export async function borrarPrenda(id) {
  const operacion = window.iniciarOperacionProtegida?.(
    `prenda:eliminar:${id}`,
    document.activeElement,
    'Eliminando...'
  );
  if (!operacion) return;
  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const prenda = await window.dbGet('prendas', id);
  if (!prenda || prenda._deleted) return;
  if (prenda.estado === 'Vendida') return window.toast('La garantía vendida está cerrada y no puede eliminarse');
  const prestamo = await window.dbGet('prestamos', prenda.prestamoId);
  if (prestamo && prestamo._deleted !== true && ['Activo', 'Atrasado'].includes(prestamo.estado)) {
    const mensaje = `Esta prenda está vinculada al préstamo ${prestamo.id} y no puede eliminarse mientras el préstamo esté activo.`;
    await window.logBitacora('prenda_eliminacion_bloqueada', `Intento de eliminar ${id}: vinculada al préstamo ${prestamo.id} (${prestamo.estado})`, id);
    window.toast(mensaje);
    window.alert(mensaje);
    return;
  }
  if (!confirm(`¿Eliminar la prenda ${id}?\n\nSe aplicará un borrado lógico.`)) return;
  await eliminarPrendaSincronizada(id);
  await window.logBitacora('prenda_eliminada', `Prenda eliminada: ${id} · ${prenda.descripcion}`, id);
  window.toast('🗑️ Prenda eliminada');
  await window.goPage('prendas');
  } finally {
    operacion.liberar();
  }
}
