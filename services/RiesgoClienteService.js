import { saldoCobrableCuota } from '../core/helpers.js';

const DAY_MS = 86400000;
function fechaValida(valor) {
  const fecha = valor ? new Date(valor) : null;
  return fecha && Number.isFinite(fecha.getTime()) ? fecha : null;
}

function inicioDiaUTC(valor) {
  const fecha = fechaValida(valor);
  return fecha ? Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()) : null;
}

function porcentaje(parte, total) {
  return total > 0 ? (parte / total) * 100 : 0;
}

export class RiesgoClienteService {
  static VERSION = 'RISK_V1';

  calcular(clienteId, { prestamos = [], cuotas = [], ahora = new Date() } = {}) {
    const prestamosCliente = prestamos.filter(p =>
      p?._deleted !== true && p.clienteId === clienteId
    );
    const idsPrestamo = new Set(prestamosCliente.map(p => p.id));
    const cuotasCliente = cuotas.filter(c =>
      c?._deleted !== true && (c.clienteId === clienteId || idsPrestamo.has(c.prestamoId))
    );
    const prestamosPorId = new Map(prestamosCliente.map(p => [p.id, p]));
    const hoyUTC = inicioDiaUTC(ahora) ?? inicioDiaUTC(new Date());

    const cobrables = cuotasCliente.filter(c => {
      const prestamo = prestamosPorId.get(c.prestamoId);
      return prestamo && ['Activo', 'Atrasado'].includes(prestamo.estado) && saldoCobrableCuota(c) > 0;
    });
    const saldoCobrableTotal = cobrables.reduce((sum, c) => sum + saldoCobrableCuota(c), 0);
    const vencidas = cobrables.filter(c => {
      const vencimiento = inicioDiaUTC(c.fechaVenc);
      return vencimiento != null && vencimiento < hoyUTC;
    });
    const saldoVencido = vencidas.reduce((sum, c) => sum + saldoCobrableCuota(c), 0);
    const maxDiasAtrasoActual = vencidas.reduce((maximo, c) => {
      const dias = Math.max(0, Math.floor((hoyUTC - inicioDiaUTC(c.fechaVenc)) / DAY_MS));
      return Math.max(maximo, dias);
    }, 0);

    const pagadasEvaluables = cuotasCliente.filter(c =>
      c.estado === 'Pagado' &&
      c.origenPago !== 'renovacion_descuento' &&
      c.cerradoPor !== 'renovacion' &&
      fechaValida(c.fechaPago) && fechaValida(c.fechaVenc)
    );
    const pagadasTarde = pagadasEvaluables.filter(c =>
      inicioDiaUTC(c.fechaPago) > inicioDiaUTC(c.fechaVenc)
    );
    const ratioPagosTarde = porcentaje(pagadasTarde.length, pagadasEvaluables.length);
    const ejecuciones = prestamosCliente.filter(p => p.estado === 'Ejecutado').length;

    const prestamosBuenCumplimiento = prestamosCliente.filter(p => {
      if (p.estado !== 'Pagado' || p.cerradoPor === 'renovacion') return false;
      const cuotasPrestamo = cuotasCliente.filter(c => c.prestamoId === p.id);
      const evaluables = cuotasPrestamo.filter(c =>
        c.estado === 'Pagado' && c.origenPago !== 'renovacion_descuento' &&
        c.cerradoPor !== 'renovacion' && fechaValida(c.fechaPago) && fechaValida(c.fechaVenc)
      );
      return evaluables.length > 0 && cuotasPrestamo.every(c =>
        c.estado === 'Pagado' && c.origenPago !== 'renovacion_descuento' && c.cerradoPor !== 'renovacion'
      ) &&
        evaluables.every(c => inicioDiaUTC(c.fechaPago) <= inicioDiaUTC(c.fechaVenc));
    }).length;

    const motivos = [];
    let score = 0;
    let puntosAtraso = 0;
    if (maxDiasAtrasoActual > 30) puntosAtraso = 30;
    else if (maxDiasAtrasoActual >= 8) puntosAtraso = 20;
    else if (maxDiasAtrasoActual >= 1) puntosAtraso = 10;
    if (puntosAtraso) motivos.push(`Cuota vencida hace ${maxDiasAtrasoActual} día${maxDiasAtrasoActual === 1 ? '' : 's'}: +${puntosAtraso}`);
    score += puntosAtraso;

    const proporcionVencida = porcentaje(saldoVencido, saldoCobrableTotal);
    let puntosDeudaVencida = 0;
    if (proporcionVencida > 50) puntosDeudaVencida = 15;
    else if (proporcionVencida > 25) puntosDeudaVencida = 10;
    else if (proporcionVencida > 0) puntosDeudaVencida = 5;
    if (puntosDeudaVencida) motivos.push(`${Math.round(proporcionVencida)}% de deuda actualmente vencida: +${puntosDeudaVencida}`);
    score += puntosDeudaVencida;

    let puntosPuntualidad = 0;
    if (ratioPagosTarde > 50) puntosPuntualidad = 20;
    else if (ratioPagosTarde > 20) puntosPuntualidad = 12;
    else if (ratioPagosTarde > 0) puntosPuntualidad = 5;
    if (puntosPuntualidad) motivos.push(`${Math.round(ratioPagosTarde)}% de pagos históricos fuera de término: +${puntosPuntualidad}`);
    score += puntosPuntualidad;

    const puntosEjecuciones = ejecuciones >= 2 ? 35 : ejecuciones === 1 ? 25 : 0;
    if (puntosEjecuciones) motivos.push(`${ejecuciones} préstamo${ejecuciones === 1 ? '' : 's'} ejecutado${ejecuciones === 1 ? '' : 's'}: +${puntosEjecuciones}`);
    score += puntosEjecuciones;

    const reduccionBuenHistorial = ejecuciones === 0
      ? (prestamosBuenCumplimiento >= 3 ? 10 : prestamosBuenCumplimiento >= 1 ? 5 : 0)
      : 0;
    if (reduccionBuenHistorial) motivos.push(`Buen historial de ${prestamosBuenCumplimiento} préstamo${prestamosBuenCumplimiento === 1 ? '' : 's'} pagado${prestamosBuenCumplimiento === 1 ? '' : 's'}: -${reduccionBuenHistorial}`);
    score = Math.max(0, Math.min(100, score - reduccionBuenHistorial));

    const sinHistorial = pagadasEvaluables.length === 0 && ejecuciones === 0 && maxDiasAtrasoActual === 0;
    const nivelAuto = sinHistorial ? 'SIN HISTORIAL' : score >= 50 ? 'ALTO' : score >= 25 ? 'MEDIO' : 'BAJO';
    if (!motivos.length) motivos.push(sinHistorial ? 'Todavía no existe comportamiento real suficiente para calificar.' : 'Sin señales negativas registradas.');

    return {
      nivelAuto,
      score,
      motivos,
      indicadores: {
        maxDiasAtrasoActual,
        saldoVencido,
        saldoCobrableTotal,
        proporcionVencida,
        cuotasPagadasEvaluables: pagadasEvaluables.length,
        cuotasPagadasTarde: pagadasTarde.length,
        ratioPagosTarde,
        ejecuciones,
        prestamosBuenCumplimiento
      },
      version: RiesgoClienteService.VERSION
    };
  }

  efectivo(cliente, calculo) {
    const override = ['Bajo', 'Medio', 'Alto'].includes(cliente?.riesgoOverrideNivel)
      ? cliente.riesgoOverrideNivel.toUpperCase()
      : null;
    const legacy = !override && ['Bajo', 'Medio', 'Alto'].includes(cliente?.riesgo)
      ? cliente.riesgo.toUpperCase()
      : null;
    return {
      nivel: override || legacy || calculo.nivelAuto,
      tipo: override ? 'override' : legacy ? 'legacy' : 'automatico',
      ajustado: Boolean(override || legacy)
    };
  }
}
