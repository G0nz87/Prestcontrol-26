/* =====================================================
   RENDER PAGES
===================================================== */
async function renderPage(id) {
  const titles = {
    dashboard: '💰 PrestControl', hoy: '📅 Cobrar Hoy',
    atrasadas: '⚠️ Cuotas Atrasadas', clientes: '👥 Clientes',
    prestamos: '📋 Préstamos', cuotas: '🧾 Cuotas',
    calendario: '🗓️ Agenda', config: '⚙️ Configuración',
    bitacora: '📋 Bitácora', historial: '📈 Historial por Período',
    cobros: '💰 Cobros'
  };
  document.getElementById('hdr-title').textContent = titles[id] || '💰 PrestControl';

  switch(id) {
    case 'dashboard' : await renderDashboard();  break;
    case 'hoy'       : await renderHoy();        break;
    case 'atrasadas' : await renderAtrasadas();  break;
    case 'clientes'  : await renderClientes();   break;
    case 'prestamos' : await renderPrestamos();  break;
    case 'cuotas'    : await renderCuotas();     break;
    case 'calendario': await renderCalendario(); break;
    case 'config'    : await renderConfig();     break;
    case 'bitacora'  : await renderBitacora();   break;
    case 'historial' : await renderHistorial();  break;
    case 'cobros'    : await renderCobros();     break;
  }
}

function toggleMasMenu() {
  const m = document.getElementById('mas-menu');
  const isOpen = m.style.display !== 'none';
  m.style.display = isOpen ? 'none' : 'block';
  const btn = document.getElementById('nb-mas');
  if (btn) btn.classList.toggle('on', !isOpen);
  if (!isOpen) {
    setTimeout(() => document.addEventListener('click', closeMasMenuOutside, { once: true }), 50);
  }
}
function closeMasMenu() {
  document.getElementById('mas-menu').style.display = 'none';
  const btn = document.getElementById('nb-mas');
  if (btn) btn.classList.remove('on');
}
function closeMasMenuOutside(e) {
  const m = document.getElementById('mas-menu');
  const btn = document.getElementById('nb-mas');
  if (m && btn && !m.contains(e.target) && !btn.contains(e.target)) closeMasMenu();
}

/* ---- DASHBOARD ---- */
let dashTab = 'global'; // 'global' | 'cliente'
let dashClienteId = null;

async function renderDashboard() {
  const el = document.getElementById('pg-dashboard');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  // Usamos dbAllIncludeDeleted para que el balance histórico incluya préstamos eliminados
  const [cuotas, clientes, prestamos] = await Promise.all([
    dbAllIncludeDeleted('cuotas'), dbAllIncludeDeleted('clientes'), dbAllIncludeDeleted('prestamos')
  ]);
  if (dashTab === 'global') {
    el.innerHTML = buildDashGlobal(cuotas, clientes, prestamos);
  } else if (dashTab === 'cliente') {
    el.innerHTML = buildDashCliente(cuotas, clientes, prestamos);
  } else if (dashTab === 'graficos') {
    await renderGraficos();
  }
}

function switchDashTab(tab) {
  dashTab = tab;
  if (tab === 'graficos') {
    renderGraficos();
  } else {
    renderDashboard();
  }
}

function switchDashCliente(id) {
  dashClienteId = id || null;
  renderDashboard().then(() => {
    const drop = document.getElementById('dash-cli-drop');
    if (drop) drop.classList.remove('on');
  });
}

function buildDashGlobal(cuotas, clientes, prestamos) {
  const hoy = today();
  let cobrarHoy=0, mHoy=0, atrasadas=0, mAtr=0, pendientes=0, mPend=0, prox7=0, cobradas=0, mCob=0;

  // Solo cuotas NO eliminadas para el estado actual
  cuotas.filter(c => !c._deleted).forEach(c => {
    const venc = parseDate(c.fechaVenc);
    const m = Number(c.monto||0);
    if (c.estado === 'Pagado') { cobradas++; mCob += m; return; }
    if (c.estado === 'Ejecutada') return; // No cuenta ni como cobrado ni como deuda
    if (!venc) return;
    const dias = Math.floor((hoy - venc) / 86400000);
    pendientes++; mPend += m;
    if (venc.getTime() === hoy.getTime()) { cobrarHoy++; mHoy += m; }
    else if (dias > 0) { atrasadas++; mAtr += m; }
    else if (dias >= -7) prox7++;
  });

  setBadge('hoy', cobrarHoy);
  setBadge('atr', atrasadas);

  // Métricas históricas: incluyen préstamos reales (no los eliminados por error)
  const prestamosValidos = prestamos.filter(p => !p._deleted && p.estado !== 'Cancelado');
  const totalPrestado  = prestamosValidos.reduce((s,p)=>s+Number(p.monto||0),0);
  const gananciaEsp    = prestamosValidos.reduce((s,p)=>s+Number(p.ganancia||0),0);
  // Total pendiente de cobro (solo activos)
  const totalACobrar   = prestamos.filter(p=>!p._deleted && p.estado!=='Pagado' && p.estado!=='Cancelado' && p.estado!=='Ejecutado').reduce((s,p)=>s+Number(p.total||0),0);
  const capitalRiesgo  = cuotas.filter(c=>!c._deleted && c.estado==='Atrasado').reduce((s,c)=>s+Number(c.monto||0),0);
  const clientesActivos= clientes.filter(c=>!c._deleted && c.estado==='Activo').length;
  const prestActivos   = prestamos.filter(p=>!p._deleted && (p.estado==='Activo'||p.estado==='Atrasado')).length;
  // Ganancia real = lo que ya entró en efectivo - el capital prestado de esos pagos
  const gananciaReal   = Math.max(0, mCob - (totalPrestado - totalACobrar));
  const pctCobrado     = totalPrestado > 0 ? Math.round(mCob / (totalPrestado + gananciaEsp) * 100) : 0;

  let urgente = '';
  if (cobrarHoy>0) urgente+=`<div class="abanner ay"><div class="abanner-ic">📢</div><div style="flex:1"><div class="abanner-t">${cobrarHoy} cobro${cobrarHoy>1?'s':''} para hoy</div><div class="abanner-s">Total: ${fmtMoney(mHoy)}</div><button class="btn btn-sm" style="background:var(--yel);color:#0A0F1F;margin-top:8px" onclick="goPage('hoy')">Ver →</button></div></div>`;
  if (atrasadas>0) urgente+=`<div class="abanner ar"><div class="abanner-ic">🚨</div><div style="flex:1"><div class="abanner-t">${atrasadas} cuota${atrasadas>1?'s':''} con atraso</div><div class="abanner-s">${fmtMoney(mAtr)} en riesgo</div><button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px" onclick="goPage('atrasadas')">Ver →</button></div></div>`;
  if (!cobrarHoy&&!atrasadas) urgente=`<div class="abanner ag"><div class="abanner-ic">✅</div><div><div class="abanner-t">¡Todo al día!</div><div class="abanner-s">Sin cobros urgentes.</div></div></div>`;

  return `<div class="fadeIn">
    <div class="dtabs">
      <button class="dtab on" onclick="switchDashTab('global')">🌐 Global</button>
      <button class="dtab" onclick="switchDashTab('cliente')">👤 Cliente</button>
      <button class="dtab" onclick="switchDashTab('graficos')">📊 Gráficos</button>
    </div>
    ${urgente}
    <div class="srow">
      <div class="sri"><div class="sri-ic">📅</div><div class="sri-v" style="color:var(--yel)">${cobrarHoy}</div><div class="sri-l">Cobrar Hoy</div></div>
      <div class="sri"><div class="sri-ic">⚠️</div><div class="sri-v" style="color:var(--red)">${atrasadas}</div><div class="sri-l">Atrasadas</div></div>
      <div class="sri"><div class="sri-ic">⏳</div><div class="sri-v">${pendientes}</div><div class="sri-l">Pendientes</div></div>
    </div>
    <div class="srow">
      <div class="sri"><div class="sri-ic">✅</div><div class="sri-v" style="color:var(--grn)">${cobradas}</div><div class="sri-l">Cobradas</div></div>
      <div class="sri"><div class="sri-ic">👥</div><div class="sri-v" style="color:var(--gold)">${clientesActivos}</div><div class="sri-l">Clientes Act.</div></div>
      <div class="sri"><div class="sri-ic">📋</div><div class="sri-v" style="color:var(--gold)">${prestActivos}</div><div class="sri-l">Préstamos Act.</div></div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💰 Resumen financiero</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted)">Capital prestado</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:var(--money)">${fmtMoney(totalPrestado)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Total histórico</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted)">Ya cobrado</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:var(--grn)">${fmtMoney(mCob)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${pctCobrado}% del total</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted)">Ganancia real 💵</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:var(--grn)">${fmtMoney(gananciaReal)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Lo que ya entraste de más</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted)">Ganancia proyectada 📈</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:${gananciaReal>=gananciaEsp?'var(--grn)':'var(--yel)'}">${fmtMoney(gananciaEsp)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${gananciaReal>=gananciaEsp ? '✅ Todo cobrado' : 'Si todos pagan completo'}</div>
        </div>
        ${totalACobrar > 0 ? `
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted)">Pendiente de cobro</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:var(--yel)">${fmtMoney(totalACobrar)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">En préstamos activos</div>
        </div>` : ''}
        ${capitalRiesgo > 0 ? `
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted)">Capital en riesgo ⚠️</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:var(--red)">${fmtMoney(capitalRiesgo)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Cuotas atrasadas</div>
        </div>` : ''}
      </div>
    </div>
    <div class="srow2">
      <div class="sri"><div class="sri-ic">💸</div><div class="sri-v" style="font-size:12px;color:var(--grn)">${fmtMoney(mCob)}</div><div class="sri-l">Ya Cobrado</div></div>
      <div class="sri"><div class="sri-ic">📆</div><div class="sri-v">${prox7}</div><div class="sri-l">Próx. 7 días</div></div>
    </div>
  </div>`;
}

