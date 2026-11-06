// UI handlers de Clientes. Disparados desde onclick="..." en el HTML.
// Delegan validacion + CRUD a window.clienteService; persistencia local
// y sync queue siguen viviendo en el inline classic (window.dbAll, etc.)
// hasta que los proximos sub-steps migren esas capas.

export function openSheetCliente(editId = null) {
  document.getElementById('cli-edit-id').value = editId || '';
  document.getElementById('sh-cli-title').textContent = editId ? '✏️ Editar Cliente' : '👤 Nuevo Cliente';
  if (!editId) {
    ['cli-nombre','cli-dni','cli-tel','cli-dir','cli-notas'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cli-riesgo').value = '';
    document.getElementById('cli-estado').value = 'Activo';
  }
  prepararOverrideRiesgo(editId);
  window.openSheet('sh-cliente');
}

async function prepararOverrideRiesgo(editId) {
  const selector = document.getElementById('cli-riesgo');
  const motivo = document.getElementById('cli-riesgo-motivo');
  const password = document.getElementById('cli-riesgo-password');
  const cliente = editId ? await window.dbGet('clientes', editId) : null;
  document.getElementById('cli-riesgo-field').style.display = editId ? '' : 'none';
  const valorInicial = cliente?.riesgoOverrideNivel || cliente?.riesgo || '';
  selector.dataset.inicial = valorInicial;
  selector.dataset.legacy = !cliente?.riesgoOverrideNivel && cliente?.riesgo ? 'true' : 'false';
  selector.value = valorInicial;
  motivo.value = cliente?.riesgoOverrideMotivo || '';
  password.value = '';
  const actualizar = () => {
    const cambio = selector.value !== selector.dataset.inicial;
    document.getElementById('cli-riesgo-motivo-wrap').style.display = cambio ? '' : 'none';
    document.getElementById('cli-riesgo-password-wrap').style.display = cambio ? '' : 'none';
  };
  selector.onchange = actualizar;
  actualizar();
  if (editId) {
    const [prestamos, cuotas] = await Promise.all([window.dbAll('prestamos'), window.dbAll('cuotas')]);
    const auto = window.riesgoClienteService.calcular(editId, { prestamos, cuotas });
    const efectivo = window.riesgoClienteService.efectivo(cliente, auto);
    document.getElementById('cli-riesgo-auto').textContent = `Automático: ${auto.nivelAuto}${auto.nivelAuto === 'SIN HISTORIAL' ? '' : ` · ${auto.score}/100`} · Efectivo: ${efectivo.nivel}${efectivo.tipo === 'automatico' ? '' : ' · ajustado manualmente'}`;
  } else {
    document.getElementById('cli-riesgo-auto').textContent = 'Riesgo automático: SIN HISTORIAL. El cliente se creará sin ajuste manual.';
  }
}

export async function editarCliente(id) {
  const c = await window.dbGet('clientes', id);
  if (!c) return;
  document.getElementById('cli-nombre').value = c.nombre || '';
  document.getElementById('cli-dni').value    = c.dni || '';
  document.getElementById('cli-tel').value    = c.telefono || '';
  document.getElementById('cli-dir').value    = c.direccion || '';
  document.getElementById('cli-riesgo').value = c.riesgoOverrideNivel || c.riesgo || '';
  document.getElementById('cli-estado').value = c.estado === 'Bloqueado' ? 'Bloqueado' : 'Activo';
  document.getElementById('cli-notas').value  = c.notas || '';
  openSheetCliente(id);
}

export async function saveCliente() {
  const editId = document.getElementById('cli-edit-id').value;
  const operacion = window.iniciarOperacionProtegida?.(
    `cliente:guardar:${editId || 'nuevo'}`,
    document.activeElement,
    'Guardando...'
  );
  if (!operacion) return;
  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const nombre   = document.getElementById('cli-nombre').value.trim();
  const dni      = document.getElementById('cli-dni').value.trim();
  const telefono = document.getElementById('cli-tel').value.trim();
  const estado   = document.getElementById('cli-estado').value === 'Bloqueado' ? 'Bloqueado' : 'Activo';

  // Validacion delegada al service (nombre obligatorio, DNI formato + duplicado, telefono formato)
  try {
    await window.clienteService.validarDatosCliente({
      id: editId || null, nombre, dni, telefono
    });
  } catch (e) {
    return window.toast('⚠️ ' + e.message);
  }

  const todos = await window.dbAllIncludeDeleted('clientes');
  const id    = editId || window.nextId('CL', todos);

  const orig = editId ? await window.dbGet('clientes', editId) : null;
  const nivelOverride = document.getElementById('cli-riesgo').value;
  const nivelInicial = document.getElementById('cli-riesgo').dataset.inicial || '';
  const cambioRiesgo = nivelOverride !== nivelInicial;
  let autorizacionRiesgo = null;
  if (cambioRiesgo) {
    const motivoOverride = document.getElementById('cli-riesgo-motivo').value.trim();
    const password = document.getElementById('cli-riesgo-password').value;
    if (!motivoOverride) return window.toast('⚠️ Ingresá el motivo del ajuste de riesgo');
    try {
      autorizacionRiesgo = await window.reautenticarOperacionSensible(password);
    } catch (error) {
      return window.toast('⚠️ ' + error.message);
    }
  }

  const cli = {
    ...(orig || {}),
    id,
    nombre,
    dni,
    telefono,
    direccion: document.getElementById('cli-dir').value.trim(),
    notas    : document.getElementById('cli-notas').value.trim(),
    estado,
    _deleted : false,
    deletedAt: null,
    creadoEn : orig?.creadoEn || new Date().toISOString()
  };
  if (cambioRiesgo) {
    const motivoOverride = document.getElementById('cli-riesgo-motivo').value.trim();
    cli.riesgoOverrideNivel = nivelOverride || null;
    cli.riesgoOverrideMotivo = nivelOverride ? motivoOverride : null;
    cli.riesgoOverridePor = nivelOverride ? autorizacionRiesgo.uid : null;
    cli.riesgoOverrideAt = nivelOverride ? autorizacionRiesgo.authenticatedAt : null;
    cli.riesgo = nivelOverride || null;
  }

  await window.dbPut('clientes', cli);
  await window.addToSyncQueueOrThrow('clientes', id, cli, 'upsert');
  await window.logBitacora(
    editId ? 'edicion' : 'nuevo_cliente',
    `Cliente ${editId ? 'editado' : 'creado'}: ${nombre}${cli.dni ? ' · DNI ' + cli.dni : ''}`,
    id
  );
  if (cambioRiesgo) {
    await window.logBitacora(
      nivelOverride ? 'riesgo_override' : 'riesgo_override_quitado',
      nivelOverride ? `Riesgo ajustado manualmente a ${nivelOverride}: ${cli.riesgoOverrideMotivo}` : `Ajuste manual de riesgo quitado: ${document.getElementById('cli-riesgo-motivo').value.trim()}`,
      id
    );
  }
  window.scheduleDriveSync();

  window.closeSheet();
  window.toast('✅ Cliente guardado');

  if (editId && window.curPage === 'cliente-detail') {
    await window.openClienteDetail(editId);
  } else {
    await window.renderPage('clientes');
  }
  } finally {
    operacion.liberar();
  }
}

