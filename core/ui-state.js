export function calcularScoring(cuotas) {
  // Logica de evaluacion en el service; mapeo a label/icono/color/detalle aca (UI).
  const r = window.prestamoService.evaluarRiesgo(cuotas);
  switch (r.nivel) {
    case 'sin_historial':
      return { label:'Sin historial', icono:'⚪', color:'linear-gradient(135deg,#64748B,#475569)', autoRiesgo:null,    detalle:'Nuevo cliente sin historial de pagos' };
    case 'alto':
      return { label:'Alto riesgo',   icono:'🔴', color:'linear-gradient(135deg,#EF4444,#B91C1C)', autoRiesgo:'Alto',  detalle:`${r.cuotasAtrasadas} cuotas atrasadas actualmente` };
    case 'medio':
      return { label:'Riesgo medio',  icono:'🟡', color:'linear-gradient(135deg,#FBBF24,#D97706)', autoRiesgo:'Medio', detalle:`Promedio de atraso: ${Math.round(r.diasPromedio)} días` };
    case 'excelente':
      return { label:'Excelente',     icono:'⭐', color:'linear-gradient(135deg,#22C55E,#15803D)', autoRiesgo:'Bajo',  detalle:`${r.cuotasPagadas} cuotas pagadas · ${r.pctCumplimiento}% de cumplimiento` };
    case 'bajo':
    default:
      return { label:'Buen cliente',  icono:'🟢', color:'linear-gradient(135deg,#3B82F6,#2563EB)', autoRiesgo:'Bajo',  detalle:`${r.pctCumplimiento}% de cuotas al día` };
  }
}

export function prestamoEstadoUI(estado) {
  const map = {
    Activo: { badgeClass: 'badge-info', lineClass: 'line-info' },
    Atrasado: { badgeClass: 'badge-danger', lineClass: 'line-danger' },
    Pagado: { badgeClass: 'badge-success', lineClass: 'line-success' },
    Ejecutado: { badgeClass: 'badge-violet', lineClass: 'line-violet' },
    Cancelado: { badgeClass: 'badge-muted', lineClass: 'line-muted' },
    Pendiente: { badgeClass: 'badge-warning', lineClass: 'line-warning' }
  };
  return map[estado] || { badgeClass: 'badge-muted', lineClass: 'line-muted' };
}

Object.assign(window, {
  calcularScoring,
  prestamoEstadoUI
});
