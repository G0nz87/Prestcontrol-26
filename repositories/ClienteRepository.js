import { Repository } from './Repository.js';

export class ClienteRepository extends Repository {
  constructor() {
    super('clientes');
  }
}
