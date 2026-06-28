/* =====================================================
   ADD / EDIT CLIENTE
===================================================== */
function openSheetCliente(editId = null) {
  document.getElementById('cli-edit-id').value = editId || '';
  document.getElementById('sh-cli-title').textContent = editId ? '✏️ Editar Cliente' : '👤 Nuevo Cliente';
  if (!editId) {
    ['cli-nombre','cli-dni','cli-tel','cli-dir','cli-notas'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cli-riesgo').value = 'Bajo';
  }
  openSheet('sh-cliente');
}

async function editarCliente(id) {
  const c = await dbGet('clientes', id);
  if (!c) return;
  document.getElementById('cli-nombre').value = c.nombre || '';
  document.getElementById('cli-dni').value    = c.dni || '';
  document.getElementById('cli-tel').value    = c.telefono || '';
  document.getElementById('cli-dir').value    = c.direccion || '';
  document.getElementById('cli-riesgo').value = c.riesgo || 'Bajo';
  document.getElementById('cli-notas').value  = c.notas || '';
  openSheetCliente(id);
}

async function saveCliente() {
  const nombre = document.getElementById('cli-nombre').value.trim();
  if (!nombre) { toast('⚠️ El nombre es obligatorio'); return; }

  const editId = document.getElementById('cli-edit-id').value;
  const todos  = await dbAll('clientes');
  const id     = editId || nextId('CL', todos);

  const cli = {
    id,
    nombre,
    dni      : document.getElementById('cli-dni').value.trim(),
    telefono : document.getElementById('cli-tel').value.trim(),
    direccion: document.getElementById('cli-dir').value.trim(),
    riesgo   : document.getElementById('cli-riesgo').value,
    notas    : document.getElementById('cli-notas').value.trim(),
    estado   : 'Activo',
    creadoEn : editId ? undefined : new Date().toISOString()
  };

  if (editId) {
    const orig = await dbGet('clientes', editId);
    Object.assign(cli, { estado: orig.estado, creadoEn: orig.creadoEn });
  }

  // 1. Guardado local inmediato
  await dbPut('clientes', cli);
  // 2. Sync queue
  await addToSyncQueue('clientes', id, cli, 'upsert');
  // 3. Bitácora
  await logBitacora(editId ? 'edicion' : 'nuevo_cliente', `Cliente ${editId ? 'editado' : 'creado'}: ${nombre}${cli.dni ? ' · DNI ' + cli.dni : ''}`, id);
  // 4. Drive diferido
  scheduleDriveSync();

  closeSheet();
  toast('✅ Cliente guardado');

  if (editId && curPage === 'cliente-detail') {
    await openClienteDetail(editId);
  } else {
    await renderPage('clientes');
  }
}

async function confirmarBorrarCliente(id) {
  const c = await dbGet('clientes', id);
  if (!c) return;
  const prestamos = (await dbAll('prestamos')).filter(p=>p.clienteId===id && ['Activo','Atrasado'].includes(p.estado));
  if (prestamos.length) {
    toast(`🚫 Tiene ${prestamos.length} préstamo${prestamos.length>1?'s':''} activo${prestamos.length>1?'s':''}`);
    return;
  }
  document.getElementById('del-title').textContent = '¿Eliminar cliente?';
  document.getElementById('del-msg').textContent   = `Se eliminará "${c.nombre}". Esta acción no se puede deshacer.`;
  document.getElementById('del-confirm-btn').onclick = () => borrarCliente(id);
  openSheet('sh-delete');
}

async function borrarCliente(id) {
  closeSheet();
  const cli = await dbGet('clientes', id);
  // Borrado lógico — marca como eliminado, no destruye datos
  await dbSoftDelete('clientes', id);
  const cuotas = await dbAll('cuotas');
  const prestamos = await dbAll('prestamos');
  for (const p of prestamos.filter(p => p.clienteId === id && !p._deleted)) {
    for (const c of cuotas.filter(c => c.prestamoId === p.id && !c._deleted)) {
      await dbSoftDelete('cuotas', c.id);
    }
    await dbSoftDelete('prestamos', p.id);
  }
  await logBitacora('eliminacion', `Cliente eliminado: ${cli?.nombre || id}`, id);
  addToSyncQueue('clientes', id, { _deleted: true, id });
  scheduleDriveSync();
  toast('🗑️ Cliente eliminado');
  goPage('clientes');
}

