import { clienteRepository, prestamoRepository } from '../repositories/index.js';
import { ClienteService }  from './ClienteService.js';
import { PrestamoService } from './PrestamoService.js';
import { AuthService }     from './AuthService.js';
import { MetricasFinancierasService } from './MetricasFinancierasService.js';
import { CajaService } from './CajaService.js';
import { CajaAperturaService } from './CajaAperturaService.js';
import { CargaHistoricaService } from './CargaHistoricaService.js';
import { RiesgoClienteService } from './RiesgoClienteService.js';

// Composition root: instanciamos cada service e inyectamos sus dependencias.
export const clienteService  = new ClienteService(clienteRepository);
export const prestamoService = new PrestamoService(prestamoRepository);
export const authService     = new AuthService();
export const metricasFinancierasService = new MetricasFinancierasService();
export const cajaService = new CajaService();
export const cajaAperturaService = new CajaAperturaService(cajaService);
export const cargaHistoricaService = new CargaHistoricaService(prestamoService, metricasFinancierasService);
export const riesgoClienteService = new RiesgoClienteService();

// Bridge para el codigo inline legacy. Se elimina cuando la UI migre a modulos.
window.clienteService  = clienteService;
window.prestamoService = prestamoService;
window.authService     = authService;
window.metricasFinancierasService = metricasFinancierasService;
window.cajaService = cajaService;
window.cajaAperturaService = cajaAperturaService;
window.cargaHistoricaService = cargaHistoricaService;
window.riesgoClienteService = riesgoClienteService;
