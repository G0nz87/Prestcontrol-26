import { ClienteRepository }  from './ClienteRepository.js';
import { PrestamoRepository } from './PrestamoRepository.js';

export const clienteRepository  = new ClienteRepository();
export const prestamoRepository = new PrestamoRepository();

// Bridge para el codigo inline legacy (fbGuardar/fbObtenerTodos/fbEliminar dispatchean por aqui).
// Se elimina cuando services/UI dejen de pasar por window.
window.clienteRepository  = clienteRepository;
window.prestamoRepository = prestamoRepository;
