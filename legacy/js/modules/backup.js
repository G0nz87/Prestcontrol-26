/* =====================================================
   BACKUP / RESTORE
===================================================== */
const RESPALDO_CAMPOS_EXCLUIDOS = new Set([
  'pass', 'password', 'masterpass', 'pin', 'hash', 'salt',
  'apikey', 'waapikey', 'token', 'accesstoken', 'credential',
  'credentialid', 'rawid', 'userid', 'deviceid', 'secret',
  'refreshtoken', 'privatekey'
]);

function esCampoSensibleParaRespaldo(clave) {
  const normalizada = String(clave || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return RESPALDO_CAMPOS_EXCLUIDOS.has(normalizada)
    || normalizada.startsWith('pin')
    || /(password|apikey|accesstoken|refreshtoken|credential|privatekey|secret)$/.test(normalizada);
}

function limpiarDatoParaRespaldo(valor) {
  if (Array.isArray(valor)) return valor.map(limpiarDatoParaRespaldo);
  if (valor instanceof Date) return valor.toISOString();
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(
    Object.entries(valor)
      .filter(([clave]) => !esCampoSensibleParaRespaldo(clave))
      .map(([clave, dato]) => [clave, limpiarDatoParaRespaldo(dato)])
  );
}

function selloFechaRespaldo(fecha) {
  const dos = numero => String(numero).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}_${dos(fecha.getHours())}-${dos(fecha.getMinutes())}-${dos(fecha.getSeconds())}`;
}

async function exportarBackup() {
  if (!DB || !appDesbloqueada) {
    toast('⚠️ Ingresá a PrestControl para exportar un respaldo');
    return;
  }
  if (!confirm('El respaldo contiene datos personales y financieros sensibles. ¿Querés descargarlo ahora?')) return;

  try {
    const [clientes, prestamos, cuotas, bitacora, waPhone] = await Promise.all([
      dbAllIncludeDeleted('clientes'),
      dbAllIncludeDeleted('prestamos'),
      dbAllIncludeDeleted('cuotas'),
      dbAll('bitacora'),
      getConfig('waPhone')
    ]);
    const fecha = new Date();
    const data = limpiarDatoParaRespaldo({
      v: 3,
      tipo: 'prestcontrol-respaldo-manual',
      fecha: fecha.toISOString(),
      zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      usuario: { nombre: currentUser || '' },
      clientes,
      prestamos,
      cuotas,
      bitacora,
      configuracion: {
        whatsappTelefono: waPhone || ''
      },
      detalle: {
        pagos: 'Incluidos dentro de cuotas',
        historial: 'Incluido mediante prestamos, cuotas y bitacora'
      }
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `prestcontrol_respaldo_${selloFechaRespaldo(fecha)}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`✅ Respaldo ${fecha.toLocaleString('es-AR')} descargado`);
  } catch (error) {
    console.error('No se pudo exportar el respaldo:', error);
    toast('❌ No se pudo generar el respaldo');
  }
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
