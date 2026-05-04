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

window.openSheetCliente       = openSheetCliente;
window.editarCliente          = editarCliente;
window.saveCliente            = saveCliente;
window.confirmarBorrarCliente = confirmarBorrarCliente;
window.borrarCliente          = borrarCliente;