function buildDashCliente(cuotas, clientes, prestamos) {
  const activos = clientes.filter(c => c.estado === 'Activo');
  const selId   = dashClienteId || (activos[0] ? activos[0].id : null);
  const selCli  = clientes.find(c => c.id === selId);
  const selectOpts = activos.map(c =>
    `<option value="${esc(c.id)}" ${c.id===selId?'selected':''}>${esc(c.nombre)}</option>`
  ).join('');

  let body = '';
  if (!selCli) {
    body = `<div class="empty"><div class="empty-ic">👤</div><div class="empty-t">Sin clientes activos</div></div>`;
  } else {
    const hoy = today();
    // Filtrar préstamos y cuotas NO eliminados (para estado actual del cliente)
    const misPre = prestamos.filter(p => p.clienteId === selId && !p._deleted);
    const misCuo = cuotas.filter(c => c.clienteId === selId && !c._deleted);
    let cHoy=0,mHoy=0,cAtr=0,mAtr=0,cPend=0,mPend=0,cPag=0;
    misCuo.forEach(c => {
      const venc = parseDate(c.fechaVenc); if (!venc) return;
      const dias = Math.floor((hoy - venc) / 86400000);
      const m = Number(c.monto||0);
      if (c.estado==='Pagado' || c.estado==='Ejecutada'){cPag++;return;}
      cPend++;mPend+=m;
      if (venc.getTime()===hoy.getTime()){cHoy++;mHoy+=m;}
      else if (dias>0){cAtr++;mAtr+=m;}
    });
    const totalPrestado = misPre.reduce((s,p)=>s+Number(p.monto||0),0);
    const totalDeuda    = misCuo.filter(c=>c.estado!=='Pagado' && c.estado!=='Ejecutada').reduce((s,c)=>s+Number(c.monto||0),0);
    const totalGanancia = misPre.reduce((s,p)=>s+Number(p.ganancia||0),0);
    const rMap = {Bajo:'bg-grn',Medio:'bg-yel',Alto:'bg-red'};
    let urgCli = '';
    if (cHoy>0) urgCli+=`<div class="abanner ay"><div class="abanner-ic">📅</div><div><div class="abanner-t">${cHoy} cuota${cHoy>1?'s':''} vencen hoy</div><div class="abanner-s">${fmtMoney(mHoy)}</div></div></div>`;
    if (cAtr>0) urgCli+=`<div class="abanner ar"><div class="abanner-ic">⚠️</div><div><div class="abanner-t">${cAtr} cuota${cAtr>1?'s':''} atrasada${cAtr>1?'s':''}</div><div class="abanner-s">${fmtMoney(mAtr)}</div></div></div>`;
    if (!cHoy&&!cAtr) urgCli=`<div class="abanner ag"><div class="abanner-ic">✅</div><div><div class="abanner-t">Al día</div><div class="abanner-s">Sin cobros urgentes.</div></div></div>`;
    body = `
      <div class="card" style="display:flex;gap:12px;align-items:center">
        <div class="ava" style="width:46px;height:46px;font-size:20px;flex-shrink:0">${esc(selCli.nombre).charAt(0).toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(selCli.nombre)}</div>
          <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
            <span class="badge ${selCli.estado==='Activo'?'bg-blu':'bg-muted'}">${selCli.estado}</span>
            <span class="badge ${rMap[selCli.riesgo]||'bg-muted'}">Riesgo ${selCli.riesgo||'—'}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="openClienteDetail('${esc(selId)}')">Ver →</button>
      </div>
      ${urgCli}
      <div class="srow">
        <div class="sri"><div class="sri-ic">📅</div><div class="sri-v" style="color:var(--yel)">${cHoy}</div><div class="sri-l">Hoy</div></div>
        <div class="sri"><div class="sri-ic">⚠️</div><div class="sri-v" style="color:var(--red)">${cAtr}</div><div class="sri-l">Atrasadas</div></div>
        <div class="sri"><div class="sri-ic">✅</div><div class="sri-v" style="color:var(--grn)">${cPag}</div><div class="sri-l">Pagadas</div></div>
      </div>
      <div class="srow2">
        <div class="sri"><div class="sri-ic">💵</div><div class="sri-v" style="font-size:12px;color:var(--money)">${fmtMoney(totalPrestado)}</div><div class="sri-l">Capital</div></div>
        <div class="sri"><div class="sri-ic">💸</div><div class="sri-v" style="font-size:12px;color:var(--red)">${fmtMoney(totalDeuda)}</div><div class="sri-l">Deuda</div></div>
      </div>
      <div class="srow2">
        <div class="sri"><div class="sri-ic">📈</div><div class="sri-v" style="font-size:12px;color:var(--grn)">${fmtMoney(totalGanancia)}</div><div class="sri-l">Ganancia</div></div>
        <div class="sri"><div class="sri-ic">📋</div><div class="sri-v">${misPre.length}</div><div class="sri-l">Préstamos</div></div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Historial de pagos</div>
      <div class="card" style="padding:10px 14px;max-height:220px;overflow-y:auto">
        ${misCuo.filter(c=>c.estado==='Pagado').sort((a,b)=>new Date(b.fechaPago||0)-new Date(a.fechaPago||0)).slice(0,15).map(c=>`
          <div class="hist-item">
            <div class="hist-dot"></div>
            <div class="hist-body"><div class="hist-name">Cuota ${c.nro} · ${esc(c.prestamoId)}</div><div class="hist-meta">${fmtDate(c.fechaPago)} · ${esc(c.metodo||'—')}</div></div>
            <div class="hist-amt">${fmtMoney(c.monto)}</div>
          </div>`).join('') || '<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px">Sin pagos registrados</div>'}
      </div>`;
  }
  // Build autocomplete options for dash client search
  const acOpts = activos.map(c =>
    `<div class="ac-item" onclick="switchDashCliente('${esc(c.id)}')" data-id="${esc(c.id)}">${esc(c.nombre)}</div>`
  ).join('');

  return `<div class="fadeIn">
    <div class="dtabs">
      <button class="dtab" onclick="switchDashTab('global')">🌐 Global</button>
      <button class="dtab on" onclick="switchDashTab('cliente')">👤 Cliente</button>
      <button class="dtab" onclick="switchDashTab('graficos')">📊 Gráficos</button>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="lbl">Buscar Cliente</label>
      <div class="ac-wrap">
        <input class="inp" id="dash-cli-search" placeholder="Escribí el nombre del cliente…"
          value="${selCli ? esc(selCli.nombre) : ''}"
          autocomplete="off"
          oninput="filtrarDashCliente(this.value)"
          onfocus="filtrarDashCliente(this.value)">
        <div class="ac-drop" id="dash-cli-drop">${acOpts}</div>
      </div>
    </div>
    ${body}
  </div>`;
}

