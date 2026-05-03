// Logica de negocio de Prestamos.
// No conoce Firebase, no conoce DOM. Devuelve datos crudos o lanza errores.
// Utiliza window.addWeeks/addMonths/round2 (utils inline globales — bridge consistente
// con el patron de pasos previos; se desbridgea cuando los utils se modularicen).

export class PrestamoService {
  constructor(prestamoRepository) {
    if (!prestamoRepository) throw new Error('PrestamoService: prestamoRepository requerido');
    this.repo = prestamoRepository;
  }

  // ── CRUD (delegacion al repository) ─────────────────
  getAll()         { return this.repo.getAll(); }
  getById(id)      { return this.repo.getById(id); }
  save(prestamo)   { return this.repo.save(prestamo); }
  delete(id)       { return this.repo.softDelete(id); }

  // ── Reglas de validacion ────────────────────────────
  // Lanza Error con mensaje user-facing. La UI atrapa y toastea.
  validarDatosPrestamo({ clienteId, monto, tasaPorCuota, nCuotas, fecha }) {
    if (!clienteId)                                  throw new Error('Seleccioná un cliente');
    if (!monto || monto <= 0)                        throw new Error('Ingresá el monto');
    if (isNaN(tasaPorCuota) || tasaPorCuota < 0)     throw new Error('Ingresá el interés por cuota');
    if (!nCuotas || nCuotas <= 0)                    throw new Error('Ingresá el número de cuotas');
    if (!fecha)                                      throw new Error('Ingresá la fecha');
  }

  // ── Calculos financieros ────────────────────────────
  // tasaPorCuota es un porcentaje (ej: 8 = 8%). nCuotas es entero.
  calcularPlanPagos(monto, tasaPorCuota, nCuotas) {
    const interesTotal = (tasaPorCuota / 100) * nCuotas;
    const total        = window.round2(monto * (1 + interesTotal));
    const cuotaMonto   = window.round2(total / nCuotas);
    const ganancia     = window.round2(total - monto);
    return { interesTotal, total, cuotaMonto, ganancia };
  }

  // Devuelve Date. tipo: 'Semanal' | 'Mensual'. i: indice 1-based.
  calcularVencimiento(fechaBase, tipo, i) {
    return tipo === 'Semanal' ? window.addWeeks(fechaBase, i) : window.addMonths(fechaBase, i);
  }

  // Construye el array de cuotas para un prestamo nuevo. Pure: no toca DB.
  // primerNumeroId: numero entero a partir del cual se generan los IDs C-NNN.
  // nowISO: timestamp compartido con el prestamo (para que creadoEn/updatedAt coincidan).
  generarCuotas({ prestamoId, clienteId, clienteNombre, fechaInicio, tipo, nCuotas, cuotaMonto, primerNumeroId, nowISO }) {
    const ts = nowISO || new Date().toISOString();
    const cuotas = [];
    for (let i = 1; i <= nCuotas; i++) {
      const fvenc = this.calcularVencimiento(fechaInicio, tipo, i);
      cuotas.push({
        id           : `C-${String(primerNumeroId + i - 1).padStart(3, '0')}`,
        prestamoId,
        clienteId,
        clienteNombre,
        nro          : i,
        fechaVenc    : fvenc.toISOString(),
        monto        : cuotaMonto,
        estado       : 'Pendiente',
        fechaPago    : null,
        metodo       : null,
        notas        : '',
        creadoEn     : ts,
        updatedAt    : ts
      });
    }
    return cuotas;
  }

  // ── Transiciones de estado ──────────────────────────
  // Devuelve el estado nuevo dado el conjunto de cuotas no-borradas.
  // Devuelve null si no hay cuotas (para que el caller decida no transicionar).
  // El caller debe respetar el guard "no salir de Cancelado".
  calcularEstado(cuotas) {
    if (!cuotas || !cuotas.length) return null;
    if (cuotas.every(c => c.estado === 'Pagado'))   return 'Pagado';
    if (cuotas.some(c  => c.estado === 'Atrasado')) return 'Atrasado';
    return 'Activo';
  }

  // ── Evaluacion de riesgo (datos crudos, sin presentacion) ──
  // El mapeo nivel -> {label, icono, color} vive en la UI.
  evaluarRiesgo(cuotas) {
    if (!cuotas || !cuotas.length) {
      return {
        nivel: 'sin_historial',
        pctCumplimiento: 0,
        diasPromedio: 0,
        cuotasPagadas: 0,
        cuotasAtrasadas: 0,
        totalCuotas: 0,
        tieneAtrasadas: false
      };
    }
    const pagadas   = cuotas.filter(c => c.estado === 'Pagado');
    const atrasadas = cuotas.filter(c => c.estado === 'Atrasado');

    let diasAtrasoTotal = 0, conAtraso = 0;
    pagadas.forEach(c => {
      if (c.fechaPago && c.fechaVenc) {
        const dias = Math.floor((new Date(c.fechaPago) - new Date(c.fechaVenc)) / 86400000);
        if (dias > 0) { diasAtrasoTotal += dias; conAtraso++; }
      }
    });

    const diasPromedio    = conAtraso > 0 ? diasAtrasoTotal / conAtraso : 0;
    const tieneAtrasadas  = atrasadas.length > 0;
    const pctCumplimiento = Math.round(pagadas.length / cuotas.length * 100);

    let nivel;
    if (tieneAtrasadas && atrasadas.length >= 2)             nivel = 'alto';
    else if (diasPromedio > 14 || tieneAtrasadas)            nivel = 'medio';
    else if (pctCumplimiento === 100 && pagadas.length >= 3) nivel = 'excelente';
    else                                                      nivel = 'bajo';

    return {
      nivel,
      pctCumplimiento,
      diasPromedio,
      cuotasPagadas: pagadas.length,
      cuotasAtrasadas: atrasadas.length,
      totalCuotas: cuotas.length,
      tieneAtrasadas
    };
  }
}
