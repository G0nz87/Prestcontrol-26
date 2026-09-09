/* =====================================================
   HISTORIAL POR PERÍODO
===================================================== */
let histPeriodo = 'mes'; // 'mes' | 'semana'

export async function renderHistorial() {
  const el = document.getElementById('pg-historial');
  el.innerHTML = '<div class="loader"><div class="spin"></div></div>';

  // Incluir eliminados para que el historial no se rompa al borrar préstamos
  const [prestamos, cuotas, pagosCuota] = await Promise.all([
    window.dbAllIncludeDeleted('prestamos'), window.dbAllIncludeDeleted('cuotas'), window.dbAllIncludeDeleted('pagos_cuota')
  ]);

  el.innerHTML = `<div class="fadeIn">
    <div class="dtabs" style="margin-bottom:16px">
      <button class="dtab ${histPeriodo==='mes'?'on':''}" onclick="switchHistPeriodo('mes')">📅 Por Mes</button>
      <button class="dtab ${histPeriodo==='semana'?'on':''}" onclick="switchHistPeriodo('semana')">📆 Por Semana</button>
    </div>
    <div id="hist-body">${buildHistorial(prestamos, cuotas, pagosCuota)}</div>
  </div>`;
}

export function switchHistPeriodo(p) {
  histPeriodo = p;
  renderHistorial();
}

