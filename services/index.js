import { clienteRepository, prestamoRepository } from '../repositories/index.js';
import { ClienteService }  from './ClienteService.js';
import { PrestamoService } from './PrestamoService.js';

// DI: el composition root inyecta cada repository en su service correspondiente.
export const clienteService  = new ClienteService(clienteRepository);
export const prestamoService = new PrestamoService(prestamoRepository);

// Bridge para el codigo inline legacy. Se elimina cuando la UI migre a modulos.
window.clienteService  = clienteService;
window.prestamoService = prestamoService;
