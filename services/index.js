import { clienteRepository, prestamoRepository } from '../repositories/index.js';
import { ClienteService }  from './ClienteService.js';
import { PrestamoService } from './PrestamoService.js';
import { AuthService }     from './AuthService.js';

// Composition root: instanciamos cada service e inyectamos sus dependencias.
export const clienteService  = new ClienteService(clienteRepository);
export const prestamoService = new PrestamoService(prestamoRepository);
export const authService     = new AuthService();

// Bridge para el codigo inline legacy. Se elimina cuando la UI migre a modulos.
window.clienteService  = clienteService;
window.prestamoService = prestamoService;
window.authService     = authService;
