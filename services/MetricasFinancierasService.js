import { saldoCobrableCuota } from '../core/helpers.js';

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
      .reduce((sum, c) => sum + this._saldoCuota(c), 0);
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
    const cuotasParcialesLista = cuotasActivas.filter(c => c.estado === 'Parcial' && this._num(c.totalAbonado) > 0);
    const cuotasEjecutadasLista = cuotasActivas.filter(c =>
      c.estado === 'Ejecutada' || c.estado === 'Ejecutado'
    );
    const cuotasPendientesLista = cuotasActivas.filter(c =>
      this._esCuotaCobrable(c, esCuotaCobrable, prestamosPorId)
    );
    const cuotasVencidasLista = cuotasPendientesLista.filter(c => {
      const venc = this._parseDate(c.fechaVenc);
      return venc && venc < fechaHoy;
    });
    const composicionEconomica = this._construirComposicionEconomica(prestamos, cuotasActivas);

    let capitalRecuperado = 0;
    let interesCobrado = 0;
    let totalInteresBonificado = 0;
    cuotasPagadasLista.forEach(c => {
      const tieneDesgloseExplicito = Number.isFinite(Number(c.capitalCobradoReal))
        && Number.isFinite(Number(c.interesCobradoReal));
      const desglose = tieneDesgloseExplicito
        ? { capital: this._num(c.capitalCobradoReal), interes: this._num(c.interesCobradoReal) }
        : this._desglosarMonto(
            this._montoCobroEfectivo(c),
            prestamosRealesMap.get(c.prestamoId),
            composicionEconomica.get(c.prestamoId)
          );
      capitalRecuperado += desglose.capital;
      interesCobrado += desglose.interes;
      totalInteresBonificado += this._num(c.interesBonificado);
    });
    cuotasParcialesLista.forEach(c => {
      const desglose = this._desglosarMonto(
        this._num(c.totalAbonado), prestamosRealesMap.get(c.prestamoId), composicionEconomica.get(c.prestamoId)
      );
      capitalRecuperado += desglose.capital;
      interesCobrado += desglose.interes;
    });

    const capitalEjecutado = cuotasEjecutadasLista.reduce((sum, c) =>
      sum + this._desglosarCuota(
        c,
        prestamosRealesMap.get(c.prestamoId),
        composicionEconomica.get(c.prestamoId)
      ).capital, 0
    );

    let capitalPendiente = 0;
    let interesPendiente = 0;
    cuotasPendientesLista.forEach(c => {
      const desglose = this._desglosarMonto(
        this._saldoCuota(c),
        prestamosRealesMap.get(c.prestamoId),
        composicionEconomica.get(c.prestamoId)
      );
      capitalPendiente += desglose.capital;
      interesPendiente += desglose.interes;
    });

    const capitalEnRiesgo = cuotasVencidasLista.reduce((sum, c) =>
      sum + this._desglosarMonto(
        this._saldoCuota(c),
        prestamosRealesMap.get(c.prestamoId),
        composicionEconomica.get(c.prestamoId)
      ).capital, 0
    );

    const estadosCapitalBase = new Set(['Activo', 'Atrasado', 'Pagado', 'Ejecutado']);
    const capitalBase = prestamos
      .filter(p => !p?._deleted && estadosCapitalBase.has(p.estado))
      .reduce((sum, p) => sum + this._num(composicionEconomica.get(p.id)?.desembolsoNuevo), 0);
    // Capital activo e interes proyectado son saldos economicos todavia cobrables.
    const capitalPrestado = capitalPendiente;
    const interesProyectado = interesPendiente;
    const totalCobrado = cuotasPagadasLista.reduce((sum, c) => sum + this._montoCobroEfectivo(c), 0)
      + cuotasParcialesLista.reduce((sum, c) => sum + this._num(c.totalAbonado), 0);
    const totalCompensadoRenovaciones = cuotasPagadasLista
      .filter(c => ['renovacion_descuento', 'interes_cobrado_renovacion_capital'].includes(c.origenPago))
      .reduce((sum, c) => sum + this._num(c.montoCompensado ?? c.monto), 0);
    const capitalNominalRenovaciones = prestamos
      .filter(p => !p?._deleted && p.origen === 'renovacion')
      .reduce((sum, p) => sum + this._num(p.montoNominal ?? p.monto), 0);
    const efectivoEntregadoRenovaciones = prestamos
      .filter(p => !p?._deleted && p.origen === 'renovacion')
      .reduce((sum, p) => sum + this._num(p.montoEntregado ?? p.monto), 0);
    const totalPendiente = cuotasPendientesLista.reduce((sum, c) => sum + this._saldoCuota(c), 0);
    const montoVencido = cuotasVencidasLista.reduce((sum, c) => sum + this._saldoCuota(c), 0);
    const montoAtrasado = cuotasPendientesLista
      .filter(c => {
        const venc = this._parseDate(c.fechaVenc);
        return c.estado === 'Atrasado' || (c.estado === 'Parcial' && venc && venc < fechaHoy);
      })
      .reduce((sum, c) => sum + this._saldoCuota(c), 0);

    return {
      capitalPrestado: this._round2(capitalPrestado),
      capitalActivo: this._round2(capitalPrestado),
      capitalBase: this._round2(capitalBase),
      capitalRecuperado: this._round2(capitalRecuperado),
      capitalEjecutado: this._round2(capitalEjecutado),
      capitalPendiente: this._round2(capitalPendiente),
      interesCobrado: this._round2(interesCobrado),
      totalInteresBonificado: this._round2(totalInteresBonificado),
      gananciaReal: this._round2(interesCobrado),
      interesPendiente: this._round2(interesPendiente),
      interesProyectado: this._round2(interesProyectado),
      gananciaProyectada: this._round2(interesProyectado),
      totalCobrado: this._round2(totalCobrado),
      totalCompensadoRenovaciones: this._round2(totalCompensadoRenovaciones),
      capitalNominalRenovaciones: this._round2(capitalNominalRenovaciones),
      efectivoEntregadoRenovaciones: this._round2(efectivoEntregadoRenovaciones),
      totalPendiente: this._round2(totalPendiente),
      montoVencido: this._round2(montoVencido),
      capitalEnRiesgo: this._round2(capitalEnRiesgo),
      montoAtrasado: this._round2(montoAtrasado),
      porcentajeRecuperado: (totalCobrado + totalPendiente) > 0
        ? Math.round((totalCobrado / (totalCobrado + totalPendiente)) * 100)
        : 0,
      recuperacionCapitalPct: capitalBase > 0 ? (capitalRecuperado / capitalBase) * 100 : 0,
      roiBrutoCobrado: capitalBase > 0 ? (interesCobrado / capitalBase) * 100 : 0,
      moraReal: totalPendiente > 0 ? Math.round((montoVencido / totalPendiente) * 100) : 0,
      cashflow7: this._round2(this.calcularCashflow(cuotasActivas, 7, fechaHoy, esCuotaCobrable, prestamosPorId)),
      cashflow15: this._round2(this.calcularCashflow(cuotasActivas, 15, fechaHoy, esCuotaCobrable, prestamosPorId)),
      cashflow30: this._round2(this.calcularCashflow(cuotasActivas, 30, fechaHoy, esCuotaCobrable, prestamosPorId)),
      prestamosActivos: prestamosActivosLista.length,
      clientesActivos: clientes.filter(c => !c?._deleted && c.estado === 'Activo').length,
      cuotasPagadas: cuotasPagadasLista.length,
      cuotasPendientes: cuotasPendientesLista.length,
      cuotasVencidas: cuotasVencidasLista.length
    };
  }

  _desglosarCuota(cuota, prestamo, composicion) {
    return this._desglosarMonto(this._num(cuota?.monto), prestamo, composicion);
  }

  _desglosarMonto(monto, prestamo, composicion) {
    const montoCuota = this._num(monto);
    const totalPrestamo = this._num(prestamo?.total);
    if (!prestamo || totalPrestamo <= 0) {
      return { capital: montoCuota, interes: 0 };
    }
    const nominal = this._num(prestamo.monto);
    const capitalEconomico = this._num(composicion?.capitalEconomicoNominal ?? nominal);
    const capitalRatio = capitalEconomico / totalPrestamo;
    return {
      capital: montoCuota * capitalRatio,
      // La resta conserva exactamente el importe incluso con cuotas desiguales.
      interes: montoCuota - (montoCuota * capitalRatio)
    };
  }

  calcularBonificacionInteresCuota({ cuota, prestamo, prestamos = [], cuotas = [], bonificacionMonto = 0 } = {}) {
    if (!cuota || !prestamo) throw new Error('No se pudo resolver la composición económica de la cuota.');
    const composiciones = this._construirComposicionEconomica(prestamos, cuotas);
    const composicion = composiciones.get(prestamo.id);
    const original = this._desglosarMonto(this._num(cuota.monto), prestamo, composicion);
    const efectivoAnterior = this._num(cuota.totalAbonado);
    const cobradoAnterior = this._desglosarMonto(efectivoAnterior, prestamo, composicion);
    const interesPendiente = this._round2(Math.max(0, original.interes - cobradoAnterior.interes - this._num(cuota.interesBonificado)));
    const saldoActual = this._round2(saldoCobrableCuota(cuota));
    const bonificacion = this._round2(bonificacionMonto);
    if (bonificacion - interesPendiente > 0.009) {
      throw new Error('La bonificación supera el interés pendiente de esta cuota. En esta versión no se permite condonar capital.');
    }
    const efectivoFinal = this._round2(saldoActual - bonificacion);
    if (bonificacion > 0 && !(efectivoFinal > 0)) throw new Error('La bonificación debe dejar un importe real a cobrar mayor que cero.');
    return {
      saldoActual,
      interesPendiente,
      bonificacion,
      efectivoFinal,
      capitalCobradoReal: this._round2(original.capital),
      interesCobradoReal: this._round2(Math.max(0, original.interes - bonificacion)),
      interesBonificado: bonificacion,
      capitalBonificado: 0
    };
  }

  _construirComposicionEconomica(prestamos, cuotas) {
    const prestamosValidos = prestamos.filter(p => !p?._deleted);
    const prestamosPorId = new Map(prestamosValidos.map(p => [p.id, p]));
    const cuotasPorId = new Map(cuotas.filter(c => !c?._deleted).map(c => [c.id, c]));
    const memo = new Map();
    const visitando = new Set();
    const tolerancia = 0.02;

    const errorCadena = (prestamo, detalle) => {
      const error = new Error(`Composicion economica no reconstruible para ${prestamo?.id || 'prestamo desconocido'}: ${detalle}`);
      error.code = 'METRICAS_ECONOMICAS_NO_RECONSTRUIBLES';
      throw error;
    };

    const resolver = prestamo => {
      if (memo.has(prestamo.id)) return memo.get(prestamo.id);
      if (visitando.has(prestamo.id)) errorCadena(prestamo, 'ciclo de renovacion detectado');
      visitando.add(prestamo.id);

      const nominal = this._num(prestamo.montoNominal ?? prestamo.monto);
      if (nominal < 0) errorCadena(prestamo, 'monto nominal negativo');

      let composicion;
      if (prestamo.origen !== 'renovacion') {
        composicion = {
          prestamoId: prestamo.id,
          nominal,
          capitalEconomicoNominal: nominal,
          interesHeredadoNominal: 0,
          interesNuevo: this._num(prestamo.ganancia),
          desembolsoNuevo: nominal
        };
      } else {
        const origen = prestamosPorId.get(prestamo.prestamoOrigenId);
        if (!origen) errorCadena(prestamo, `prestamo origen inexistente (${prestamo.prestamoOrigenId || 'sin id'})`);
        const origenComp = resolver(origen);
        const idsDeclarados = Array.isArray(prestamo.cuotasCompensadas)
          ? [...new Set(prestamo.cuotasCompensadas.filter(Boolean))]
          : [];
        let compensadas = idsDeclarados.map(id => cuotasPorId.get(id));
        if (compensadas.some(c => !c || c.prestamoId !== origen.id)) {
          errorCadena(prestamo, 'referencias de cuotas compensadas inconsistentes');
        }
        if (!compensadas.length) {
          compensadas = cuotas.filter(c =>
            !c?._deleted &&
            c.prestamoId === origen.id &&
            ['renovacion_descuento', 'interes_cobrado_renovacion_capital'].includes(c.origenPago) &&
            c.prestamoRenovacionId === prestamo.id
          );
        }
        if (!compensadas.length) errorCadena(prestamo, 'no hay cuotas compensadas identificables');

        const sumaCuotas = compensadas.reduce(
          (total, cuota) => total + this._num(cuota.montoCompensado ?? cuota.monto),
          0
        );
        const tieneCompensado = prestamo.montoCompensado != null && Number.isFinite(Number(prestamo.montoCompensado));
        const montoCompensado = tieneCompensado ? Number(prestamo.montoCompensado) : sumaCuotas;
        if (montoCompensado < 0 || montoCompensado - nominal > tolerancia) {
          errorCadena(prestamo, 'compensacion superior al nominal');
        }
        if (Math.abs(sumaCuotas - montoCompensado) > tolerancia) {
          errorCadena(prestamo, 'monto compensado no coincide con las cuotas identificadas');
        }

        const tieneEntregado = prestamo.montoEntregado != null && Number.isFinite(Number(prestamo.montoEntregado));
        const desembolsoNuevo = tieneEntregado
          ? Number(prestamo.montoEntregado)
          : nominal - montoCompensado;
        if (desembolsoNuevo < -tolerancia || Math.abs((montoCompensado + desembolsoNuevo) - nominal) > tolerancia) {
          errorCadena(prestamo, 'nominal, compensacion y efectivo entregado no reconcilian');
        }

        const totalOrigen = this._num(origen.total);
        const nominalOrigen = this._num(origen.montoNominal ?? origen.monto);
        if (totalOrigen <= 0 || nominalOrigen <= 0 || Math.abs(
          origenComp.capitalEconomicoNominal + origenComp.interesHeredadoNominal - nominalOrigen
        ) > tolerancia) {
          errorCadena(prestamo, 'composicion del prestamo origen inconsistente');
        }

        if (prestamo.renovacionTipo === 'interes_cobrado_capital_renovado') {
          if (Math.abs(montoCompensado - nominal) > tolerancia || Math.abs(desembolsoNuevo) > tolerancia) {
            errorCadena(prestamo, 'la renovacion de capital debe compensar todo el nominal sin desembolso nuevo');
          }
          composicion = {
            prestamoId: prestamo.id,
            nominal,
            capitalEconomicoNominal: nominal,
            interesHeredadoNominal: 0,
            interesNuevo: this._num(prestamo.ganancia),
            desembolsoNuevo: 0
          };
          visitando.delete(prestamo.id);
          memo.set(prestamo.id, composicion);
          return composicion;
        }

        let capitalHeredado = 0;
        let interesHeredado = 0;
        compensadas.forEach(cuota => {
          const compensado = this._num(cuota.montoCompensado ?? cuota.monto);
          const nominalCompensado = compensado * nominalOrigen / totalOrigen;
          const interesNuevoOrigen = compensado - nominalCompensado;
          const capitalOrigen = nominalCompensado * origenComp.capitalEconomicoNominal / nominalOrigen;
          capitalHeredado += capitalOrigen;
          interesHeredado += (nominalCompensado - capitalOrigen) + interesNuevoOrigen;
        });

        const capitalEconomicoNominal = capitalHeredado + Math.max(0, desembolsoNuevo);
        // Reconciliamos el ultimo componente contra el nominal contractual.
        const interesHeredadoNominal = nominal - capitalEconomicoNominal;
        if (capitalEconomicoNominal < -tolerancia || interesHeredadoNominal < -tolerancia ||
            Math.abs(interesHeredadoNominal - interesHeredado) > tolerancia) {
          errorCadena(prestamo, 'la composicion heredada no reconcilia');
        }
        composicion = {
          prestamoId: prestamo.id,
          nominal,
          capitalEconomicoNominal,
          interesHeredadoNominal,
          interesNuevo: this._num(prestamo.ganancia),
          desembolsoNuevo: Math.max(0, desembolsoNuevo)
        };
      }

      visitando.delete(prestamo.id);
      memo.set(prestamo.id, composicion);
      return composicion;
    };

    prestamosValidos.forEach(resolver);
    return memo;
  }

  _montoCobroEfectivo(cuota) {
    if (cuota?.origenPago === 'renovacion_descuento') {
      return this._num(cuota.montoEfectivo);
    }
    return cuota?.montoEfectivo != null
      ? this._num(cuota.montoEfectivo)
      : this._num(cuota?.monto);
  }

  _saldoCuota(cuota) {
    return saldoCobrableCuota(cuota);
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

  _round2(value) {
    return Math.round((this._num(value) + Number.EPSILON) * 100) / 100;
  }
}
