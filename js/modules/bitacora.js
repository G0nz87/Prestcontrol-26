/* =====================================================
   BITÁCORA — LOG
===================================================== */
async function logBitacora(tipo, descripcion, refId = '') {
  try {
    const entrada = {
      id         : 'BIT-' + Date.now() + '-' + Math.random().toString(36).slice(2,5),
      tipo,          // 'pago' | 'nuevo_prestamo' | 'nuevo_cliente' | 'edicion' | 'eliminacion'
      descripcion,
      refId,
      fecha      : new Date().toISOString()
    };
    await dbPut('bitacora', entrada);
  } catch(e) { /* no interrumpir flujo si falla */ }
}

async function renderBitacora() {
  const el = document.getElementById('pg-bitacora');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  const registros = await dbAll('bitacora');
  registros.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

  if (!registros.length) {
    el.innerHTML = emptyHTML('📋','Sin registros','Los movimientos aparecerán aquí automáticamente.');
    return;
  }

  const iconMap = {
    pago          : '✅',
    nuevo_prestamo: '💵',
    nuevo_cliente : '👤',
    edicion       : '✏️',
    eliminacion   : '🗑️'
  };
  const colorMap = {
    pago          : 'var(--grn)',
    nuevo_prestamo: 'var(--gold)',
    nuevo_cliente : '#60A5FA',
    edicion       : 'var(--yel)',
    eliminacion   : 'var(--red)'
  };

  // Agrupar por día
  const grupos = {};
  registros.forEach(r => {
    const dia = r.fecha.slice(0,10);
    if (!grupos[dia]) grupos[dia] = [];
    grupos[dia].push(r);
  });

  const html = Object.entries(grupos).map(([dia, items]) => {
    const fecha = parseDate(dia);
    const label = fecha ? fecha.toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'}) : dia;
    return `
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)">${label}</div>
      ${items.map(r => `
        <div class="card-sm" style="display:flex;gap:12px;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:22px;line-height:1;flex-shrink:0">${iconMap[r.tipo]||'📌'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:${colorMap[r.tipo]||'var(--txt)'}">${tipoLabel(r.tipo)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:3px;line-height:1.4">${esc(r.descripcion)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px">${new Date(r.fecha).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</div>
          </div>
        </div>`).join('')}`;
  }).join('');

  el.innerHTML = `<div class="fadeIn">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:13px;color:var(--muted)">${registros.length} registro${registros.length!==1?'s':''}</div>
      <button class="btn btn-sm btn-ghost" onclick="limpiarBitacora()">🗑️ Limpiar</button>
    </div>
    ${html}
  </div>`;
}

function tipoLabel(tipo) {
  const m = { pago:'Pago registrado', nuevo_prestamo:'Préstamo creado', nuevo_cliente:'Cliente nuevo', edicion:'Edición', eliminacion:'Eliminación' };
  return m[tipo] || tipo;
}

async function limpiarBitacora() {
  if (!confirm('¿Limpiar toda la bitácora? Esta acción no se puede deshacer.')) return;
  const todos = await dbAll('bitacora');
  for (const r of todos) await dbDel('bitacora', r.id);
  toast('✅ Bitácora limpiada');
  await renderBitacora();
}

