// Autoridad remota de apertura. No accede al DOM ni a IndexedDB.
export const APERTURA_CONTROL_ID = 'apertura_GENERAL';
export const APERTURA_MOVIMIENTO_ID = 'MC-APERTURA-GENERAL-V1';

const CAMPOS_APERTURA = ['id', 'tipo', 'direccion', 'monto', 'fecha', 'concepto', 'nota', 'medioPago', 'cuentaId', 'resetId', 'sourceKey', 'createdAt', 'operationId', 'createdByUid', 'deviceId', '_deleted', 'deletedAt'];

export function mismaApertura(a, b) {
  return Boolean(a && b) && CAMPOS_APERTURA.every(campo =>
    String(a[campo] ?? '') === String(b[campo] ?? '')
  );
}

export class CajaAperturaService {
  constructor(cajaService) { this.caja = cajaService; }
  mismaApertura(a, b) { return mismaApertura(a, b); }

  validarConfirmada(movimiento) {
    this.caja.validarMovimiento(movimiento);
    if (movimiento.tipo !== 'SALDO_INICIAL' || movimiento.cuentaId !== 'GENERAL' || movimiento._deleted === true) {
      throw new Error('La apertura confirmada de Caja es inconsistente. No se modificó.');
    }
    return movimiento;
  }

  async resolver({ db, uid, candidato = null, serverTimestamp }) {
    if (!db?.runTransaction || !uid || !serverTimestamp) throw new Error('Se necesita una sesión y conexión para confirmar la apertura.');
    const user = db.collection('users').doc(uid);
    const controlRef = user.collection('control_caja').doc(APERTURA_CONTROL_ID);
    const cargaRef = user.collection('carga_inicial').doc('estado');
    const movimientos = user.collection('movimientos_caja');
    // La consulta no decide la apertura. La decisión se repite dentro de la
    // transacción sobre el documento fijo. Las reglas impiden altas legacy.
    const previo = await controlRef.get({ source: 'server' });
    let anteriores = [];
    if (!previo.exists) {
      const snap = await movimientos.where('tipo', '==', 'SALDO_INICIAL').get({ source: 'server' });
      anteriores = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      if (anteriores.filter(m => m._deleted !== true).length > 1) {
        throw new Error('Hay varias aperturas existentes. Se requiere revisión; no se alteró Caja.');
      }
      if (!anteriores.length && candidato) {
        const otros = await movimientos.limit(1).get({ source: 'server' });
        if (!otros.empty) throw new Error('Hay movimientos sin una apertura identificable. Se requiere revisión.');
      }
    }
    let creada = false;
    await db.runTransaction(async tx => {
      creada = false; // El callback puede repetirse por concurrencia.
      const [control, cuenta, carga] = await Promise.all([tx.get(controlRef), tx.get(user), tx.get(cargaRef)]);
      if (['preparando', 'activa'].includes(carga.data()?.estado)) {
        throw new Error('Finalizá la carga histórica y confirmá el corte operativo antes de abrir Caja.');
      }
      const reset = cuenta.data()?.prestcontrolDataReset;
      if (reset?.status && reset.status !== 'completed') throw new Error('Hay un reinicio de datos en curso. No se puede confirmar Caja.');
      if (control.exists) {
        const autoridad = control.data();
        if (autoridad.version !== 1 || autoridad.cuentaId !== 'GENERAL' || !autoridad.movimientoId) throw new Error('Autoridad de apertura inválida. Se requiere revisión.');
        const actual = await tx.get(movimientos.doc(autoridad.movimientoId));
        if (!actual.exists) throw new Error('Falta el movimiento de la apertura protegida. Se requiere revisión.');
        this.validarConfirmada({ ...actual.data(), id: actual.id });
        return;
      }
      const activos = anteriores.filter(m => m._deleted !== true);
      if (!activos.length && anteriores.length) throw new Error('Existe una apertura eliminada anteriormente. No se reiniciará Caja automáticamente.');
      let movimiento;
      if (activos.length) {
        const anterior = await tx.get(movimientos.doc(activos[0].id));
        if (!anterior.exists || !mismaApertura(activos[0], { ...anterior.data(), id: anterior.id })) throw new Error('La apertura anterior cambió. Reintentá su recuperación.');
        movimiento = this.validarConfirmada({ ...anterior.data(), id: anterior.id });
      } else if (candidato) {
        movimiento = this.validarConfirmada({ ...candidato, id: APERTURA_MOVIMIENTO_ID, userId: uid });
        const ocupado = await tx.get(movimientos.doc(movimiento.id));
        if (ocupado.exists) throw new Error('El identificador reservado de apertura está ocupado. Se requiere revisión.');
        tx.set(movimientos.doc(movimiento.id), movimiento);
        creada = true;
      } else {
        return;
      }
      tx.set(controlRef, {
        version: 1, cuentaId: 'GENERAL', movimientoId: movimiento.id,
        userId: uid, confirmadaAt: serverTimestamp()
      });
    });
    // Leer del servidor también resuelve una respuesta de commit perdida en
    // un intento anterior. Nunca se anuncia éxito por una réplica en caché.
    const confirmada = await controlRef.get({ source: 'server' });
    if (!confirmada.exists) return null;
    const autoridad = confirmada.data();
    const snap = await movimientos.doc(autoridad.movimientoId).get({ source: 'server' });
    if (!snap.exists) throw new Error('No se pudo recuperar la apertura confirmada. Reintentá con conexión.');
    const movimiento = this.validarConfirmada({ ...snap.data(), id: snap.id });
    return { movimiento, autoridad, creada };
  }

  preservarEnRespaldo(data, confirmada) {
    const movimientos = Array.isArray(data.movimientosCaja) ? data.movimientosCaja : [];
    const aperturas = movimientos.filter(m => m.tipo === 'SALDO_INICIAL' && m._deleted !== true);
    if (!confirmada) {
      if (aperturas.length) throw new Error('El respaldo contiene una apertura que el servidor no confirmó. No se restauró.');
      return data;
    }
    const actual = confirmada.movimiento;
    if (aperturas.some(m => !mismaApertura(m, actual))) throw new Error('La apertura del respaldo difiere de la confirmada. No se restauró ni modificó Caja.');
    // Un respaldo anterior a la apertura nunca elimina la decisión remota.
    return { ...data, movimientosCaja: [...movimientos.filter(m => m.id !== actual.id), actual] };
  }
}