/* ---- HOY ---- */
/* ---- COBROS (Hoy + Atrasadas en una sola vista) ---- */
async function renderCobros() {
  const el = document.getElementById('pg-cobros');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  const cuotas = await dbAll('cuotas');
  const hoy = today();

  const listaHoy = cuotas.filter(c => {
    if (c.estado === 'Pagado') return false;
    const v = parseDate(c.fechaVenc);
    return v && v.getTime() === hoy.getTime();
  }).sort((a,b) => a.clienteNombre > b.clienteNombre ? 1 : -1);

  const listaAtr = cuotas.filter(c => {
    if (c.estado === 'Pagado') return false;
    const v = parseDate(c.fechaVenc);
    return v && v < hoy;
  }).map(c => {
    const dias = Math.floor((hoy - parseDate(c.fechaVenc)) / 86400000);
    return { ...c, _dias: dias };
  }).sort((a,b) => b._dias - a._dias);

  const totalHoy = listaHoy.reduce((s,c)=>s+Number(c.monto||0),0);
  const totalAtr = listaAtr.reduce((s,c)=>s+Number(c.monto||0),0);

  setBadge('hoy', listaHoy.length);
  setBadge('atr', listaAtr.length);

  let html = '<div class="fadeIn">';

  if (listaHoy.length) {
    html += `<div style="font-size:12px;font-weight:800;color:var(--yel);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📅 Cobrar hoy — ${fmtMoney(totalHoy)}</div>`;
    html += `<button class="btn btn-gold btn-full" style="margin-bottom:12px" onclick="marcarTodasHoy()">⚡ Marcar TODAS como Pagadas</button>`;
    html += listaHoy.map(c => cuotaItemHTML(c, 'hoy')).join('');
  }

  if (listaAtr.length) {
    html += `<div style="font-size:12px;font-weight:800;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin:${listaHoy.length?'20px':'0px'} 0 8px">⚠️ Atrasadas — ${fmtMoney(totalAtr)}</div>`;
    html += listaAtr.map(c => cuotaItemHTML(c, 'atr')).join('');
  }

  if (!listaHoy.length && !listaAtr.length) {
    html += emptyHTML('🎉','¡Todo al día!','Sin cobros pendientes.');
  }

  html += '</div>';
  el.innerHTML = html;
}

async function renderHoy() {
  const el = document.getElementById('pg-hoy');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  const lista = cuotas.filter(c => {
    if (c.estado === 'Pagado') return false;
    const v = parseDate(c.fechaVenc);
    return v && v.getTime() === hoy.getTime();
  }).sort((a,b) => a.clienteNombre > b.clienteNombre ? 1 : -1);

  setBadge('hoy', lista.length);

  if (!lista.length) {
    el.innerHTML = emptyHTML('🎉','Sin cobros para hoy','¡Disfrutá el día libre!');
    return;
  }
  const totalHoy = lista.reduce((s,c)=>s+Number(c.monto||0),0);
  el.innerHTML = `<div class="fadeIn">
    <div style="font-size:13px;color:var(--muted);margin-bottom:10px;text-align:center">${lista.length} cuota${lista.length>1?'s':''} · ${fmtMoney(totalHoy)}</div>
    <button class="btn btn-gold btn-full" style="margin-bottom:14px" onclick="marcarTodasHoy()">⚡ Marcar TODAS como Pagadas (Efectivo)</button>
    ${lista.map(c => cuotaItemHTML(c, 'hoy')).join('')}
  </div>`;
}

async function marcarTodasHoy() {
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  const lista = cuotas.filter(c => {
    if (c.estado === 'Pagado') return false;
    const v = parseDate(c.fechaVenc);
    return v && v.getTime() === hoy.getTime();
  });
  if (!lista.length) { toast('ℹ️ No hay cuotas para hoy'); return; }
  const fecha = new Date().toISOString().split('T')[0];
  const preIds = new Set();
  for (const c of lista) {
    c.estado = 'Pagado';
    c.fechaPago = new Date(fecha+'T12:00:00').toISOString();
    c.metodo = 'Efectivo';
    c.updatedAt = new Date().toISOString();
    await dbPut('cuotas', c);
    preIds.add(c.prestamoId);
  }
  for (const pid of preIds) await syncEstadoPrestamo(pid);
  pushInmediato(); // sync inmediato a Firebase
  toast(`✅ ${lista.length} cuota${lista.length>1?'s':''} marcadas como Pagadas`);
  await renderHoy();
  await updateBadges();
  if (curPage === 'dashboard') await renderDashboard();
}

/* ---- ATRASADAS ---- */
async function renderAtrasadas() {
  const el = document.getElementById('pg-atrasadas');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  const lista = cuotas.filter(c => {
    if (c.estado === 'Pagado') return false;
    const v = parseDate(c.fechaVenc);
    return v && v.getTime() < hoy.getTime();
  }).map(c => {
    const v = parseDate(c.fechaVenc);
    c._dias = Math.floor((hoy - v) / 86400000);
    return c;
  }).sort((a,b) => b._dias - a._dias);

  setBadge('atr', lista.length);

  if (!lista.length) {
    el.innerHTML = emptyHTML('🎉','Sin cuotas atrasadas','¡Todo en orden!');
    return;
  }
  const total = lista.reduce((s,c)=>s+Number(c.monto||0),0);
  el.innerHTML = `<div class="fadeIn">
    <div style="font-size:13px;color:var(--red);margin-bottom:12px;text-align:center;font-weight:700">${lista.length} cuotas · ${fmtMoney(total)} pendientes</div>
    ${lista.map(c => cuotaItemHTML(c, 'atr')).join('')}
  </div>`;
}

function cuotaItemHTML(c, tipo) {
  const bCls = tipo === 'atr' ? 'bg-red' : 'bg-yel';
  const lCls = tipo === 'atr' ? 'lred' : 'lgold';
  const info = tipo === 'atr'
    ? `${c._dias} día${c._dias>1?'s':''} de atraso`
    : `Vence hoy`;
  return `<div class="li ${lCls}" id="li-${esc(c.id)}">
    <div class="li-row">
      <div class="li-name">${esc(c.clienteNombre)}</div>
      <span class="badge ${bCls}">${info}</span>
    </div>
    <div class="li-sub">Cuota ${c.nro} · ${esc(c.prestamoId)} · Venc: ${fmtDate(c.fechaVenc)}</div>
    <div class="li-row" style="margin-top:8px">
      <div style="font-size:12px;color:var(--muted)">A cobrar</div>
      <div class="li-amt">${fmtMoney(c.monto)}</div>
    </div>
    <button class="btn btn-gold btn-full" style="margin-top:10px" onclick="abrirPago('${esc(c.id)}')">💵 Marcar Pagada</button>
  </div>`;
}

/* ---- CLIENTES ---- */
async function renderClientes() {
  const el = document.getElementById('pg-clientes');
  const lista = await dbAll('clientes');
  lista.sort((a,b) => a.nombre > b.nombre ? 1 : -1);

  if (!lista.length) {
    el.innerHTML = emptyHTML('👤','Sin clientes','Tocá ＋ para agregar tu primer cliente.');
    return;
  }

  el.innerHTML = `<div class="fadeIn">
    <input class="srch" placeholder="Buscar cliente..." oninput="filterClientes(this.value)">
    <div id="cli-list">${lista.map(cliItemHTML).join('')}</div>
  </div>`;
  el._data = lista;
}

function filterClientes(q) {
  const el = document.getElementById('pg-clientes');
  const ql = q.toLowerCase();
  const lista = (el._data||[]).filter(c =>
    c.nombre.toLowerCase().includes(ql) ||
    (c.dni||'').includes(q) ||
    (c.telefono||'').includes(q) ||
    (c.direccion||'').toLowerCase().includes(ql)
  );
  const ct = document.getElementById('cli-list');
  if (ct) ct.innerHTML = lista.length ? lista.map(cliItemHTML).join('') : emptyHTML('🔍','Sin resultados','');
}

function cliItemHTML(c) {
  const rMap = {Bajo:'bg-grn',Medio:'bg-yel',Alto:'bg-red'};
  const eCls = c.estado==='Activo' ? 'bg-blu' : 'bg-muted';
  const subInfo = [
    c.dni ? '🪪 ' + esc(c.dni) : '',
    c.telefono ? '📞 ' + esc(c.telefono) : '',
    c.direccion ? '📍 ' + esc(c.direccion) : ''
  ].filter(Boolean).join(' · ') || 'Sin datos';
  return `<div class="li lblue" onclick="openClienteDetail('${esc(c.id)}')">
    <div class="li-row">
      <div style="display:flex;gap:10px;align-items:center">
        <div class="ava" style="width:38px;height:38px;font-size:15px">${esc(c.nombre).charAt(0).toUpperCase()}</div>
        <div>
          <div class="li-name">${esc(c.nombre)}</div>
          <div class="li-sub">${subInfo}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        <span class="badge ${eCls}">${c.estado}</span>
        <span class="badge ${rMap[c.riesgo]||'bg-muted'}">${c.riesgo||'—'}</span>
      </div>
    </div>
  </div>`;
}

/* ---- PRÉSTAMOS ---- */
let loanExpanded = null; // id del préstamo actualmente expandido

