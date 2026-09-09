// Composition root de la capa UI. Importa cada modulo de handlers y los
// expone en window — el HTML los invoca via onclick="funcionName()".
// Cada sub-step de Step 5 agrega un import + bridge.

import {
  openSheetCliente,
  editarCliente,
  saveCliente,
  confirmarBorrarCliente,
  borrarCliente
} from './clientes.js';

import {
  openSheetPrestamo,
  savePrestamo,
  abrirRenovacionPrestamo,
  calcularPreviewRenovacion,
  confirmarRenovacionPrestamo,
  abrirComprobanteRenovacion,
  evaluarCobroInteresRenovacionCapital,
  abrirCobroInteresRenovacionCapital,
  calcularPreviewRenovacionCapital,
  confirmarCobroInteresRenovacionCapital,
  confirmarEjecutarPrestamo,
  confirmarBorrarPrestamo,
  selMotivo,
  confirmarBorrarPrestamoFinal
} from './prestamos.js';

import {
  actualizarPrestamosPrenda,
  openSheetPrenda,
  savePrenda,
  renderPrendas,
  openPrendaDetail,
  cambiarEstadoPrenda,
  borrarPrenda,
  openPonerPrendaEnVenta,
  guardarPrendaEnVenta,
  openRegistrarVentaPrenda,
  guardarVentaPrenda,
  actualizarResumenVentaPrenda,
  openCorregirVentaPrenda,
  guardarCorreccionVentaPrenda,
  toggleGarantiaNuevoPrestamo,
  resetGarantiaNuevoPrestamo,
  obtenerGarantiaNuevoPrestamo,
  crearPrendaLocalParaPrestamo,
  openAgregarGarantiaPrestamo,
  cargarGarantiasEdicionPrestamo,
  prendaEstadoBadge
} from './prendas.js';
import {
  renderCaja,
  setPeriodoCaja,
  setTipoFiltroCaja,
  openIniciarCaja,
  confirmarSaldoInicial,
  openMovimientoCaja,
  guardarMovimientoCaja,
  actualizarDireccionMovimientoCaja,
  openReversaCaja,
  confirmarReversaCaja
} from './caja.js';

// Bridge clientes (5a)
window.openSheetCliente       = openSheetCliente;
window.editarCliente          = editarCliente;
window.saveCliente            = saveCliente;
window.confirmarBorrarCliente = confirmarBorrarCliente;
window.borrarCliente          = borrarCliente;

// Bridge prestamos (5b)
window.openSheetPrestamo            = openSheetPrestamo;
window.savePrestamo                 = savePrestamo;
window.abrirRenovacionPrestamo      = abrirRenovacionPrestamo;
window.calcularPreviewRenovacion    = calcularPreviewRenovacion;
window.confirmarRenovacionPrestamo  = confirmarRenovacionPrestamo;
window.abrirComprobanteRenovacion   = abrirComprobanteRenovacion;
window.evaluarCobroInteresRenovacionCapital = evaluarCobroInteresRenovacionCapital;
window.abrirCobroInteresRenovacionCapital = abrirCobroInteresRenovacionCapital;
window.calcularPreviewRenovacionCapital = calcularPreviewRenovacionCapital;
window.confirmarCobroInteresRenovacionCapital = confirmarCobroInteresRenovacionCapital;
window.confirmarEjecutarPrestamo    = confirmarEjecutarPrestamo;
window.confirmarBorrarPrestamo      = confirmarBorrarPrestamo;
window.selMotivo                    = selMotivo;
window.confirmarBorrarPrestamoFinal = confirmarBorrarPrestamoFinal;

// Bridge prendas (Etapa 12, Fase 1B)
window.actualizarPrestamosPrenda = actualizarPrestamosPrenda;
window.openSheetPrenda           = openSheetPrenda;
window.savePrenda                = savePrenda;
window.renderPrendas             = renderPrendas;
window.openPrendaDetail          = openPrendaDetail;
window.cambiarEstadoPrenda       = cambiarEstadoPrenda;
window.borrarPrenda              = borrarPrenda;
window.openPonerPrendaEnVenta    = openPonerPrendaEnVenta;
window.guardarPrendaEnVenta      = guardarPrendaEnVenta;
window.openRegistrarVentaPrenda  = openRegistrarVentaPrenda;
window.guardarVentaPrenda        = guardarVentaPrenda;
window.actualizarResumenVentaPrenda = actualizarResumenVentaPrenda;
window.openCorregirVentaPrenda   = openCorregirVentaPrenda;
window.guardarCorreccionVentaPrenda = guardarCorreccionVentaPrenda;
window.toggleGarantiaNuevoPrestamo = toggleGarantiaNuevoPrestamo;
window.resetGarantiaNuevoPrestamo  = resetGarantiaNuevoPrestamo;
window.obtenerGarantiaNuevoPrestamo = obtenerGarantiaNuevoPrestamo;
window.crearPrendaLocalParaPrestamo = crearPrendaLocalParaPrestamo;
window.openAgregarGarantiaPrestamo  = openAgregarGarantiaPrestamo;
window.cargarGarantiasEdicionPrestamo = cargarGarantiasEdicionPrestamo;
window.prendaEstadoBadge         = prendaEstadoBadge;

window.renderCaja = renderCaja;
window.setPeriodoCaja = setPeriodoCaja;
window.setTipoFiltroCaja = setTipoFiltroCaja;
window.openIniciarCaja = openIniciarCaja;
window.confirmarSaldoInicial = confirmarSaldoInicial;
window.openMovimientoCaja = openMovimientoCaja;
window.guardarMovimientoCaja = guardarMovimientoCaja;
window.actualizarDireccionMovimientoCaja = actualizarDireccionMovimientoCaja;
window.openReversaCaja = openReversaCaja;
window.confirmarReversaCaja = confirmarReversaCaja;
