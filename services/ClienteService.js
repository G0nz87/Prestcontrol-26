// Logica de negocio de Clientes.
// No conoce Firebase ni DOM — solo opera sobre datos vía el repository inyectado.

const _RE_DNI      = /^\d{7,8}$/;
const _RE_TELEFONO = /^[\d\s+\-()]+$/;

export class ClienteService {
  constructor(clienteRepository) {
    if (!clienteRepository) throw new Error('ClienteService: clienteRepository requerido');
    this.repo = clienteRepository;
  }

  // ── CRUD ─────────────────────────────────────────────
  getAll()         { return this.repo.getAll(); }
  getById(id)      { return this.repo.getById(id); }
  save(cliente)    { return this.repo.save(cliente); }
  delete(id)       { return this.repo.softDelete(id); }

  // ── Validacion ───────────────────────────────────────
  // Lanza Error con mensaje user-facing en el primer dato invalido.
  // id: opcional. Si se provee (modo edit), se excluye del check de duplicados.
  // dni y telefono son opcionales — solo se validan si vienen con valor.
  async validarDatosCliente({ id, nombre, dni, telefono }) {
    if (!nombre) throw new Error('El nombre es obligatorio');

    if (dni) {
      if (!_RE_DNI.test(dni)) {
        throw new Error('El DNI debe ser numérico y tener 7 u 8 dígitos');
      }
      const todos = await this.repo.getAll();
      const dup = todos.find(c =>
        !c._deleted &&
        c.dni === dni &&
        c.id !== id
      );
      if (dup) throw new Error(`Ya existe un cliente con ese DNI: ${dup.nombre}`);
    }

    if (telefono && !_RE_TELEFONO.test(telefono)) {
      throw new Error('Teléfono inválido (sólo dígitos, espacios y + - ( ))');
    }
  }
}
