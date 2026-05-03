// Logica de negocio de Prestamos.
// No conoce Firebase ni DOM — solo opera sobre datos vía el repository inyectado.

export class PrestamoService {
  constructor(prestamoRepository) {
    if (!prestamoRepository) throw new Error('PrestamoService: prestamoRepository requerido');
    this.repo = prestamoRepository;
  }

  getAll() {
    return this.repo.getAll();
  }

  getById(id) {
    return this.repo.getById(id);
  }

  save(prestamo) {
    return this.repo.save(prestamo);
  }

  delete(id) {
    return this.repo.softDelete(id);
  }
}
