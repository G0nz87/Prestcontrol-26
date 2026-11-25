// Índices de lectura en memoria. No guarda datos ni conoce Firebase.
export function normalizarBusqueda(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function aliasRegistrados(cliente) {
  return [cliente?.alias, cliente?.apodo,
    ...(Array.isArray(cliente?.aliases) ? cliente.aliases : [cliente?.aliases]),
    ...(Array.isArray(cliente?.apodos) ? cliente.apodos : [cliente?.apodos])].filter(Boolean);
}

function crearIndice(registros, campos) {
  const ids = new Set();
  return registros.filter(r => {
    if (!r || r._deleted || (r.id != null && ids.has(String(r.id)))) return false;
    if (r.id != null) ids.add(String(r.id));
    return true;
  }).map((registro, posicion) => {
    const datos = campos(registro);
    const principales = datos.principales.map(normalizarBusqueda).filter(Boolean);
    const otros = datos.otros.map(normalizarBusqueda).filter(Boolean);
    return { registro, posicion, principales, campos: [...principales, ...otros] };
  });
}

export function crearIndiceClientes(clientes) {
  return crearIndice(clientes, c => ({
    principales: [c.nombre, c.id, String(c.id || '').replace(/[^a-z0-9]/gi, '')],
    // Se conserva la búsqueda anterior por dirección; las notas no son nombres.
    otros: [...aliasRegistrados(c), c.dni, c.telefono, c.direccion,
      String(c.telefono || '').replace(/\D/g, ''), String(c.dni || '').replace(/\D/g, '')]
  }));
}

export function crearIndicePrestamos(prestamos, clientes) {
  const porId = new Map(clientes.filter(c => !c._deleted).map(c => [String(c.id), c]));
  return crearIndice(prestamos, p => {
    const cliente = porId.get(String(p.clienteId));
    return { principales: [p.clienteNombre, cliente?.nombre, p.id, String(p.id || '').replace(/[^a-z0-9]/gi, '')],
      otros: aliasRegistrados(cliente) };
  });
}

export function crearIndicePrendas(prendas, clientes) {
  const porId = new Map(clientes.filter(c => !c._deleted).map(c => [String(c.id), c]));
  return crearIndice(prendas, p => {
    const cliente = porId.get(String(p.clienteId));
    return { principales: [cliente?.nombre, p.id, p.descripcion],
      otros: [...aliasRegistrados(cliente), cliente?.telefono, cliente?.dni,
        String(cliente?.telefono || '').replace(/\D/g, ''), String(cliente?.dni || '').replace(/\D/g, ''),
        p.categoria, p.marca, p.modelo, p.numeroSerie, p.imei, p.prestamoId] };
  });
}

export function buscarEnIndice(indice, consulta, permitidos = null) {
  const texto = normalizarBusqueda(consulta);
  const terminos = texto.split(' ').filter(Boolean);
  const candidatos = permitidos ? indice.filter(i => permitidos.has(i.registro.id)) : indice;
  if (!terminos.length) return candidatos.map(i => i.registro);
  return candidatos.filter(i => terminos.every(t => i.campos.some(c => c.includes(t))))
    .map(i => {
      let prioridad = 4;
      if (i.principales.some(c => c === texto)) prioridad = 0;
      else if (i.principales.some(c => c.startsWith(texto))) prioridad = 1;
      else if (terminos.every(t => i.principales.some(c => c.split(' ').some(p => p.startsWith(t))))) prioridad = 2;
      else if (terminos.every(t => i.principales.some(c => c.includes(t)))) prioridad = 3;
      return { ...i, prioridad };
    }).sort((a, b) => a.prioridad - b.prioridad || a.posicion - b.posicion)
    .map(i => i.registro);
}