export async function confirmarBorrarCliente(id) {
  const c = await window.dbGet('clientes', id);
  if (!c) return;
  const prestamos = (await window.dbAll('prestamos'))
    .filter(p => p.clienteId === id && ['Activo','Atrasado'].includes(p.estado));
  if (prestamos.length) {
    window.toast(`🚫 Tiene ${prestamos.length} préstamo${prestamos.length>1?'s':''} activo${prestamos.length>1?'s':''}`);
    return;
  }
  document.getElementById('del-title').textContent = '¿Eliminar cliente?';
  document.getElementById('del-msg').textContent   = `Se eliminará "${c.nombre}" y sus registros asociados. Esta acción no se puede deshacer.`;
  const confirmInput = document.getElementById('del-confirm-text');
  const confirmBtn = document.getElementById('del-confirm-btn');
  confirmInput.value = '';
  confirmBtn.disabled = true;
  confirmInput.oninput = () => {
    confirmBtn.disabled = confirmInput.value.trim().toUpperCase() !== 'ELIMINAR';
  };
  confirmBtn.onclick = () => borrarCliente(id);
  window.openSheet('sh-delete');
  setTimeout(() => confirmInput.focus(), 120);
}

export async function borrarCliente(id) {
  const operacion = window.iniciarOperacionProtegida?.(
    `cliente:eliminar:${id}`,
    document.getElementById('del-confirm-btn'),
    'Eliminando...'
  );
  if (!operacion) return;
  try {
  if (await window.bloquearEscrituraPorRestorePending?.()) return;
  const confirmacion = document.getElementById('del-confirm-text')?.value.trim().toUpperCase();
  if (confirmacion !== 'ELIMINAR') {
    window.toast('Escribí ELIMINAR para confirmar');
    return;
  }
  const carteraHistorica = (await window.dbAllIncludeDeleted('prestamos')).some(p => p.clienteId === id && p.cargaInicial);
  if (carteraHistorica) {
    window.toast('Este cliente tiene cartera histórica auditada y no puede eliminarse. Podés actualizar sus datos de contacto.');
    return;
  }
  try { await window.validarEliminacionClienteHistorico?.(id); }
  catch(error) { window.toast(error.message);return; }
  window.closeSheet();
  const cli = await window.dbGet('clientes', id);
  // Borrado logico — marca como eliminado, no destruye datos
  const cuotas    = await window.dbAll('cuotas');
  const prestamos = await window.dbAll('prestamos');
  for (const p of prestamos.filter(p => p.clienteId === id && !p._deleted)) {
    for (const c of cuotas.filter(c => c.prestamoId === p.id && !c._deleted)) {
      await window.dbSoftDeleteAndQueue('cuotas', c.id);
    }
    await window.dbSoftDeleteAndQueue('prestamos', p.id);
  }
  await window.dbSoftDeleteAndQueue('clientes', id);
  await window.logBitacora('eliminacion', `Cliente eliminado: ${cli?.nombre || id}`, id);
  window.scheduleDriveSync();
  window.toast('🗑️ Cliente eliminado');
  await window.goPage('clientes');
  } finally {
    operacion.liberar();
  }
}
