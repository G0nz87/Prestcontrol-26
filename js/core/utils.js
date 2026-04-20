/* =====================================================
   UTILS
===================================================== */
/* =====================================================
   SCORING AUTOMÁTICO DE CLIENTES
===================================================== */
function calcularScoring(cuotas) {
  const pagadas = cuotas.filter(c => c.estado === 'Pagado');
  const atrasadas = cuotas.filter(c => c.estado === 'Atrasado');
  const hoy = today();

  if (!cuotas.length) {
    return { label:'Sin historial', icono:'⚪', color:'linear-gradient(135deg,#64748B,#475569)', autoRiesgo:null, detalle:'Nuevo cliente sin historial de pagos' };
  }

  // Calcular promedio de días de atraso en pagos realizados
  let diasAtrasoTotal = 0;
  let conAtraso = 0;
  pagadas.forEach(c => {
    if (c.fechaPago && c.fechaVenc) {
      const dias = Math.floor((new Date(c.fechaPago) - new Date(c.fechaVenc)) / 86400000);
      if (dias > 0) { diasAtrasoTotal += dias; conAtraso++; }
    }
  });
  const promAtraso = conAtraso > 0 ? diasAtrasoTotal / conAtraso : 0;
  const tieneAtrasadas = atrasadas.length > 0;
  const pctCumplimiento = cuotas.length ? Math.round(pagadas.length / cuotas.length * 100) : 0;

  if (tieneAtrasadas && atrasadas.length >= 2) {
    return {
      label:'Alto riesgo', icono:'🔴', color:'linear-gradient(135deg,#EF4444,#B91C1C)',
      autoRiesgo:'Alto',
      detalle:`${atrasadas.length} cuotas atrasadas actualmente`
    };
  }
  if (promAtraso > 14 || tieneAtrasadas) {
    return {
      label:'Riesgo medio', icono:'🟡', color:'linear-gradient(135deg,#FBBF24,#D97706)',
      autoRiesgo:'Medio',
      detalle:`Promedio de atraso: ${Math.round(promAtraso)} días`
    };
  }
  if (pctCumplimiento === 100 && pagadas.length >= 3) {
    return {
      label:'Excelente', icono:'⭐', color:'linear-gradient(135deg,#22C55E,#15803D)',
      autoRiesgo:'Bajo',
      detalle:`${pagadas.length} cuotas pagadas · ${pctCumplimiento}% de cumplimiento`
    };
  }
  return {
    label:'Buen cliente', icono:'🟢', color:'linear-gradient(135deg,#3B82F6,#2563EB)',
    autoRiesgo:'Bajo',
    detalle:`${pctCumplimiento}% de cuotas al día`
  };
}

/* =====================================================
   WEBAUTHN — Huella digital / Face ID / Windows Hello
===================================================== */

