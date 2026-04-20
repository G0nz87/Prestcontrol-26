/* =====================================================
   CALENDARIO
===================================================== */
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelDay = null;

async function renderCalendario() {
  const el = document.getElementById('pg-calendario');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';
  const cuotas = await dbAll('cuotas');
  const hoy = today();

  // Build map: 'YYYY-MM-DD' -> [cuotas]
  const map = {};
  cuotas.forEach(c => {
    const v = parseDate(c.fechaVenc); if (!v) return;
    const key = v.toISOString().split('T')[0];
    if (!map[key]) map[key] = [];
    map[key].push(c);
  });

  buildCalendario(el, map, hoy);
}

function buildCalendario(el, map, hoy) {
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth+1, 0);
  const startDow = firstDay.getDay(); // 0=sun
  const daysInMonth = lastDay.getDate();

  // DOW header
  const dows = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d=>`<div class="cal-dow">${d}</div>`).join('');

  // Days grid
  let days = '';
  // Blanks before first day
  for (let i = 0; i < startDow; i++) days += `<div class="cal-day other-month"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dt    = new Date(calYear, calMonth, d);
    const key   = dt.toISOString().split('T')[0];
    const qs    = map[key] || [];
    const isHoy = dt.getTime() === hoy.getTime();
    const hayAtr= qs.some(c=>c.estado==='Atrasado');
    const hayPen= qs.some(c=>c.estado==='Pendiente'||c.estado==='Atrasado');
    let cls = 'cal-day';
    if (isHoy) cls += ' today';
    if (hayAtr) cls += ' has-atr';
    else if (hayPen) cls += ' has-venc';

    const dots = qs.map(c=>{
      const dc = c.estado==='Pagado'?'cal-dot-g':c.estado==='Atrasado'?'cal-dot-r':'cal-dot-y';
      return `<div class="cal-dot ${dc}"></div>`;
    }).slice(0,4).join('');

    days += `<div class="${cls}" onclick="selCalDay('${key}')">
      <div class="cal-dn" style="${isHoy?'color:var(--gold);font-weight:900':''}">${d}</div>
      ${dots?`<div class="cal-dots">${dots}</div>`:''}
    </div>`;
  }

  // Detail panel
  let detail = '';
  if (calSelDay && map[calSelDay]) {
    const qs = map[calSelDay];
    detail = `<div class="cal-detail-panel fadeIn">
      <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:10px">${fmtDate(calSelDay)} — ${qs.length} cuota${qs.length>1?'s':''}</div>
      ${qs.map(c=>{
        const bMap={Pagado:'bg-grn',Pendiente:'bg-yel',Atrasado:'bg-red'};
        const btn = c.estado!=='Pagado'
          ? `<button class="btn btn-grn btn-sm" onclick="abrirPago('${esc(c.id)}')">✅ Pagar</button>`
          : `<span style="font-size:11px;color:var(--grn)">✅ ${fmtDate(c.fechaPago)}</span>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:800">${esc(c.clienteNombre)}</div>
            <div style="font-size:11px;color:var(--muted)">Cuota ${c.nro} · ${esc(c.prestamoId)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:var(--money)">${fmtMoney(c.monto)}</div>
            <span class="badge ${bMap[c.estado]||'bg-muted'}" style="font-size:10px">${c.estado}</span>
          </div>
          ${btn}
        </div>`;
      }).join('')}
    </div>`;
  }

  el.innerHTML = `<div class="fadeIn">
    <div class="cal-nav">
      <button class="cal-nav-btn" onclick="calMove(-1)">‹</button>
      <div class="cal-month">${monthNames[calMonth]} ${calYear}</div>
      <button class="cal-nav-btn" onclick="calMove(1)">›</button>
    </div>
    <div class="cal-dow-row">${dows}</div>
    <div class="cal-grid">${days}</div>
    ${detail}
    <div style="display:flex;gap:10px;margin-top:12px;font-size:11px;color:var(--muted);justify-content:center">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--yel);margin-right:3px"></span>Vence</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-right:3px"></span>Atrasada</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--grn);margin-right:3px"></span>Pagada</span>
    </div>
  </div>`;
}

function calMove(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  calSelDay = null;
  renderCalendario();
}

async function selCalDay(key) {
  calSelDay = calSelDay === key ? null : key;
  await renderCalendario();
}

