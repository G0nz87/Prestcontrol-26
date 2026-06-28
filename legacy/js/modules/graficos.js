/* =====================================================
   GRÁFICOS
===================================================== */
let chartInstances = {};

async function renderGraficos() {
  const el = document.getElementById('pg-dashboard');
  const [cuotas, clientes, prestamos] = await Promise.all([
    dbAllIncludeDeleted('cuotas'), dbAllIncludeDeleted('clientes'), dbAllIncludeDeleted('prestamos')
  ]);

  // Destroy previous charts
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
  chartInstances = {};

  // Build monthly cobros (last 6 months)
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleDateString('es-AR',{month:'short',year:'2-digit'}), year: d.getFullYear(), month: d.getMonth() });
  }
  const cobrosPorMes = months.map(m => {
    return cuotas.filter(c => {
      if (c.estado !== 'Pagado' || !c.fechaPago) return false;
      const fp = parseDate(c.fechaPago);
      return fp && fp.getFullYear() === m.year && fp.getMonth() === m.month;
    }).reduce((s,c)=>s+Number(c.monto||0),0);
  });

  const pendPorMes = months.map(m => {
    return cuotas.filter(c => {
      if (c.estado === 'Pagado') return false;
      const fv = parseDate(c.fechaVenc);
      return fv && fv.getFullYear() === m.year && fv.getMonth() === m.month;
    }).reduce((s,c)=>s+Number(c.monto||0),0);
  });

  // Riesgo por cliente
  const bajo = clientes.filter(c=>c.riesgo==='Bajo').length;
  const medio= clientes.filter(c=>c.riesgo==='Medio').length;
  const alto = clientes.filter(c=>c.riesgo==='Alto').length;

  // Estado cuotas
  const pag  = cuotas.filter(c=>c.estado==='Pagado').length;
  const pen  = cuotas.filter(c=>c.estado==='Pendiente').length;
  const atr  = cuotas.filter(c=>c.estado==='Atrasado').length;

  el.innerHTML = `<div class="fadeIn">
    <div class="dtabs">
      <button class="dtab" onclick="switchDashTab('global')">🌐 Global</button>
      <button class="dtab" onclick="switchDashTab('cliente')">👤 Cliente</button>
      <button class="dtab on" onclick="switchDashTab('graficos')">📊 Gráficos</button>
    </div>
    <div class="chart-card">
      <div class="chart-title">💵 Cobros vs Pendientes por mes</div>
      <div class="chart-wrap"><canvas id="chart-cobros"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">🎯 Estado de todas las cuotas</div>
      <div class="chart-wrap" style="height:160px"><canvas id="chart-estado"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">👥 Riesgo de clientes</div>
      <div class="chart-wrap" style="height:160px"><canvas id="chart-riesgo"></canvas></div>
    </div>
  </div>`;

  // Chart defaults
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.font.family = "'DM Sans', sans-serif";

  chartInstances.cobros = new Chart(document.getElementById('chart-cobros'), {
    type: 'bar',
    data: {
      labels: months.map(m=>m.label),
      datasets: [
        { label:'Cobrado', data: cobrosPorMes, backgroundColor:'rgba(34,197,94,.7)', borderRadius:6 },
        { label:'Pendiente', data: pendPorMes, backgroundColor:'rgba(251,191,36,.5)', borderRadius:6 }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{labels:{color:'#94A3B8',font:{size:11}}} }, scales:{ x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{font:{size:10}}}, y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{callback:v=>'$'+Number(v).toLocaleString('es-AR',{maximumFractionDigits:0}),font:{size:10}}} } }
  });

  chartInstances.estado = new Chart(document.getElementById('chart-estado'), {
    type: 'doughnut',
    data: {
      labels: ['Pagadas','Pendientes','Atrasadas'],
      datasets: [{ data:[pag,pen,atr], backgroundColor:['rgba(34,197,94,.8)','rgba(251,191,36,.8)','rgba(239,68,68,.8)'], borderWidth:0 }]
    },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{position:'right',labels:{color:'#94A3B8',font:{size:11},padding:8}} } }
  });

  chartInstances.riesgo = new Chart(document.getElementById('chart-riesgo'), {
    type: 'doughnut',
    data: {
      labels: ['Bajo','Medio','Alto'],
      datasets: [{ data:[bajo,medio,alto], backgroundColor:['rgba(34,197,94,.8)','rgba(251,191,36,.8)','rgba(239,68,68,.8)'], borderWidth:0 }]
    },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{position:'right',labels:{color:'#94A3B8',font:{size:11},padding:8}} } }
  });
}

