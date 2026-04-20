/* =====================================================
   BACKUP / RESTORE
===================================================== */
async function exportarBackup() {
  const [clientes, prestamos, cuotas] = await Promise.all([
    dbAll('clientes'), dbAll('prestamos'), dbAll('cuotas')
  ]);
  const data = { v:2, fecha: new Date().toISOString(), clientes, prestamos, cuotas };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const d    = new Date().toISOString().split('T')[0];
  a.href = url; a.download = `prestamos_backup_${d}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast('✅ Backup descargado');
}

async function importarBackup(input) {
  const file = input.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);

    // Validación de integridad mínima
    if (!Array.isArray(data.clientes) || !Array.isArray(data.prestamos)) {
      toast('❌ Archivo inválido — faltan clientes o préstamos'); input.value = ''; return;
    }
    if (data.clientes.some(c => !c.id || !c.nombre)) {
      toast('❌ Archivo inválido — clientes con datos incompletos'); input.value = ''; return;
    }
    if (data.prestamos.some(p => !p.id || !p.clienteId)) {
      toast('❌ Archivo inválido — préstamos con datos incompletos'); input.value = ''; return;
    }

    const nCli = data.clientes.length;
    const nPre = data.prestamos.length;
    const nCuo = (data.cuotas||[]).length;

    if (!confirm(
      `¿Importar backup?\n\n` +
      `• ${nCli} clientes\n• ${nPre} préstamos\n• ${nCuo} cuotas\n\n` +
      `Esto MEZCLARÁ con los datos actuales (last-write-wins).\n` +
      `Los datos más nuevos prevalecerán.`
    )) return;

    let importados = 0;
    // Merge inteligente — no destruye datos locales más nuevos
    for (const c of data.clientes) {
      const local = await dbGet('clientes', c.id).catch(()=>null);
      if (!local || (c.updatedAt && (!local.updatedAt || c.updatedAt > local.updatedAt))) {
        await dbPut('clientes', c); importados++;
      }
    }
    for (const p of data.prestamos) {
      const local = await dbGet('prestamos', p.id).catch(()=>null);
      if (!local || (p.updatedAt && (!local.updatedAt || p.updatedAt > local.updatedAt))) {
        await dbPut('prestamos', p); importados++;
      }
    }
    for (const c of (data.cuotas||[])) {
      const local = await dbGet('cuotas', c.id).catch(()=>null);
      if (!local || (c.updatedAt && (!local.updatedAt || c.updatedAt > local.updatedAt))) {
        await dbPut('cuotas', c); importados++;
      }
    }
    await logBitacora('config', `Backup importado: ${nCli} clientes, ${nPre} préstamos, ${nCuo} cuotas — ${importados} actualizados`, currentUser);
    toast(`✅ Backup importado — ${importados} registros actualizados`);
    await autoUpdateEstados();
    await renderPage('dashboard');
  } catch(e) {
    toast('❌ Error al leer el archivo. Verificá que sea un backup válido.');
  }
  input.value = '';
}

