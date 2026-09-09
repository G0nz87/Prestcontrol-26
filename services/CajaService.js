const DIRECCIONES_CAJA = new Set(['ingreso', 'egreso']);
const CUENTA_GENERAL = 'GENERAL';
const SOURCE_SALDO_INICIAL = `SALDO_INICIAL:${CUENTA_GENERAL}`;

function texto(valor) {
  return String(valor ?? '').trim();
}

function timestamp(valor) {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function movimientosActivos(movimientos) {
  return (Array.isArray(movimientos) ? movimientos : [])
    .filter(movimiento => movimiento && movimiento._deleted !== true);
}

function movimientosEconomicosUnicos(movimientos) {
  const vistos = new Set();
  return movimientosActivos(movimientos).filter(movimiento => {
    if (!movimiento.sourceKey) return true;
    if (vistos.has(movimiento.sourceKey)) return false;
    vistos.add(movimiento.sourceKey);
    return true;
  });
}

function hashFNV1a(valor) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < valor.length; i++) {
    hash ^= valor.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export class CajaService {
  crearMovimiento(datos = {}) {
    const now = new Date().toISOString();
    const movimiento = {
      id: datos.id || null,
      tipo: datos.tipo || null,
      direccion: datos.direccion || null,
      monto: Number(datos.monto),
      fecha: datos.fecha || now,
      concepto: datos.concepto || '',
      nota: datos.nota || '',
      medioPago: datos.medioPago || null,
      cuentaId: datos.cuentaId || CUENTA_GENERAL,
      resetId: datos.resetId || null,
      eventoTipo: datos.eventoTipo || null,
      eventoId: datos.eventoId || null,
      clienteId: datos.clienteId || null,
      prestamoId: datos.prestamoId || null,
      cuotaId: datos.cuotaId || null,
      prendaId: datos.prendaId || null,
      pagoId: datos.pagoId || null,
      componentePagoId: datos.componentePagoId || null,
      componentesPago: Array.isArray(datos.componentesPago) ? datos.componentesPago.map(item => ({ ...item })) : [],
      pagoFingerprint: datos.pagoFingerprint || null,
      automatico: datos.automatico === true,
      sourceKey: datos.sourceKey || null,
      reversaDeMovimientoId: datos.reversaDeMovimientoId || null,
      createdByUid: datos.createdByUid || null,
      operationId: datos.operationId || null,
      deviceId: datos.deviceId || null,
      createdAt: datos.createdAt || now,
      updatedAt: datos.updatedAt || now,
      _deleted: datos._deleted === true,
      deletedAt: datos.deletedAt || null
    };
    this.validarMovimiento(movimiento, datos.movimientosExistentes || []);
    return movimiento;
  }

  validarMovimiento(movimiento, movimientosExistentes = []) {
    if (!movimiento || typeof movimiento !== 'object') {
      throw new Error('El movimiento de caja es inválido.');
    }
    const monto = Number(movimiento.monto);
    if (!texto(movimiento.id)) throw new Error('El ID del movimiento es obligatorio.');
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error('El monto del movimiento debe ser mayor que cero.');
    }
    if (!DIRECCIONES_CAJA.has(movimiento.direccion)) {
      throw new Error('La dirección debe ser ingreso o egreso.');
    }
    if (!texto(movimiento.tipo)) throw new Error('El tipo de movimiento es obligatorio.');
    if (!texto(movimiento.cuentaId)) throw new Error('La cuenta del movimiento es obligatoria.');

    if (movimiento.tipo === 'SALDO_INICIAL') {
      if (movimiento.direccion !== 'ingreso') {
        throw new Error('El saldo inicial debe ser un ingreso.');
      }
      const sourceEsperado = `SALDO_INICIAL:${movimiento.cuentaId}${texto(movimiento.resetId) ? `:${texto(movimiento.resetId)}` : ''}`;
      if (movimiento.sourceKey !== sourceEsperado) {
        throw new Error(`El saldo inicial debe usar sourceKey ${sourceEsperado}.`);
      }
      this.validarSaldoInicialUnico(movimientosExistentes, movimiento);
    }

    if (movimiento.tipo === 'REVERSA') {
      if (!texto(movimiento.reversaDeMovimientoId)) {
        throw new Error('La reversa debe indicar el movimiento original.');
      }
      const original = movimientosActivos(movimientosExistentes)
        .find(item => item.id === movimiento.reversaDeMovimientoId);
      const reversaExistente = movimientosActivos(movimientosExistentes).find(item =>
        item.tipo === 'REVERSA'
        && item.reversaDeMovimientoId === movimiento.reversaDeMovimientoId
        && item.id !== movimiento.id
      );
      if (reversaExistente) {
        throw new Error('El movimiento original ya tiene una reversa activa.');
      }
      if (original) {
        if (original.direccion === movimiento.direccion) {
          throw new Error('La reversa debe tener dirección contraria al movimiento original.');
        }
        if (Number(original.monto) !== monto) {
          throw new Error('La reversa debe conservar el monto del movimiento original.');
        }
      }
    }
    if (movimiento.tipo === 'COBRO_CUOTA' || movimiento.tipo === 'COBRO_ABONO') {
      if (movimiento.direccion !== 'ingreso') throw new Error('Un cobro de cuota debe ser un ingreso.');
      if (!texto(movimiento.cuotaId) || !texto(movimiento.prestamoId) || !texto(movimiento.clienteId)) {
        throw new Error('El cobro debe identificar cuota, préstamo y cliente.');
      }
      if (!texto(movimiento.pagoId) || !texto(movimiento.componentePagoId)) {
        throw new Error('El cobro debe identificar el pago y su componente.');
      }
      const sourceEsperado = movimiento.tipo === 'COBRO_ABONO'
        ? `COBRO_ABONO:${texto(movimiento.pagoId)}:${texto(movimiento.componentePagoId)}`
        : `COBRO:${texto(movimiento.pagoId)}:${texto(movimiento.componentePagoId)}`;
      if (movimiento.sourceKey !== sourceEsperado) {
        throw new Error(`El cobro debe usar sourceKey ${sourceEsperado}.`);
      }
      const componentes = Array.isArray(movimiento.componentesPago) ? movimiento.componentesPago : [];
      // Compatibilidad: los COBRO_CUOTA confirmados antes de Pago Mixto no
      // tenían composición/fingerprint. No se migran ni se alteran.
      if (componentes.length || texto(movimiento.pagoFingerprint)) {
        if (!componentes.length || !texto(movimiento.pagoFingerprint)) throw new Error('La composición del cobro está incompleta.');
        if (componentes.length > 4) throw new Error('El cobro no admite más de cuatro componentes.');
        const ids = componentes.map(item => texto(item?.componentePagoId));
        if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Los componentes del cobro son inválidos o están repetidos.');
        const suma = componentes.reduce((total, item) => total + Number(item?.monto || 0), 0);
        if (!Number.isFinite(suma) || Math.abs(suma - monto) > 0.009) throw new Error('Los componentes no coinciden con el total cobrado.');
        const fingerprintEsperado = [...componentes]
          .sort((a, b) => texto(a.componentePagoId).localeCompare(texto(b.componentePagoId)))
          .map(item => `${texto(item.componentePagoId)}:${Number(item.monto).toFixed(2)}`).join('|');
        if (movimiento.pagoFingerprint !== fingerprintEsperado) throw new Error('El fingerprint del cobro no coincide con su composición.');
      }
    }
    if (movimiento.tipo === 'COBRO_INTERES_RENOVACION') {
      if (movimiento.direccion !== 'ingreso') throw new Error('El cobro de interés por renovación debe ser un ingreso.');
      if (!texto(movimiento.cuotaId) || !texto(movimiento.prestamoId) || !texto(movimiento.clienteId)) {
        throw new Error('El cobro de interés debe identificar cuota, préstamo y cliente.');
      }
      if (!texto(movimiento.pagoId) || !texto(movimiento.componentePagoId)) {
        throw new Error('El cobro de interés debe identificar el pago y su componente.');
      }
      const sourceEsperado = `COBRO_INTERES_RENOVACION:${texto(movimiento.prestamoId)}:${texto(movimiento.cuotaId)}`;
      if (movimiento.sourceKey !== sourceEsperado) {
        throw new Error(`El cobro de interés debe usar sourceKey ${sourceEsperado}.`);
      }
      const componentes = Array.isArray(movimiento.componentesPago) ? movimiento.componentesPago : [];
      if (componentes.length !== 1) throw new Error('El cobro de interés debe tener un único componente de pago.');
      const componente = componentes[0];
      if (texto(componente.componentePagoId) !== texto(movimiento.componentePagoId)
          || Math.abs(Number(componente.monto) - monto) > 0.009) {
        throw new Error('El componente del cobro de interés no coincide con el movimiento.');
      }
      const fingerprintEsperado = `${texto(componente.componentePagoId)}:${Number(componente.monto).toFixed(2)}`;
      if (movimiento.pagoFingerprint !== fingerprintEsperado) {
        throw new Error('El fingerprint del cobro de interés no coincide con su composición.');
      }
    }
    const tiposVentaPrenda = new Set([
      'VENTA_PRENDA', 'GASTO_VENTA_PRENDA',
      'REVERSA_CORRECCION_VENTA', 'REVERSA_CORRECCION_GASTO',
      'VENTA_PRENDA_CORREGIDA', 'GASTO_VENTA_PRENDA_CORREGIDO'
    ]);
    if (tiposVentaPrenda.has(movimiento.tipo)) {
      const esIngreso = ['VENTA_PRENDA', 'REVERSA_CORRECCION_GASTO', 'VENTA_PRENDA_CORREGIDA'].includes(movimiento.tipo);
      if (!texto(movimiento.prendaId)) throw new Error('El movimiento debe identificar la prenda.');
      if (movimiento.direccion !== (esIngreso ? 'ingreso' : 'egreso')) {
        throw new Error('La dirección del movimiento de venta/corrección es inválida.');
      }
      const source = texto(movimiento.sourceKey);
      if ((movimiento.tipo === 'VENTA_PRENDA' || movimiento.tipo === 'GASTO_VENTA_PRENDA') && source !== `${movimiento.tipo}:${texto(movimiento.prendaId)}`) {
        throw new Error(`El movimiento debe usar sourceKey ${movimiento.tipo}:${texto(movimiento.prendaId)}.`);
      }
      if (!['VENTA_PRENDA', 'GASTO_VENTA_PRENDA'].includes(movimiento.tipo)) {
        const prefijo = `CORRECCION_VENTA:${texto(movimiento.prendaId)}:${texto(movimiento.operationId)}:`;
        if (!texto(movimiento.operationId) || !source.startsWith(prefijo)) {
          throw new Error('El movimiento de corrección debe usar una sourceKey determinista.');
        }
      }
    }
    if (movimiento.automatico === true && !texto(movimiento.sourceKey)) {
      throw new Error('Un movimiento automático requiere sourceKey.');
    }
    return true;
  }

  importeFirmado(movimiento) {
    this.validarMovimiento(movimiento);
    const monto = Number(movimiento.monto);
    return movimiento.direccion === 'ingreso' ? monto : -monto;
  }

  calcularSaldo(movimientos, cuentaId = CUENTA_GENERAL) {
    return movimientosEconomicosUnicos(movimientos)
      .filter(movimiento => (movimiento.cuentaId || CUENTA_GENERAL) === cuentaId)
      .reduce((saldo, movimiento) => saldo + this.importeFirmado(movimiento), 0);
  }

  calcularResumenPeriodo(movimientos, opciones = {}) {
    const cuentaId = opciones.cuentaId || CUENTA_GENERAL;
    const desde = timestamp(opciones.desde);
    const hasta = timestamp(opciones.hasta);
    const filas = movimientosEconomicosUnicos(movimientos).filter(movimiento => {
      if ((movimiento.cuentaId || CUENTA_GENERAL) !== cuentaId) return false;
      const fecha = timestamp(movimiento.fecha || movimiento.createdAt);
      if (desde != null && (fecha == null || fecha < desde)) return false;
      if (hasta != null && (fecha == null || fecha > hasta)) return false;
      return true;
    });
    const ingresos = filas.filter(item => item.direccion === 'ingreso')
      .reduce((total, item) => total + Number(item.monto || 0), 0);
    const egresos = filas.filter(item => item.direccion === 'egreso')
      .reduce((total, item) => total + Number(item.monto || 0), 0);
    return {
      cuentaId,
      ingresos,
      egresos,
      neto: ingresos - egresos,
      cantidad: filas.length,
      retirosPersonales: filas.filter(item => item.tipo === 'RETIRO_PERSONAL')
        .reduce((total, item) => total + Number(item.monto || 0), 0),
      gastosOperativos: filas.filter(item => item.tipo === 'GASTO_OPERATIVO')
        .reduce((total, item) => total + Number(item.monto || 0), 0)
    };
  }

  generarIdAutomatico(sourceKey) {
    const source = texto(sourceKey);
    if (!source) throw new Error('sourceKey es obligatorio para generar un ID automático.');
    const prefijo = source.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    return `MC-${prefijo}-${hashFNV1a(source)}`;
  }

  generarSourceKey(datos = {}) {
    const cuentaId = texto(datos.cuentaId) || CUENTA_GENERAL;
    if (datos.tipo === 'SALDO_INICIAL') return `SALDO_INICIAL:${cuentaId}${texto(datos.resetId) ? `:${texto(datos.resetId)}` : ''}`;
    if (texto(datos.pagoId)) {
      return `COBRO:${texto(datos.pagoId)}:${texto(datos.componentePagoId) || 'UNICO'}`;
    }
    const eventoTipo = texto(datos.eventoTipo || datos.tipo);
    const eventoId = texto(datos.eventoId);
    if (!eventoTipo || !eventoId) throw new Error('eventoTipo y eventoId son obligatorios para generar sourceKey.');
    return `${eventoTipo}:${eventoId}${texto(datos.componentePagoId) ? `:${texto(datos.componentePagoId)}` : ''}`;
  }

  buscarSaldoInicial(movimientos, cuentaId = CUENTA_GENERAL) {
    const saldos = movimientosActivos(movimientos).filter(movimiento =>
      movimiento.tipo === 'SALDO_INICIAL'
      && (movimiento.cuentaId || CUENTA_GENERAL) === cuentaId
    );
    if (saldos.length > 1) throw new Error(`Existe más de un saldo inicial activo para ${cuentaId}.`);
    return saldos[0] || null;
  }

  esCajaIniciada(movimientos, cuentaId = CUENTA_GENERAL) {
    return Boolean(this.buscarSaldoInicial(movimientos, cuentaId));
  }

  obtenerEstadoCaja(movimientos, cuentaId = CUENTA_GENERAL) {
    return this.esCajaIniciada(movimientos, cuentaId) ? 'ACTIVA' : 'NO_INICIADA';
  }

  validarSaldoInicialUnico(movimientos, candidato = null) {
    const cuentaId = candidato?.cuentaId || CUENTA_GENERAL;
    const existentes = movimientosActivos(movimientos).filter(movimiento =>
      movimiento.tipo === 'SALDO_INICIAL'
      && (movimiento.cuentaId || CUENTA_GENERAL) === cuentaId
      && movimiento.id !== candidato?.id
    );
    if (existentes.length) throw new Error(`Ya existe un saldo inicial activo para ${cuentaId}.`);
    return true;
  }
}

export const CAJA_CUENTA_GENERAL = CUENTA_GENERAL;
export const CAJA_SOURCE_SALDO_INICIAL = SOURCE_SALDO_INICIAL;
