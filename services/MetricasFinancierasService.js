// Metricas financieras puras: no toca DOM, IndexedDB ni Firebase.
// Cuando una cuota no trae desglose capital/interes, se prorratea segun
// la relacion monto/total y ganancia/total del prestamo asociado.

export class MetricasFinancierasService {
  calcularMetricasGlobales({ prestamos = [], cuotas = [], clientes = [], hoy = new Date(), esCuotaCobrable } = {}) {
    return this._calcularMetricas({ prestamos, cuotas, clientes, hoy, esCuotaCobrable });
  }

  calcularMetricasCliente(clienteId, { prestamos = [], cuotas = [], clientes = [], hoy = new Date(), esCuotaCobrable } = {}) {
    return this._calcularMetricas({
      prestamos: prestamos.filter(p => p.clienteId === clienteId),
      cuotas: cuotas.filter(c => c.clienteId === clienteId),
      clientes: clientes.filter(c => c.id === clienteId),
      hoy,
      esCuotaCobrable
    });
  }

  calcularCashflow(cuotas = [], dias = 7, hoy = new Date(), esCuotaCobrable, prestamosPorId) {
    const inicio = this._startOfDay(hoy);
    const limite = new Date(inicio);
    limite.setDate(limite.getDate() + Number(dias || 0));

    return cuotas
      .filter(c => this._esCuotaCobrable(c, esCuotaCobrable, prestamosPorId))
      .filter(c => {
        const venc = this._parseDate(c.fechaVenc);
        return venc && venc >= inicio && venc <= limite;
      })
      .reduce((sum, c) => sum + this._num(c.monto), 0);
  }

  _calcularMetricas({ prestamos, cuotas, clientes, hoy, esCuotaCobrable }) {
    const fechaHoy = this._startOfDay(hoy);
    const prestamosActivosLista = prestamos.filter(p => this._esPrestamoActivo(p));
    const prestamosPorId = new Map(prestamos.map(p => [p.id, p]));
    const prestamosRealesMap = new Map(
      prestamos
        .filter(p => !p?._deleted && p.estado !== 'Cancelado')
        .map(p => [p.id, p])
    );
    const cuotasActivas = cuotas.filter(c => !c?._deleted);
    const cuotasPagadasLista = cuotasActivas.filter(c => c.estado === 'Pagado');
    const cuotasPendientesLista = cuotasActivas.filter(c =>
      this._esCuotaCobrable(c, esCuotaCobrable, prestamosPorId)
    );
    const cuotasVencidasLista = cuotasPendientesLista.filter(c => {
      const venc = this._parseDate(c.fechaVenc);
      return venc && venc < fechaHoy;
    });

    let capitalRecuperado = 0;
    let interesCobrado = 0;
    cuotasPagadasLista.forEach(c => {
      const desglose = this._desglosarCuota(c, prestamosRealesMap.get(c.prestamoId));
      capitalRecuperado += desglose.capital;
      interesCobrado += desglose.interes;
    });

    let capitalPendiente = 0;
    let interesPendiente = 0;
    cuotasPendientesLista.forEach(c => {
      const desglose = this._desglosarCuota(c, prestamosRealesMap.get(c.prestamoId));
      capitalPendiente += desglose.capital;
      interesPendiente += desglose.interes;
    });

    const capitalEnRiesgo = cuotasVencidasLista.reduce((sum, c) =>
      sum + this._desglosarCuota(c, prestamosRealesMap.get(c.prestamoId)).capital, 0
    );

    const capitalPrestado = prestamosActivosLista.reduce((sum, p) => sum + this._num(p.monto), 0);
    const interesProyectado = prestamosActivosLista.reduce((sum, p) => sum + this._num(p.ganancia), 0);
    const totalCobrado = cuotasPagadasLista.reduce((sum, c) => sum + this._num(c.monto), 0);
    const totalPendiente = cuotasPendientesLista.reduce((sum, c) => sum + this._num(c.monto), 0);
    const montoVencido = cuotasVencidasLista.reduce((sum, c) => sum + this._num(c.monto), 0);
    const montoAtrasado = cuotasPendientesLista
      .filter(c => c.estado === 'Atrasado')
      .reduce((sum, c) => sum + this._num(c.monto), 0);

    return {
      capitalPrestado,
      capitalRecuperado,
      capitalPendiente,
      interesCobrado,
      interesPendiente,
      interesProyectado,
      totalCobrado,
      totalPendiente,
      montoVencido,
      capitalEnRiesgo,
      montoAtrasado,
      porcentajeRecuperado: (capitalRecuperado + capitalPendiente) > 0
        ? Math.round((capitalRecuperado / (capitalRecuperado + capitalPendiente)) * 100)
        : 0,
      moraReal: totalPendiente > 0 ? Math.round((montoVencido / totalPendiente) * 100) : 0,
      cashflow7: this.calcularCashflow(cuotasActivas, 7, fechaHoy, esCuotaCobrable, prestamosPorId),
      cashflow15: this.calcularCashflow(cuotasActivas, 15, fechaHoy, esCuotaCobrable, prestamosPorId),
      cashflow30: this.calcularCashflow(cuotasActivas, 30, fechaHoy, esCuotaCobrable, prestamosPorId),
      prestamosActivos: prestamosActivosLista.length,
      clientesActivos: clientes.filter(c => !c?._deleted && c.estado === 'Activo').length,
      cuotasPagadas: cuotasPagadasLista.length,
      cuotasPendientes: cuotasPendientesLista.length,
      cuotasVencidas: cuotasVencidasLista.length
    };
  }

  _desglosarCuota(cuota, prestamo) {
    const montoCuota = this._num(cuota?.monto);
    const totalPrestamo = this._num(prestamo?.total);
    if (!prestamo || totalPrestamo <= 0) {
      return { capital: montoCuota, interes: 0 };
    }
    const capitalRatio = this._num(prestamo.monto) / totalPrestamo;
    const interesRatio = this._num(prestamo.ganancia) / totalPrestamo;
    return {
      capital: montoCuota * capitalRatio,
      interes: montoCuota * interesRatio
    };
  }

  _esPrestamoActivo(prestamo) {
    return !prestamo?._deleted && (prestamo.estado === 'Activo' || prestamo.estado === 'Atrasado');
  }

  _esCuotaPendiente(cuota) {
    const estadosNoPendientes = new Set(['Pagado', 'Ejecutada', 'Ejecutado', 'Cancelada', 'Cancelado']);
    return !cuota?._deleted && !estadosNoPendientes.has(cuota.estado);
  }

  _esCuotaCobrable(cuota, esCuotaCobrable, prestamosPorId) {
    if (typeof esCuotaCobrable === 'function') {
      return esCuotaCobrable(cuota, prestamosPorId);
    }
    if (!this._esCuotaPendiente(cuota)) return false;
    const prestamo = prestamosPorId?.get(cuota?.prestamoId);
    return !prestamo || (!prestamo._deleted && !['Pagado', 'Ejecutado', 'Cancelado'].includes(prestamo.estado));
  }

  _parseDate(value) {
    if (!value) return null;
    const d = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return this._startOfDay(d);
  }

  _startOfDay(value) {
    const d = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  _num(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }
}