export function buildHistorial(prestamos, cuotas, pagosCuota = []) {
  const prestamosPorId = new Map(prestamos.map(prestamo => [prestamo.id, prestamo]));
  // Agrupar préstamos creados por período
  // EXCLUIR préstamos cancelados por error de carga (motivo 'error' u 'otro' → _deleted o estado Cancelado)
  // INCLUIR préstamos Pagado (total), Ejecutado (prenda), Activo, Atrasado — son préstamos reales
  const gruposPre = {};
  prestamos.filter(p => !p._deleted && p.estado !== 'Cancelado').forEach(p => {
    const key = periodoKey(p.fecha);
    if (!key) return;
    if (!gruposPre[key]) gruposPre[key] = { prestado:0, ganancia:0, cantidad:0 };
    gruposPre[key].prestado  += Number(p.monto    || 0);
    gruposPre[key].ganancia  += Number(p.ganancia || 0);
    gruposPre[key].cantidad++;
  });

  // Desglose informativo por estado final. No altera los acumulados financieros.
  const estadosFinales = ['Pagado', 'Ejecutado', 'Cancelado'];
  const conteosEstadoTotal = { Pagado: 0, Renovado: 0, Ejecutado: 0, Cancelado: 0 };
  const conteosEstadoPeriodo = {};
  prestamos.filter(p => estadosFinales.includes(p.estado)).forEach(p => {
    const estadoVisual = p.estado === 'Pagado' && ['renovacion', 'renovacion_capital'].includes(p.cerradoPor) ? 'Renovado' : p.estado;
    const key = periodoKey(estadoVisual === 'Renovado' ? (p.renovadoEn || p.fecha) : p.fecha);
    conteosEstadoTotal[estadoVisual]++;
    if (!key) return;
    if (!conteosEstadoPeriodo[key]) {
      conteosEstadoPeriodo[key] = { Pagado: 0, Renovado: 0, Ejecutado: 0, Cancelado: 0 };
    }
    conteosEstadoPeriodo[key][estadoVisual]++;
  });

  // Una renovación se reconstruye desde el préstamo nuevo y su vínculo al anterior.
  // Es un desglose informativo: no participa de Cobrado ni Ganancia real.
  const renovacionesPorPeriodo = {};
  prestamos
    .filter(prestamo => !prestamo?._deleted && prestamo.origen === 'renovacion' && prestamo.prestamoOrigenId)
    .forEach(prestamoNuevo => {
      const prestamoOrigen = prestamosPorId.get(prestamoNuevo.prestamoOrigenId);
      if (!prestamoOrigen || prestamoOrigen._deleted === true) return;
      const fecha = prestamoOrigen.renovadoEn || prestamoNuevo.creadoEn || prestamoNuevo.createdAt || prestamoNuevo.fecha;
      const key = periodoKey(fecha);
      if (!key) return;
      if (!renovacionesPorPeriodo[key]) renovacionesPorPeriodo[key] = [];
      renovacionesPorPeriodo[key].push({
        origenId: prestamoOrigen.id,
        destinoId: prestamoNuevo.id,
        montoCompensado: Number(prestamoNuevo.montoCompensado || 0),
        montoEntregado: Number(prestamoNuevo.montoEntregado || 0),
        fecha
      });
    });

  // Agrupar pagos cobrados por período
  // Incluye cuotas de préstamos cerrados que fueron pagadas (incluso cancelación total)
  // NO incluye cuotas Ejecutadas (prenda) porque no hubo cobro en efectivo
  const gruposCob = {};
  const gruposCompensados = {};
  cuotas.filter(c => c.estado === 'Pagado' && c.fechaPago && !c._deleted && Number(c.cantidadAbonos || 0) === 0).forEach(c => {
    const key = periodoKey(c.fechaPago);
    if (!key) return;
    if (['renovacion_descuento', 'interes_cobrado_renovacion_capital'].includes(c.origenPago)) {
      if (!gruposCompensados[key]) gruposCompensados[key] = 0;
      gruposCompensados[key] += Number(c.montoCompensado ?? c.monto ?? 0);
      if (c.origenPago === 'renovacion_descuento') return;
    }
    if (!gruposCob[key]) gruposCob[key] = 0;
    gruposCob[key] += c.montoEfectivo != null ? Number(c.montoEfectivo || 0) : Number(c.monto || 0);
  });
  pagosCuota.filter(pago => pago && pago._deleted !== true && pago.tipo === 'ABONO_CUOTA').forEach(pago => {
    const key = periodoKey(pago.fechaPago);
    if (!key) return;
    if (!gruposCob[key]) gruposCob[key] = 0;
    gruposCob[key] += Number(pago.monto || 0);
  });

  // Unir todas las keys y ordenar desc
  const allKeys = [...new Set([...Object.keys(gruposPre), ...Object.keys(gruposCob), ...Object.keys(gruposCompensados), ...Object.keys(conteosEstadoPeriodo), ...Object.keys(renovacionesPorPeriodo)])]
    .sort((a,b) => b.localeCompare(a));

  if (!allKeys.length) return window.emptyHTML('📈','Sin datos de período','Cargá préstamos para ver el historial.');

  // ── TOTALES ACUMULADOS ──
  const totPrestado  = Object.values(gruposPre).reduce((s,g) => s + g.prestado, 0);
  const totCobrado   = Object.values(gruposCob).reduce((s,v) => s + v, 0);
  const totCompensado = Object.values(gruposCompensados).reduce((s,v) => s + v, 0);
  const totCantidad  = Object.values(gruposPre).reduce((s,g) => s + g.cantidad, 0);
  const totGananciaReal = Math.max(0, totCobrado - totPrestado);

  const resumen = `
    <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,rgba(34,197,94,.08),rgba(59,130,246,.06));border-color:rgba(34,197,94,.25)">
      <div style="font-size:12px;font-weight:800;color:var(--gold);margin-bottom:10px;letter-spacing:.5px">📊 RESUMEN TOTAL — ${histPeriodo === 'mes' ? 'Todos los meses' : 'Todas las semanas'}</div>
      <div class="srow">
        <div class="sri">
          <div class="sri-ic">💵</div>
          <div class="sri-v" style="font-size:11px;color:var(--money)">${window.fmtMoney(totPrestado)}</div>
          <div class="sri-l">Prestado</div>
        </div>
        <div class="sri">
          <div class="sri-ic">💰</div>
          <div class="sri-v" style="font-size:11px;color:var(--grn)">${window.fmtMoney(totCobrado)}</div>
          <div class="sri-l">Cobrado</div>
        </div>
        <div class="sri">
          <div class="sri-ic">📈</div>
          <div class="sri-v" style="font-size:11px;color:var(--yel)">${window.fmtMoney(totGananciaReal)}</div>
          <div class="sri-l">Ganancia real</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)">
        <span>📋 ${totCantidad} préstamo${totCantidad!==1?'s':''} histórico${totCantidad!==1?'s':''}</span>
        <span>📅 ${allKeys.length} ${histPeriodo === 'mes' ? 'mes' : 'semana'}${allKeys.length!==1?'es':''}</span>
      </div>
      <div class="info-grid" style="margin-top:10px">
        <div class="info-cell"><div class="info-lbl">Compensado por renovación</div><div class="info-val" style="color:var(--yel)">${window.fmtMoney(totCompensado)}</div></div>
        <div class="info-cell"><div class="info-lbl">Pagados</div><div class="info-val" style="color:var(--grn)">${conteosEstadoTotal.Pagado}</div></div>
        <div class="info-cell"><div class="info-lbl">Renovados</div><div class="info-val" style="color:var(--gold)">${conteosEstadoTotal.Renovado}</div></div>
        <div class="info-cell"><div class="info-lbl">Ejecutados</div><div class="info-val" style="color:var(--red)">${conteosEstadoTotal.Ejecutado}</div></div>
        <div class="info-cell"><div class="info-lbl">Cancelados</div><div class="info-val">${conteosEstadoTotal.Cancelado}</div></div>
      </div>
    </div>`;

  // ── TARJETAS POR PERIODO CON COMPARATIVA ──
  const tarjetas = allKeys.map((key, idx) => {
    const pre = gruposPre[key] || { prestado:0, ganancia:0, cantidad:0 };
    const cobrado = gruposCob[key] || 0;
    const compensado = gruposCompensados[key] || 0;
    const gananciaReal = Math.max(0, cobrado - pre.prestado);
    const label = periodoLabel(key);
    const estados = conteosEstadoPeriodo[key] || { Pagado:0, Renovado:0, Ejecutado:0, Cancelado:0 };
    const renovaciones = (renovacionesPorPeriodo[key] || []).sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    // Comparar con período anterior (siguiente en la lista, porque está ordenada desc)
    const keyAnterior = allKeys[idx + 1];
    const cobradoAnt = keyAnterior ? (gruposCob[keyAnterior] || 0) : 0;
    let comparativa = '';
    if (keyAnterior && cobradoAnt > 0) {
      const diff = cobrado - cobradoAnt;
      const pct = Math.round((diff / cobradoAnt) * 100);
      if (diff > 0) {
        comparativa = `<span style="color:var(--grn);font-size:11px;font-weight:700">▲ ${pct}% vs anterior</span>`;
      } else if (diff < 0) {
        comparativa = `<span style="color:var(--red);font-size:11px;font-weight:700">▼ ${Math.abs(pct)}% vs anterior</span>`;
      } else {
        comparativa = `<span style="color:var(--muted);font-size:11px">= igual que anterior</span>`;
      }
    } else if (keyAnterior && cobrado > 0) {
      comparativa = `<span style="color:var(--grn);font-size:11px;font-weight:700">🆕 primer cobro</span>`;
    }

    return `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-size:14px;font-weight:800;color:var(--gold)">${label}</div>
          ${comparativa}
        </div>
        <div class="srow">
          <div class="sri">
            <div class="sri-ic">💵</div>
            <div class="sri-v" style="font-size:11px;color:var(--money)">${window.fmtMoney(pre.prestado)}</div>
            <div class="sri-l">Prestado</div>
          </div>
          <div class="sri">
            <div class="sri-ic">💰</div>
            <div class="sri-v" style="font-size:11px;color:var(--grn)">${window.fmtMoney(cobrado)}</div>
            <div class="sri-l">Cobrado</div>
          </div>
          <div class="sri">
            <div class="sri-ic">📈</div>
            <div class="sri-v" style="font-size:11px;color:var(--yel)">${window.fmtMoney(pre.ganancia)}</div>
            <div class="sri-l">Gan. esperada</div>
          </div>
        </div>
        ${gananciaReal > 0 ? `
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:8px 12px;margin-top:8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:var(--muted)">💵 Ganancia real del período</span>
          <span style="font-size:13px;font-weight:800;color:var(--grn)">${window.fmtMoney(gananciaReal)}</span>
        </div>` : ''}
        ${compensado > 0 ? `<div style="margin-top:8px;font-size:12px;color:var(--yel);font-weight:700">Compensado por renovación: ${window.fmtMoney(compensado)} · no ingresó efectivo</div>` : ''}
        ${renovaciones.map(renovacion => `<div class="card-sm" style="margin-top:8px">
          <div class="li-row">
            <div>
              <div class="li-name">${window.esc(renovacion.origenId)} → ${window.esc(renovacion.destinoId)}</div>
              <div class="li-sub">Renovación · ${window.fmtDate(renovacion.fecha)}</div>
              <div class="li-sub">Compensado: ${window.fmtMoney(renovacion.montoCompensado)} · Entregado: ${window.fmtMoney(renovacion.montoEntregado)}</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="abrirComprobanteRenovacion('${window.esc(renovacion.origenId)}')">Ver comprobante</button>
          </div>
        </div>`).join('')}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          <span style="font-size:12px;color:var(--muted)">📋 ${pre.cantidad} préstamo${pre.cantidad!==1?'s':''} otorgado${pre.cantidad!==1?'s':''}</span>
          ${cobrado > 0 ? `<span style="font-size:11px;color:var(--grn);font-weight:700">✅ ${window.fmtMoney(cobrado)} ingresado</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;font-size:11px;font-weight:700">
          <span class="badge badge-success">Pagados: ${estados.Pagado}</span>
          <span class="badge" style="color:var(--gold)">Renovados: ${estados.Renovado}</span>
          <span class="badge badge-danger">Ejecutados: ${estados.Ejecutado}</span>
          <span class="badge">Cancelados: ${estados.Cancelado}</span>
        </div>
      </div>`;
  }).join('');

  return resumen + tarjetas;
}

export function periodoKey(fechaStr) {
  const d = window.parseDate(fechaStr);
  if (!d) return null;
  if (histPeriodo === 'mes') {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  } else {
    // Número de semana ISO
    const tmp = new Date(d);
    tmp.setHours(0,0,0,0);
    tmp.setDate(tmp.getDate() + 3 - (tmp.getDay()||7) + 1);
    const week1 = new Date(tmp.getFullYear(), 0, 4);
    const nSem  = 1 + Math.round(((tmp-week1)/86400000 - 3 + (week1.getDay()||7)) / 7);
    return `${d.getFullYear()}-W${String(nSem).padStart(2,'0')}`;
  }
}

export function periodoLabel(key) {
  if (histPeriodo === 'mes') {
    const [y, m] = key.split('-');
    const d = new Date(+y, +m-1, 1);
    return d.toLocaleDateString('es-AR', { month:'long', year:'numeric' })
             .replace(/^\w/, c => c.toUpperCase());
  } else {
    const [y, w] = key.split('-W');
    // Calcular lunes de la semana
    const jan4   = new Date(+y, 0, 4);
    const lunes  = new Date(jan4);
    lunes.setDate(jan4.getDate() - (jan4.getDay()||7) + 1 + (+w-1)*7);
    const viernes = new Date(lunes); viernes.setDate(lunes.getDate()+4);
    const fmt = d => d.toLocaleDateString('es-AR',{day:'numeric',month:'short'});
    return `Semana ${w} · ${fmt(lunes)} — ${fmt(viernes)} ${y}`;
  }
}

Object.assign(window, {
  renderHistorial,
  switchHistPeriodo,
  buildHistorial,
  periodoKey,
  periodoLabel
});
