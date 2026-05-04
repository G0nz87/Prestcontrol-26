// UI handlers de Clientes. Disparados desde onclick="..." en el HTML.
// Delegan validacion + CRUD a window.clienteService; persistencia local
// y sync queue siguen viviendo en el inline classic (window.dbAll, etc.)
// hasta que los proximos sub-steps migren esas capas.

export function openSheetCliente(editId = null) {
  document.getElementById('cli-edit-id').value = editId || '';
  document.getElementById('sh-cli-title').textContent = editId ? '✏️ Editar Cliente' : '👤 Nuevo Cliente';
  if (!editId) {
    ['cli-nombre','cli-dni','cli-tel','cli-dir','cli-notas'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cli-riesgo').value = 'Bajo';
  }
  window.openSheet('sh-cliente');
}

export async function editarCliente(id) {
  const c = await window.dbGet('clientes', id);
  if (!c) return;
  document.getElementById('cli-nombre').value = c.nombre || '';
  document.getElementById('cli-dni').value    = c.dni || '';
  document.getElementById('cli-tel').value    = c.telefono || '';
  document.getElementById('cli-dir').value    = c.direccion || '';
  document.getElementById('cli-riesgo').value = c.riesgo || 'Bajo';
  document.getElementById('cli-notas').value  = c.notas || '';
  openSheetCliente(id);
}

export async function saveCliente() {
  const nombre   = document.getElementById('cli-nombre').value.trim();
  const dni      = document.getElementById('cli-dni').value.trim();
  const telefono = document.getElementById('cli-tel').value.trim();
  const editId   = document.getElementById('cli-edit-id').value;

  // Validacion delegada al service (nombre obligatorio, DNI formato + duplicado, telefono formato)
  try {
    await window.clienteService.validarDatosCliente({
      id: editId || null, nombre, dni, telefono
    });
  } catch (e) {
    return window.toast('⚠️ ' + e.message);
  }

  const todos = await window.dbAll('clientes');
  const id    = editId || window.nextId('CL', todos);

  const cli = {
    id,
    nombre,
    dni,
    telefono,
    direccion: document.getElementById('cli-dir').value.trim(),
    riesgo   : document.getElementById('cli-riesgo').value,
    notas    : document.getElementById('cli-notas').value.trim(),
    estado   : 'Activo',
    creadoEn : editId ? undefined : new Date().toISOString()
  };

  if (editId) {
    const orig = await window.dbGet('clientes', editId);
    Object.assign(cli, { estado: orig.estado, creadoEn: orig.creadoEn });
  }

  await window.dbPut('clientes', cli);
  await window.addToSyncQueue('clientes', id, cli, 'upsert');
  await window.logBitacora(
    editId ? 'edicion' : 'nuevo_cliente',
    `Cliente ${editId ? 'editado' : 'creado'}: ${nombre}${cli.dni ? ' · DNI ' + cli.dni : ''}`,
    id
  );
  window.scheduleDriveSync();

  window.closeSheet();
  window.toast('✅ Cliente guardado');

  if (editId && window.curPage === 'cliente-detail') {
    await window.openClienteDetail(editId);
  } else {
    await window.renderPage('clientes');
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
  document.getElementById('del-msg').textContent   = `Se eliminará "${c.nombre}". Esta acción no se puede deshacer.`;
  document.getElementById('del-confirm-btn').onclick = () => borrarCliente(id);
  window.openSheet('sh-delete');
}

export async function borrarCliente(id) {
  window.closeSheet();
  const cli = await window.dbGet('clientes', id);
  // Borrado logico — marca como eliminado, no destruye datos
  await window.dbSoftDelete('clientes', id);
  const cuotas    = await window.dbAll('cuotas');
  const prestamos = await window.dbAll('prestamos');
  for (const p of prestamos.filter(p => p.clienteId === id && !p._deleted)) {
    for (const c of cuotas.filter(c => c.prestamoId === p.id && !c._deleted)) {
      await window.dbSoftDelete('cuotas', c.id);
    }
    await window.dbSoftDelete('prestamos', p.id);
  }
  await window.logBitacora('eliminacion', `Cliente eliminado: ${cli?.nombre || id}`, id);
  window.addToSyncQueue('clientes', id, { _deleted: true, id });
  window.scheduleDriveSync();
  window.toast('🗑️ Cliente eliminado');
  window.goPage('clientes');
}