async function renderPrestamos() {
  const el = document.getElementById('pg-prestamos');
  const [listaCompleta, todasCuotas] = await Promise.all([dbAll('prestamos'), dbAll('cuotas')]);
  listaCompleta.sort((a,b) => new Date(b.fecha||0) - new Date(a.fecha||0));

  if (!listaCompleta.length) {
    el.innerHTML = emptyHTML('📋','Sin préstamos','Tocá ＋ para crear el primer préstamo.');
    return;
  }

  // Por defecto NO mostramos Pagados ni Cancelados en la vista principal
  // (se ven en el Historial). Pero quedan contabilizados en los badges.
  const lista = listaCompleta.filter(p => p.estado !== 'Pagado' && p.estado !== 'Cancelado');

  const activos    = listaCompleta.filter(p=>p.estado==='Activo').length;
  const atrasados  = listaCompleta.filter(p=>p.estado==='Atrasado').length;
  const pagados    = listaCompleta.filter(p=>p.estado==='Pagado').length;
  const cancelados = listaCompleta.filter(p=>p.estado==='Cancelado').length;
  const semanales  = listaCompleta.filter(p=>p.tipo==='Semanal' && p.estado!=='Pagado' && p.estado!=='Cancelado').length;
  const mensuales  = listaCompleta.filter(p=>p.tipo==='Mensual' && p.estado!=='Pagado' && p.estado!=='Cancelado').length;

  el.innerHTML = `<div class="fadeIn">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px" id="prest-filtros">
      <button class="pf-btn on" onclick="filtrarPrestamos('activos',this)">
        <span style="font-size:15px">📋</span>
        <div style="font-size:11px;font-weight:700">Activos</div>
        <div style="font-size:16px;font-weight:900;color:var(--txt)">${lista.length}</div>
      </button>
      <button class="pf-btn" onclick="filtrarPrestamos('Activo',this)" style="--pf:var(--money)">
        <span style="font-size:15px">⚡</span>
        <div style="font-size:11px;font-weight:700">Al día</div>
        <div style="font-size:16px;font-weight:900;color:var(--money)">${activos}</div>
      </button>
      <button class="pf-btn" onclick="filtrarPrestamos('Atrasado',this)" style="--pf:var(--red)">
        <span style="font-size:15px">⚠️</span>
        <div style="font-size:11px;font-weight:700">Atrasados</div>
        <div style="font-size:16px;font-weight:900;color:var(--red)">${atrasados}</div>
      </button>
      <button class="pf-btn" onclick="filtrarPrestamos('Pagado',this)" style="--pf:var(--grn)">
        <span style="font-size:15px">✅</span>
        <div style="font-size:11px;font-weight:700">Pagados</div>
        <div style="font-size:16px;font-weight:900;color:var(--grn)">${pagados}</div>
      </button>
      <button class="pf-btn" onclick="filtrarPrestamos('Semanal',this)" style="--pf:var(--gold)">
        <span style="font-size:15px">📆</span>
        <div style="font-size:11px;font-weight:700">Semanales</div>
        <div style="font-size:16px;font-weight:900;color:var(--gold)">${semanales}</div>
      </button>
      <button class="pf-btn" onclick="filtrarPrestamos('Mensual',this)" style="--pf:var(--gold)">
        <span style="font-size:15px">📅</span>
        <div style="font-size:11px;font-weight:700">Mensuales</div>
        <div style="font-size:16px;font-weight:900;color:var(--gold)">${mensuales}</div>
      </button>
    </div>
    ${pagados > 0 ? `<div style="font-size:11px;color:var(--muted);text-align:center;margin-bottom:10px">💡 Los ${pagados} préstamo${pagados>1?'s':''} pagado${pagados>1?'s':''} se ven en <b onclick="goPage('historial')" style="color:var(--gold);cursor:pointer;text-decoration:underline">Historial</b></div>` : ''}
    <div id="prest-list">${lista.length ? lista.map(p => loanItemHTML(p, todasCuotas)).join('') : emptyHTML('🎉','Sin préstamos activos','Todos al día.')}</div>
  </div>`;
  el._data = listaCompleta;
  el._cuotas = todasCuotas;
}

