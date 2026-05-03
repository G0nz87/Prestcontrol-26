// Logica de negocio de Clientes.
// No conoce Firebase ni DOM — solo opera sobre datos vía el repository inyectado.

export class ClienteService {
  constructor(clienteRepository) {
    if (!clienteRepository) throw new Error('ClienteService: clienteRepository requerido');
    this.repo = clienteRepository;
  }

  getAll() {
    return this.repo.getAll();
  }

  getById(id) {
    return this.repo.getById(id);
  }

  save(cliente) {
    return this.repo.save(cliente);
  }

  delete(id) {
    return this.repo.softDelete(id);
  }
}