function filtrarPrestamos(filtro, btn) {
  const el = document.getElementById('pg-prestamos');
  document.querySelectorAll('#prest-filtros .pf-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  const lista = (el._data||[]);
  const cuotas = (el._cuotas||[]);
  let filtrada;
  if (filtro === 'activos') filtrada = lista.filter(p => p.estado !== 'Pagado' && p.estado !== 'Cancelado');
  else if (filtro === 'todos') filtrada = lista;
  else if (filtro === 'Semanal' || filtro === 'Mensual') filtrada = lista.filter(p => p.tipo === filtro && p.estado !== 'Cancelado');
  else filtrada = lista.filter(p => p.estado === filtro);
  const listEl = document.getElementById('prest-list');
  if (listEl) listEl.innerHTML = filtrada.length
    ? filtrada.map(p => loanItemHTML(p, cuotas)).join('')
    : emptyHTML('🔍','Sin resultados','');
}

function toggleLoan(id) {
  const body = document.getElementById('lc-' + id);
  const icon = document.getElementById('lt-' + id);
  if (!body) return;
  const isOpen = body.classList.contains('on');
  // Cerrar el anterior si es diferente
  if (loanExpanded && loanExpanded !== id) {
    const prevBody = document.getElementById('lc-' + loanExpanded);
    const prevIcon = document.getElementById('lt-' + loanExpanded);
    if (prevBody) prevBody.classList.remove('on');
    if (prevIcon) prevIcon.classList.remove('on');
  }
  if (isOpen) {
    body.classList.remove('on');
    icon.classList.remove('on');
    loanExpanded = null;
  } else {
    body.classList.add('on');
    icon.classList.add('on');
    loanExpanded = id;
  }
}

function loanItemHTML(p, todasCuotas) {
  const clsMap  = { Activo:'lgold', Atrasado:'lred', Pagado:'lgrn', Cancelado:'lblue' };
  const badgeMap = { Activo:'bg-blu', Atrasado:'bg-red', Pagado:'bg-grn', Cancelado:'bg-muted' };
  const misCuotas = (todasCuotas||[]).filter(c=>c.prestamoId===p.id).sort((a,b)=>a.nro-b.nro);
  const pagadas = misCuotas.filter(c=>c.estado==='Pagado').length;
  const pct = misCuotas.length ? Math.round(pagadas/misCuotas.length*100) : 0;
  const pbarCls = pct===100 ? 'pg' : p.estado==='Atrasado' ? 'pr' : 'py';
  const isOpen = loanExpanded === p.id;

  const cuotasHTML = misCuotas.map(c => {
    const stMap={Pagado:'cpag',Pendiente:'cpen',Atrasado:'catr'};
    const bMap={Pagado:'bg-grn',Pendiente:'bg-yel',Atrasado:'bg-red'};
    const pagBtn = c.estado !== 'Pagado'
      ? `<button class="btn btn-grn btn-sm" style="margin-top:6px" onclick="event.stopPropagation();abrirPago('${esc(c.id)}')">✅ Pagar</button>`
      : `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <span style="font-size:11px;color:var(--grn)">✅ ${fmtDate(c.fechaPago)} · ${esc(c.metodo||'')}</span>
          <button class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px" onclick="event.stopPropagation();imprimirComprobante('${esc(c.id)}')">🎫 Ver ticket</button>
        </div>`;
    return `<div class="ci ${stMap[c.estado]||'cpen'}" id="ci-${esc(c.id)}">
      <div class="ci-row">
        <div><div class="ci-n">Cuota ${c.nro}</div><div class="ci-info">Vence: ${fmtDate(c.fechaVenc)}</div></div>
        <div style="text-align:right"><div class="ci-amt">${fmtMoney(c.monto)}</div>
          <span class="badge ${bMap[c.estado]||'bg-muted'}" style="font-size:10px;padding:2px 7px">${c.estado}</span></div>
      </div>
      ${pagBtn}
    </div>`;
  }).join('');

  return `<div class="li ${clsMap[p.estado]||'lblue'}" style="cursor:default">
    <div class="loan-hdr li-row" onclick="toggleLoan('${esc(p.id)}')">
      <div style="flex:1;min-width:0">
        <div class="li-name">${esc(p.clienteNombre)}</div>
        <div class="li-sub">${p.id} · ${fmtDate(p.fecha)} · ${p.tipo}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span class="badge ${badgeMap[p.estado]||'bg-muted'}">${p.estado}</span>
        <span class="loan-toggle${isOpen?' on':''}" id="lt-${esc(p.id)}">▼</span>
      </div>
    </div>
    <div class="chips" style="pointer-events:none">
      <div class="chip">Prestado<b>${fmtMoney(p.monto)}</b></div>
      <div class="chip">Total<b>${fmtMoney(p.total)}</b></div>
      <div class="chip">Cuota<b>${fmtMoney(p.cuota)}</b></div>
      <div class="chip">${p.nCuotas} cuotas<b>${
        p.interesPorCuota != null
          ? `${p.interesPorCuota}%/${p.tipo==='Semanal'?'sem':'mes'}`
          : `+${Math.round(Number(p.interes||0)*100)}%`
      }</b></div>
    </div>
    <div class="pbar" style="margin-top:8px;pointer-events:none"><div class="pbar-fill ${pbarCls}" style="width:${pct}%"></div></div>
    <div style="font-size:10px;color:var(--muted);margin-top:3px;text-align:right;pointer-events:none">${pagadas}/${misCuotas.length} pagadas (${pct}%)</div>
    <div class="loan-cuotas${isOpen?' on':''}" id="lc-${esc(p.id)}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;color:var(--muted)">CUOTAS (${misCuotas.length})</span>
        <button class="btn btn-sm btn-red" onclick="event.stopPropagation();confirmarBorrarPrestamo('${esc(p.id)}')">🗑️ Eliminar</button>
      </div>
      ${misCuotas.length ? cuotasHTML : '<div style="font-size:13px;color:var(--muted);text-align:center">Sin cuotas generadas</div>'}
    </div>
  </div>`;
}

/* ---- CUOTAS ---- */
let cuotaFiltro = 'Activas'; // por defecto solo activas (no pagadas)
let cuotaFiltroPrestamo = ''; // filtro por préstamo específico (vacío = todos)

async function renderCuotas() {
  const el = document.getElementById('pg-cuotas');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  const cuotas = await dbAll('cuotas');
  const prestamos = await dbAll('prestamos');
  const hoy = today();

  // Calcular días de atraso
  cuotas.forEach(c => {
    const v = parseDate(c.fechaVenc);
    c._diasAtr = (v && c.estado !== 'Pagado' && hoy > v)
      ? Math.floor((hoy - v) / 86400000) : 0;
  });

  const counts = {
    Activas:   cuotas.filter(c=>c.estado!=='Pagado').length,
    Pendiente: cuotas.filter(c=>c.estado==='Pendiente').length,
    Atrasado:  cuotas.filter(c=>c.estado==='Atrasado').length
  };

  // Aplicar filtros
  let filtrada;
  if (cuotaFiltro === 'Activas') filtrada = cuotas.filter(c => c.estado !== 'Pagado');
  else filtrada = cuotas.filter(c => c.estado === cuotaFiltro);

  // Filtro adicional por préstamo
  if (cuotaFiltroPrestamo) {
    filtrada = filtrada.filter(c => c.prestamoId === cuotaFiltroPrestamo);
  }

  const filtroHTML = ['Activas','Pendiente','Atrasado'].map(f => {
    const on = cuotaFiltro === f ? ' on' : '';
    return `<button class="ftab${on}" onclick="setCuotaFiltro('${f}')">${f} (${counts[f]})</button>`;
  }).join('');

  // Dropdown filtro por préstamo (solo préstamos activos)
  const prestamosActivos = prestamos
    .filter(p => p.estado !== 'Pagado' && p.estado !== 'Cancelado')
    .sort((a,b) => (a.clienteNombre||'').localeCompare(b.clienteNombre||''));
  const prestamoFiltroHTML = prestamosActivos.length ? `
    <div style="margin:10px 0 12px">
      <select class="inp" onchange="setCuotaFiltroPrestamo(this.value)" style="font-size:13px">
        <option value="">📋 Todos los préstamos</option>
        ${prestamosActivos.map(p => `
          <option value="${esc(p.id)}" ${cuotaFiltroPrestamo === p.id ? 'selected' : ''}>
            ${esc(p.clienteNombre)} — ${esc(p.id)} (${p.nCuotas} cuotas)
          </option>
        `).join('')}
      </select>
    </div>` : '';

  const linkHistorial = `<div style="text-align:center;margin:6px 0 12px"><button class="btn btn-ghost btn-sm" style="font-size:12px;padding:6px 14px" onclick="goPage('historial')">📈 Ver cuotas pagadas en Historial</button></div>`;

  if (!filtrada.length) {
    el.innerHTML = `<div class="fadeIn">
      <div class="ftabs">${filtroHTML}</div>
      ${prestamoFiltroHTML}
      ${emptyHTML('🎉','Sin cuotas activas','Todo al día.')}
      ${linkHistorial}
    </div>`;
    return;
  }

  // Agrupar por cliente, ordenar: atrasados primero, luego por nombre
  const porCliente = {};
  filtrada.forEach(c => {
    const key = c.clienteId || c.clienteNombre || '—';
    if (!porCliente[key]) porCliente[key] = { nombre: c.clienteNombre || '—', clienteId: c.clienteId, cuotas: [] };
    porCliente[key].cuotas.push(c);
  });

  // Ordenar cuotas dentro de cada cliente: atrasadas primero, luego por fecha
  Object.values(porCliente).forEach(g => {
    g.cuotas.sort((a,b) => {
      if (a._diasAtr !== b._diasAtr) return b._diasAtr - a._diasAtr;
      return new Date(a.fechaVenc||0) - new Date(b.fechaVenc||0);
    });
    g.atrasadas  = g.cuotas.filter(c=>c.estado==='Atrasado').length;
    g.pendientes = g.cuotas.filter(c=>c.estado==='Pendiente').length;
    g.pagadas    = g.cuotas.filter(c=>c.estado==='Pagado').length;
    g.totalPend  = g.cuotas.filter(c=>c.estado!=='Pagado').reduce((s,c)=>s+Number(c.monto||0),0);
  });

  // Ordenar grupos: con atrasadas primero, luego por nombre
  const grupos = Object.values(porCliente).sort((a,b) => {
    if (a.atrasadas !== b.atrasadas) return b.atrasadas - a.atrasadas;
    return a.nombre.localeCompare(b.nombre);
  });

  const gruposHTML = grupos.map((g, idx) => {
    const abierto = idx === 0; // primer cliente abierto por defecto
    const gId = 'cg-' + (g.clienteId || idx);
    const tagAtr = g.atrasadas > 0
      ? `<span class="badge bg-red" style="font-size:10px">${g.atrasadas} atr.</span>` : '';
    const tagPend = g.pendientes > 0
      ? `<span class="badge bg-yel" style="font-size:10px">${g.pendientes} pend.</span>` : '';
    const tagPag = g.pagadas > 0
      ? `<span class="badge bg-grn" style="font-size:10px">${g.pagadas} pag.</span>` : '';

    const cuotasHTML = g.cuotas.map(c => {
      const bMap = { Pagado:'bg-grn', Pendiente:'bg-yel', Atrasado:'bg-red' };
      const lMap = { Pagado:'lgrn', Pendiente:'lgold', Atrasado:'lred' };
      const atrTag = c._diasAtr > 0
        ? `<span class="badge bg-red" style="font-size:9px;margin-left:4px">${c._diasAtr}d</span>` : '';
      const pagBtn = c.estado !== 'Pagado'
        ? `<div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-grn btn-sm" style="flex:1" onclick="abrirPago('${esc(c.id)}')">✅ Pagar</button>
            <button class="btn btn-ghost btn-sm" onclick="enviarWACuota('${esc(c.id)}')">💬</button>
           </div>`
        : `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">
            <span style="font-size:11px;color:var(--grn);flex:1;min-width:140px">✅ ${fmtDate(c.fechaPago)} · ${esc(c.metodo||'')}</span>
            <button class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px" onclick="imprimirComprobante('${esc(c.id)}')">🎫 Ver ticket</button>
           </div>`;

      return `<div class="li ${lMap[c.estado]||'lgold'}" id="li-${esc(c.id)}" style="margin-bottom:8px">
        <div class="li-row">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">Cuota ${c.nro}${atrTag}</div>
            <div class="li-sub">Vence: ${fmtDate(c.fechaVenc)} · ${esc(c.prestamoId)}</div>
          </div>
          <div style="text-align:right">
            <div class="li-amt">${fmtMoney(c.monto)}</div>
            <span class="badge ${bMap[c.estado]||'bg-muted'}" style="font-size:10px">${c.estado}</span>
          </div>
        </div>
        ${pagBtn}
      </div>`;
    }).join('');

    return `
      <div class="card" style="margin-bottom:10px;padding:0">
        <button onclick="toggleCuotaGrupo('${gId}')"
          style="width:100%;background:none;border:none;padding:14px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px">
          <div class="ava" style="width:38px;height:38px;font-size:16px;flex-shrink:0">${g.nombre.charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:800;color:var(--txt)">${esc(g.nombre)}</div>
            <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">${tagAtr}${tagPend}${tagPag}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${g.totalPend > 0 ? `<div style="font-size:12px;font-weight:800;color:var(--money)">${fmtMoney(g.totalPend)}</div>` : ''}
            <span id="${gId}-ic" style="font-size:14px;color:var(--muted)">${abierto ? '▲' : '▼'}</span>
          </div>
        </button>
        <div id="${gId}" style="padding:0 14px 14px;${abierto ? '' : 'display:none'}">
          ${cuotasHTML}
        </div>
      </div>`;
  }).join('');

  const totalPend = filtrada.filter(c=>c.estado!=='Pagado').reduce((s,c)=>s+Number(c.monto||0),0);

  el.innerHTML = `<div class="fadeIn">
    <div class="ftabs">${filtroHTML}</div>
    ${prestamoFiltroHTML}
    ${totalPend > 0 ? `<div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:12px">
      ${filtrada.length} cuota${filtrada.length!==1?'s':''} · Pendiente: <span style="color:var(--money);font-weight:700">${fmtMoney(totalPend)}</span>
    </div>` : ''}
    ${gruposHTML}
    ${linkHistorial}
  </div>`;
}

function toggleCuotaGrupo(gId) {
  const body = document.getElementById(gId);
  const ic   = document.getElementById(gId + '-ic');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (ic) ic.textContent = isOpen ? '▼' : '▲';
}

function setCuotaFiltro(f) {
  cuotaFiltro = f;
  renderCuotas();
}

function setCuotaFiltroPrestamo(prestamoId) {
  cuotaFiltroPrestamo = prestamoId || '';
  renderCuotas();
}

/* ---- CONFIG ---- */
async function renderConfig() {
  const el = document.getElementById('pg-config');
  const waPhone  = await getConfig('waPhone')  || '';
  const waApikey = await getConfig('waApikey') || '';
  const notifPerm = Notification.permission || 'default';
  const authCred = await authGetCred();

  el.innerHTML = `<div class="fadeIn">
    <div class="cfg-section">🔔 Notificaciones del sistema</div>
    <div class="card" style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:12px">
      Recibí alertas automáticas cuando tengas cuotas que vencen hoy o atrasadas. Funciona aunque tengas la app cerrada.
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-size:14px;font-weight:700">Estado: <span style="color:${notifPerm==='granted'?'var(--grn)':notifPerm==='denied'?'var(--red)':'var(--muted)'}">${notifPerm==='granted'?'✅ Activas':notifPerm==='denied'?'🚫 Bloqueadas':'⏳ Sin configurar'}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Revisión automática cada 30 minutos</div>
      </div>
      ${notifPerm!=='granted'?`<button class="btn btn-gold btn-sm" onclick="pedirPermiso()">Activar</button>`:`<button class="btn btn-ghost btn-sm" onclick="checkNotificaciones()">Probar</button>`}
    </div>

    <div class="cfg-section">📱 Notificaciones WhatsApp</div>
    <div class="wa-step">
      <div class="wa-step-n">Paso 1 — Activar CallMeBot (gratis)</div>
      <div class="wa-step-t">Enviá este mensaje exacto por WhatsApp al número <b>+34 644 65 21 18</b>:</div>
      <div class="wa-code">I allow callmebot to send me messages</div>
      <div class="wa-step-t">En ≤2 minutos te llegará tu <b>API Key</b> por WhatsApp.</div>
    </div>
    <div class="field">
      <label class="lbl">Tu número (con código de país, sin +)</label>
      <input class="inp" id="wa-phone" value="${esc(waPhone)}" placeholder="5493834123456" type="tel">
      <div style="font-size:11px;color:var(--muted);margin-top:5px">Argentina: 549 + área sin 0 + número sin 15</div>
    </div>
    <div class="field">
      <label class="lbl">API Key de CallMeBot</label>
      <input class="inp" id="wa-apikey" value="${esc(waApikey)}" placeholder="Ej: 1234567">
    </div>
    <button class="btn btn-gold btn-full" onclick="saveWhatsApp()">💾 Guardar WhatsApp</button>
    <button class="btn btn-ghost btn-full" style="margin-top:10px" onclick="testWA()">📤 Enviar mensaje de prueba</button>
    <button class="btn btn-ghost btn-full" style="margin-top:10px" onclick="enviarResumenWA()">📊 Enviar resumen ahora</button>

    <div class="cfg-section" style="margin-top:24px">📄 Exportar datos</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <button class="btn btn-ghost" onclick="exportarPDF()">📄 PDF Reporte</button>
      <button class="btn btn-ghost" onclick="exportarBackup()">📤 Backup JSON</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <button class="btn btn-ghost" onclick="exportarExcel()">📊 Excel</button>
      <button class="btn btn-ghost" onclick="document.getElementById('imp-excel-file').click()">📥 Importar Excel</button>
    </div>
    <button class="btn btn-grn btn-full" style="margin-top:10px" onclick="exportarGoogleSheets()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2" fill="#0F9D58"/><path d="M7 8h10M7 12h10M7 16h6" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>
      Exportar a Google Sheets
    </button>
    <button class="btn btn-ghost btn-full" style="margin-top:10px" onclick="document.getElementById('imp-file').click()">📥 Importar Backup JSON</button>
    <input type="file" id="imp-file" accept=".json" style="display:none" onchange="importarBackup(this)">
    <div style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.5">
      El Excel y Google Sheets exportan: Clientes, Préstamos, Cuotas, Vista por Cliente, Dashboard y Bitácora con formato y colores. Google Sheets requiere Drive conectado.
    </div>

    <div class="cfg-section" style="margin-top:24px">🔥 Firebase — Sync en Tiempo Real</div>
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.6">
        Tus datos se sincronizan automáticamente con Firebase. Ingresá desde cualquier dispositivo con el mismo usuario y contraseña.
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;margin-bottom:12px">
        Estado: <span id="cfg-drive-estado">⚪ Verificando...</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn btn-gold" onclick="driveAutoSync()">🔄 Sincronizar</button>
        <button class="btn btn-ghost" onclick="driveGuardarAhora()">📤 Guardar ahora</button>
      </div>
      <div style="margin-top:10px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Última sincronización:</div>
        <div id="cfg-drive-sync" style="font-size:12px;color:var(--grn)">—</div>
      </div>
    </div>

    <div class="cfg-section" style="margin-top:24px">📲 Instalar App en el celular</div>
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.6">
        Instalá la app en tu pantalla de inicio para usarla como una app nativa, sin abrir el navegador.
      </div>
      <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="instalarAppEnCelular()">📲 Instalar en este dispositivo</button>
      <div style="font-size:11px;color:var(--muted);line-height:1.5">
        Si el botón no funciona: Chrome → ⋮ (tres puntos) → "Agregar a pantalla de inicio"
      </div>
    </div>

    <div class="cfg-section" style="margin-top:24px">ℹ️ Acerca de</div>
    <div class="card" style="font-size:13px;color:var(--muted);line-height:1.8">
      <b style="color:var(--txt)">PrestControl v1.0</b><br>
      📱 PWA instalable — funciona sin internet<br>
      👥 Multi-usuario — cada uno ve sus propios datos<br>
      ☁️ Google Drive — respaldo automático en la nube<br>
      🔐 Login + bloqueo por inactividad + primer ingreso seguro<br>
      🪪 DNI en clientes · búsqueda por DNI<br>
      💬 WhatsApp directo · 📋 Bitácora · 📈 Historial<br>
      📊 Excel · 🖨️ Comprobantes PDF · 🔔 Notificaciones<br>
      💰 Interés por cuota (semanal/mensual)<br>
      📤 Backup / restauración JSON<br><br>
      <b>Instalar en Android:</b> Chrome → ⋮ → "Agregar a pantalla de inicio"
      📱 PWA instalable — funciona sin internet<br>
      👥 Multi-usuario — cada uno ve sus propios datos<br>
      ☁️ Google Drive — respaldo automático en la nube<br>
      🔐 Login + bloqueo por inactividad (5 min)<br>
      🪪 DNI en clientes · búsqueda por DNI<br>
      💬 WhatsApp directo · 📋 Bitácora · 📈 Historial<br>
      📊 Excel · 🖨️ Comprobantes PDF · 🔔 Notificaciones<br>
      <br>
      <button class="btn btn-red btn-sm" onclick="cerrarSesion()">🚪 Cerrar sesión</button>
    </div>

    <div class="cfg-section" style="margin-top:24px">🖼️ Foto de Perfil</div>
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
        <div id="cfg-foto-preview" style="width:64px;height:64px;border-radius:50%;background:var(--card2);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:24px;overflow:hidden;flex-shrink:0">👤</div>
        <div>
          <div style="font-size:13px;font-weight:700;margin-bottom:4px">Foto de perfil</div>
          <div style="font-size:12px;color:var(--muted);line-height:1.5">Se muestra en el badge superior.<br>Máx. 500 KB · JPG o PNG</div>
        </div>
      </div>
      <label class="btn btn-ghost btn-full" style="cursor:pointer;text-align:center">
        📷 Elegir foto
        <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none"
          onchange="subirFotoPerfil(this);actualizarPreviewFoto(this)">
      </label>
    </div>

    <div class="cfg-section" style="margin-top:24px">🔐 Seguridad y Acceso</div>
    <!-- HUELLA DIGITAL -->
    <div class="card" style="margin-bottom:12px" id="card-huella">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="font-size:28px">👆</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--txt)">Huella digital / Face ID</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">Ingresá sin escribir contraseña</div>
        </div>
        <div id="huella-estado" style="margin-left:auto;font-size:12px;font-weight:700"></div>
      </div>
      <div id="huella-info" style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5"></div>
      <button class="btn btn-grn btn-full" id="btn-reg-huella" onclick="registrarHuella()" style="margin-bottom:8px">
        👆 Activar huella digital
      </button>
      <button class="btn btn-red btn-full" id="btn-del-huella" onclick="eliminarHuella()" style="display:none">
        🗑️ Desactivar huella
      </button>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--muted);margin-bottom:14px">Cambiá tu usuario y contraseña de ingreso</div>
      <div class="field"><label class="lbl">Contraseña actual *</label>
        <div class="pass-wrap">
          <input class="inp" id="sec-pass-actual" type="password" placeholder="Tu contraseña actual">
          <button class="eye-btn" type="button" onclick="toggleEye('sec-pass-actual',this)" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
      </div>
      <div class="field"><label class="lbl">Usuario</label>
        <input class="inp" id="sec-user" placeholder="Tu usuario"></div>
      <div class="field"><label class="lbl">Nueva Contraseña <span style="color:var(--muted);font-size:11px">(dejá vacío para no cambiar)</span></label>
        <div class="pass-wrap">
          <input class="inp" id="sec-pass" type="password" placeholder="Nueva contraseña (mín. 6 caracteres)">
          <button class="eye-btn" type="button" onclick="toggleEye('sec-pass',this)" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
      </div>
      <div class="field"><label class="lbl">Repetir Nueva Contraseña</label>
        <div class="pass-wrap">
          <input class="inp" id="sec-pass2" type="password" placeholder="Repetir nueva contraseña">
          <button class="eye-btn" type="button" onclick="toggleEye('sec-pass2',this)" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
      </div>
      <div class="login-err" id="sec-err" style="margin-bottom:10px">Error</div>
      <button class="btn btn-grn btn-full" onclick="guardarSeguridad()">💾 Guardar Credenciales</button>
    </div>
    <div class="cfg-section" style="margin-top:24px">🔧 Reparación</div>
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px">🔍 Buscar cuotas duplicadas</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
        Analiza tus préstamos y detecta si hay cuotas repetidas (por ej: dos "Cuota 1" del mismo préstamo).<br>
        Te muestra un informe antes de borrar nada.
      </div>
      <button class="btn btn-ghost btn-full" onclick="buscarCuotasDuplicadas()">🔍 Analizar cuotas</button>
    </div>

    <div class="cfg-section" style="margin-top:24px;color:var(--red)">⚠️ Zona de Peligro</div>
    <div class="card" style="border-color:rgba(245,158,11,.3);margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px">📋 Borrar préstamos y cuotas</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
        Borra <b>todos los préstamos y cuotas</b>, pero <b style="color:var(--grn)">conserva los clientes</b>.<br>
        Útil para empezar un nuevo período sin perder la base de clientes.<br>
        <span style="color:var(--yel);font-weight:700">Esta acción es irreversible.</span>
      </div>
      <button class="btn btn-ghost btn-full" style="border-color:rgba(245,158,11,.4);color:var(--yel)" onclick="abrirBorrarPrestamos()">📋 Borrar solo préstamos y cuotas</button>
    </div>
    <div class="card" style="border-color:rgba(239,68,68,.3);margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px">🗑️ Resetear aplicación</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
        Borra <b>todos</b> los clientes, préstamos, cuotas y bitácora de este usuario.<br>
        Los datos no se pueden recuperar salvo que tengas un backup.<br>
        <span style="color:var(--red);font-weight:700">Esta acción es irreversible.</span>
      </div>
      <button class="btn btn-red btn-full" onclick="abrirResetApp()">🗑️ Resetear todos los datos</button>
    </div>
  </div>`;
  // Populate current username
  const secUserEl = document.getElementById('sec-user');
  if (secUserEl) secUserEl.value = authCred.user || currentUser || '';

  // Estado Firebase
  const estadoEl = document.getElementById('cfg-drive-estado');
  if (estadoEl) estadoEl.textContent = _fbUser ? '🟢 Conectado a Firebase' : '⚪ Sin conexión';

  // Last sync
  const lastSync = await getGlobalConfig('drive_last_sync_' + currentUser);
  const syncEl = document.getElementById('cfg-drive-sync');
  if (syncEl && lastSync) {
    syncEl.textContent = '✅ ' + new Date(lastSync).toLocaleString('es-AR');
  }

  // Foto de perfil — mostrar en el preview de Config
  const fotoGuardada = await getGlobalConfig('foto_perfil_' + currentUser).catch(() => null);
  const prevEl = document.getElementById('cfg-foto-preview');
  if (prevEl) {
    if (fotoGuardada) {
      prevEl.innerHTML = `<img src="${fotoGuardada}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      const inicial = (currentUser || '?')[0].toUpperCase();
      const colors  = ['#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B','#EF4444'];
      const color   = colors[inicial.charCodeAt(0) % colors.length];
      prevEl.innerHTML = `<span style="font-size:24px;font-weight:700;color:${color}">${inicial}</span>`;
    }
  }

  // Huella digital
  actualizarUIHuella();
}

/* =====================================================
   CLIENTE DETAIL
===================================================== */
async function openClienteDetail(id) {
  document.getElementById('pg-cliente-detail').innerHTML = '<div class="loader"><div class="spin"></div></div>';
  goDetail('cliente-detail');
  document.getElementById('hdr-title').textContent = '👤 Detalle Cliente';

  const [cliente, prestamos, cuotas] = await Promise.all([
    dbGet('clientes', id), dbAll('prestamos'), dbAll('cuotas')
  ]);

  if (!cliente) { toast('Cliente no encontrado'); goBack(); return; }

  const misPrestamos = prestamos.filter(p => p.clienteId === id);
  const misCuotas    = cuotas.filter(c => c.clienteId === id);
  const totalPrestado = misPrestamos.reduce((s,p) => s+Number(p.monto||0), 0);
  const totalDeuda    = misCuotas.filter(c=>c.estado!=='Pagado').reduce((s,c) => s+Number(c.monto||0), 0);
  const totalCobrado  = misCuotas.filter(c=>c.estado==='Pagado').reduce((s,c)=>s+Number(c.monto||0),0);
  const pagosHistorial= misCuotas.filter(c=>c.estado==='Pagado').sort((a,b)=>new Date(b.fechaPago||0)-new Date(a.fechaPago||0));

  // Scoring automático basado en comportamiento real de pagos
  const scoring = calcularScoring(misCuotas);
  // Auto-actualizar riesgo si tiene historial
  if (scoring.autoRiesgo && scoring.autoRiesgo !== cliente.riesgo && misCuotas.length >= 3) {
    cliente.riesgo = scoring.autoRiesgo;
    await dbPut('clientes', { ...cliente, riesgo: scoring.autoRiesgo });
  }

  const rMap = {Bajo:'bg-grn',Medio:'bg-yel',Alto:'bg-red'};
  const eCls = cliente.estado==='Activo' ? 'bg-blu' : 'bg-muted';
  // Contadores de créditos
  const credActivos  = misPrestamos.filter(p=>p.estado==='Activo'||p.estado==='Atrasado').length;
  const credPagados  = misPrestamos.filter(p=>p.estado==='Pagado').length;
  const credTotal    = misPrestamos.length;

  const el = document.getElementById('pg-cliente-detail');
  const waBtn = cliente.telefono
    ? `<button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="abrirWACliente('${esc(id)}')">💬 WhatsApp</button>`
    : '';
  el.innerHTML = `<div class="fadeIn">
    <div class="card" style="display:flex;gap:14px;align-items:center">
      <div class="ava" style="width:56px;height:56px;font-size:24px;background:${scoring.color}">${esc(cliente.nombre).charAt(0).toUpperCase()}</div>
      <div style="flex:1">
        <div style="font-size:20px;font-weight:900">${esc(cliente.nombre)}</div>
        ${cliente.dni ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">🪪 DNI ${esc(cliente.dni)}</div>` : ''}
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span class="badge ${eCls}">${cliente.estado}</span>
          <span class="badge ${rMap[cliente.riesgo]||'bg-muted'}" title="${scoring.detalle}">
            ${scoring.icono} ${scoring.label}
          </span>
          <span style="font-size:11px;color:var(--muted)">📋 ${credTotal} crédito${credTotal!==1?'s':''}</span>
          ${waBtn}
        </div>
      </div>
    </div>
    ${scoring.detalle ? `<div class="card-sm" style="font-size:12px;color:var(--muted);margin-bottom:8px">🎯 ${scoring.detalle}</div>` : ''}
    <div class="info-grid">
      ${cliente.dni ? `<div class="info-cell"><div class="info-lbl">DNI</div><div class="info-val">🪪 ${esc(cliente.dni)}</div></div>` : ''}
      <div class="info-cell"><div class="info-lbl">Teléfono</div><div class="info-val">${esc(cliente.telefono||'—')}</div></div>
      <div class="info-cell"><div class="info-lbl">Dirección</div><div class="info-val">${esc(cliente.direccion||'—')}</div></div>
      <div class="info-cell"><div class="info-lbl">Total prestado</div><div class="info-val" style="color:var(--gold)">${fmtMoney(totalPrestado)}</div></div>
      <div class="info-cell"><div class="info-lbl">Deuda pendiente</div><div class="info-val" style="color:${totalDeuda>0?'var(--red)':'var(--grn)'}">${fmtMoney(totalDeuda)}</div></div>
      <div class="info-cell"><div class="info-lbl">Total cobrado</div><div class="info-val" style="color:var(--grn)">${fmtMoney(totalCobrado)}</div></div>
      <div class="info-cell"><div class="info-lbl">Pagados / Total</div><div class="info-val">${credPagados} / ${credTotal}</div></div>
    </div>
    ${cliente.notas ? `<div class="card-sm" style="font-size:13px;color:var(--muted)">📝 ${esc(cliente.notas)}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <button class="btn btn-ghost" onclick="editarCliente('${esc(id)}')">✏️ Editar</button>
      <button class="btn btn-red" onclick="confirmarBorrarCliente('${esc(id)}')">🗑️ Eliminar</button>
    </div>

    <div class="sec-hdr"><div class="sec-title">Préstamos (${misPrestamos.length})</div></div>
    ${misPrestamos.length ? misPrestamos.map(p => `
      <div class="li ${p.estado==='Atrasado'?'lred':p.estado==='Pagado'?'lgrn':'lgold'}" onclick="openPrestamoDetail('${esc(p.id)}')">
        <div class="li-row">
          <div><div class="li-name">${p.id}</div><div class="li-sub">${fmtDate(p.fecha)} · ${p.tipo} · ${p.nCuotas} cuotas</div></div>
          <span class="badge ${p.estado==='Pagado'?'bg-grn':p.estado==='Atrasado'?'bg-red':'bg-blu'}">${p.estado}</span>
        </div>
        <div class="chips">
          <div class="chip">Total<b>${fmtMoney(p.total)}</b></div>
          <div class="chip">Cuota<b>${fmtMoney(p.cuota)}</b></div>
        </div>
      </div>
    `).join('') : '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px">Sin préstamos</div>'}

    <div class="sec-hdr" style="margin-top:4px"><div class="sec-title">Historial de pagos (${pagosHistorial.length})</div></div>
    <div class="card" style="padding:10px 14px">
      ${pagosHistorial.length ? pagosHistorial.map(c=>`
        <div class="hist-item">
          <div class="hist-dot"></div>
          <div class="hist-body">
            <div class="hist-name">Cuota ${c.nro} · ${esc(c.prestamoId)}</div>
            <div class="hist-meta">${fmtDate(c.fechaPago)} · ${esc(c.metodo||'—')}</div>
          </div>
          <div class="hist-amt">${fmtMoney(c.monto)}</div>
        </div>`).join('')
      : '<div style="font-size:13px;color:var(--muted);text-align:center;padding:10px">Sin pagos aún</div>'}
    </div>
  </div>`;
}

/* =====================================================
   PRÉSTAMO DETAIL
===================================================== */
async function openPrestamoDetail(id) {
  document.getElementById('pg-prestamo-detail').innerHTML = '<div class="loader"><div class="spin"></div></div>';
  goDetail('prestamo-detail');
  document.getElementById('hdr-title').textContent = '💵 Detalle Préstamo';

  const [prestamo, todasCuotas] = await Promise.all([
    dbGet('prestamos', id), dbAll('cuotas')
  ]);

  if (!prestamo) { toast('Préstamo no encontrado'); goBack(); return; }

  const cuotas = todasCuotas.filter(c => c.prestamoId === id)
    .sort((a,b) => a.nro - b.nro);

  const pagadas   = cuotas.filter(c=>c.estado==='Pagado').length;
  const pct       = cuotas.length ? Math.round(pagadas/cuotas.length*100) : 0;
  const pbarCls   = pct===100 ? 'pg' : prestamo.estado==='Atrasado' ? 'pr' : 'py';
  const badgeMap  = {Activo:'bg-blu',Atrasado:'bg-red',Pagado:'bg-grn'};

  const el = document.getElementById('pg-prestamo-detail');
  el.innerHTML = `<div class="fadeIn">
    <div class="card">
      <div class="li-row">
        <div><div style="font-size:18px;font-weight:900">${esc(prestamo.clienteNombre)}</div><div class="li-sub">${prestamo.id} · ${fmtDate(prestamo.fecha)}</div></div>
        <span class="badge ${badgeMap[prestamo.estado]||'bg-muted'}">${prestamo.estado}</span>
      </div>
      <div class="pbar" style="margin-top:12px"><div class="pbar-fill ${pbarCls}" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-top:5px;text-align:right">${pagadas}/${cuotas.length} cuotas pagadas (${pct}%)</div>
    </div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-lbl">Monto prestado</div><div class="info-val" style="color:var(--gold)">${fmtMoney(prestamo.monto)}</div></div>
      <div class="info-cell"><div class="info-lbl">Total a cobrar</div><div class="info-val" style="color:var(--yel)">${fmtMoney(prestamo.total)}</div></div>
      <div class="info-cell"><div class="info-lbl">Cuota</div><div class="info-val" style="color:var(--grn)">${fmtMoney(prestamo.cuota)}</div></div>
      <div class="info-cell"><div class="info-lbl">Interés / Tipo</div><div class="info-val">${
        prestamo.interesPorCuota != null
          ? `${prestamo.interesPorCuota}%/${prestamo.tipo==='Semanal'?'sem':'mes'} · ${Math.round(Number(prestamo.interes||0)*100)}% total`
          : `${Math.round(Number(prestamo.interes||0)*100)}% · ${prestamo.tipo}`
      }</div></div>
      <div class="info-cell"><div class="info-lbl">Ganancia</div><div class="info-val" style="color:var(--grn)">${fmtMoney(prestamo.ganancia)}</div></div>
      <div class="info-cell"><div class="info-lbl">N° cuotas</div><div class="info-val">${prestamo.nCuotas}</div></div>
      ${prestamo.prenda ? `<div class="info-cell" style="grid-column:1/-1"><div class="info-lbl">🏷️ Prenda / Garantía</div><div class="info-val" style="color:var(--yel)">${esc(prestamo.prenda)}</div></div>` : ''}
      ${prestamo.notas ? `<div class="info-cell" style="grid-column:1/-1"><div class="info-lbl">📝 Notas</div><div class="info-val">${esc(prestamo.notas)}</div></div>` : ''}
    </div>
    <button class="btn btn-red btn-full" style="margin-bottom:10px" onclick="confirmarBorrarPrestamo('${esc(id)}')">🗑️ Eliminar préstamo</button>
    <button class="btn btn-ghost btn-full" style="margin-bottom:14px" onclick="imprimirComprobantePrestamo('${esc(id)}')">🖨️ Comprobante del Préstamo</button>

    <div class="sec-hdr"><div class="sec-title">Cuotas (${cuotas.length})</div></div>
    ${cuotas.map(c => cuotaDetailItemHTML(c)).join('')}
  </div>`;
}

function cuotaDetailItemHTML(c) {
  const stMap = {Pagado:'cpag',Pendiente:'cpen',Atrasado:'catr'};
  const badgeMap = {Pagado:'bg-grn',Pendiente:'bg-yel',Atrasado:'bg-red'};
  const pagBtn = c.estado !== 'Pagado'
    ? `<div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-grn btn-sm" style="flex:1" onclick="abrirPago('${esc(c.id)}')">✅ Marcar pagada</button>
        <button class="btn btn-ghost btn-sm" onclick="enviarWACuota('${esc(c.id)}')">💬 WA</button>
       </div>`
    : `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
        <div style="font-size:11px;color:var(--grn)">✅ Pagada ${fmtDate(c.fechaPago)} · ${esc(c.metodo||'')}</div>
        <button class="btn btn-sm btn-ghost" style="padding:5px 10px;font-size:11px" onclick="imprimirComprobante('${esc(c.id)}')">🖨️ Comprobante</button>
       </div>`;
  return `<div class="ci ${stMap[c.estado]||'cpen'}" id="ci-${esc(c.id)}">
    <div class="ci-row">
      <div><div class="ci-n">Cuota ${c.nro}</div><div class="ci-info">Vence: ${fmtDate(c.fechaVenc)}</div></div>
      <div style="text-align:right">
        <div class="ci-amt">${fmtMoney(c.monto)}</div>
        <span class="badge ${badgeMap[c.estado]||'bg-muted'}" style="font-size:10px;padding:2px 7px">${c.estado}</span>
      </div>
    </div>
    ${pagBtn}
  </div>`;
}

