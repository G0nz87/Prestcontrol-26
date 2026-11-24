// Solo datos de Clientes. Las columnas de revisión nunca se convierten en IDs.
export const COLUMNAS_CLIENTES = [
  'Nº auxiliar', 'Nombre o alias', 'Teléfono', 'Identidad',
  '¿Ya está en PrestControl?', '¿Autorizar importación?', 'Menciones seleccionadas',
  'Páginas PDF', 'Persona familiar separada', 'Etiquetas elegidas', 'Duda',
  'Parentesco', 'Observaciones'
];

const texto = valor => String(valor ?? '').trim();
const normalizar = valor => texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const esNo = valor => /^(no|n|false|0)(?:\s|$)/.test(normalizar(valor));
const esSi = valor => /^(si|s|yes|true|1)(?:\s|$)/.test(normalizar(valor));

export function contarClientes(clientes) {
  const visibles = clientes.filter(c => !c._deleted);
  const conTelefono = visibles.filter(c => texto(c.telefono)).length;
  return { total: visibles.length, conTelefono, sinTelefono: visibles.length - conTelefono };
}

export async function leerCandidatosClientes(wb, XLSX, cryptoApi = globalThis.crypto) {
  const hoja = 'Para PrestControl';
  if (!wb.SheetNames.includes(hoja)) throw new Error('Falta la hoja Para PrestControl. No se importan hojas de menciones ni financieras.');
  const ws = wb.Sheets[hoja];
  const rango = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  if (rango.e.r > 5000 || rango.e.c > 100) throw new Error('La hoja supera el límite de 5000 filas o 101 columnas.');
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
  const encabezados = (filas[0] || []).map(normalizar);
  const indices = COLUMNAS_CLIENTES.map(nombre => {
    const clave = normalizar(nombre);
    if (encabezados.filter(h => h === clave).length !== 1) throw new Error('Columna faltante o repetida: ' + nombre);
    return encabezados.indexOf(clave);
  });
  if (!cryptoApi?.subtle) throw new Error('La importación requiere HTTPS o localhost para reconocer filas ya importadas.');
  const repeticiones = new Map();
  const candidatos = [];
  for (let i = 1; i < filas.length; i++) {
    if (!filas[i].some(v => texto(v))) continue;
    const valores = indices.map(j => texto(filas[i][j]));
    const contenido = JSON.stringify([hoja, ...valores]);
    const ocurrencia = (repeticiones.get(contenido) || 0) + 1;
    repeticiones.set(contenido, ocurrencia);
    const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(contenido + ':' + ocurrencia));
    const clave = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const revision = Object.fromEntries(COLUMNAS_CLIENTES.map((col, j) => [col, valores[j]]));
    const nombre = valores[1], telefono = valores[2];
    const errores = [];
    if (!nombre) errores.push('Falta nombre o alias');
    if (telefono && (!/^[\d\s+\-()]+$/.test(telefono) || !/\d/.test(telefono))) errores.push('Teléfono inválido; corregí el archivo en una copia antes de importar');
    // No evaluar fórmulas ni tomar su resultado cacheado como identidad de una persona.
    if (indices.some(j => ws[XLSX.utils.encode_cell({ r: rango.s.r + i, c: rango.s.c + j })]?.f)) errores.push('Fila con fórmula; reemplazala por valores en una copia');
    const advertencias = [];
    if (!telefono) advertencias.push('Sin teléfono (permitido)');
    if (valores[10] && !esNo(valores[10])) advertencias.push('Duda: ' + valores[10]);
    if (valores[3]) advertencias.push('Identidad: ' + valores[3]);
    if (valores[8] && !esNo(valores[8])) advertencias.push('Familiar independiente: ' + valores[8]);
    if (valores[11]) advertencias.push('Parentesco: ' + valores[11]);
    if (esSi(valores[4])) advertencias.push('Marcado como existente en Excel');
    if (!esSi(valores[5])) advertencias.push('Autorización en Excel: ' + (valores[5] || 'sin completar') + '; revisá la selección');
    if (nombre.split(/\s+/).length === 1 || /[?¿]/.test(nombre)) advertencias.push('Nombre o alias ambiguo; se conserva literalmente');
    candidatos.push({ fila: rango.s.r + i + 1, clave, nombre, telefono, notas: valores[12], revision,
      errores, advertencias, autorizado: !esNo(valores[5]), declaradoExistente: esSi(valores[4]) });
  }
  if (!candidatos.length) throw new Error('La hoja no contiene contactos candidatos.');
  return candidatos;
}

export function coincidenciasCliente(candidato, clientes, normalizarTelefono) {
  const nombre = normalizar(candidato.nombre);
  const telefono = normalizarTelefono(candidato.telefono);
  const coincidencias = clientes.filter(c => !c._deleted).flatMap(c => {
    const motivos = [];
    const nombres = [c.nombre, c.alias, c.apodo, ...(Array.isArray(c.aliases) ? c.aliases : [])].filter(Boolean).map(normalizar);
    if (nombre && nombres.includes(nombre)) motivos.push('nombre o alias');
    // Dos palabras compartidas permiten avisar sobre un nombre ampliado; un apellido solo no alcanza.
    else if (nombre && nombres.some(n => {
      const a = new Set(nombre.split(' ').filter(t => t.length > 2));
      const b = new Set(n.split(' ').filter(t => t.length > 2));
      return [...a].filter(t => b.has(t)).length >= 2;
    })) motivos.push('nombre similar');
    if (telefono && telefono === normalizarTelefono(c.telefono)) motivos.push('teléfono');
    return motivos.length ? [{ id: c.id, nombre: c.nombre, motivos }] : [];
  });
  // La réplica local y Firebase pueden describir el mismo registro.
  const unicas = new Map();
  for (const c of coincidencias) {
    const previa = unicas.get(c.id);
    unicas.set(c.id, { ...c, motivos: [...new Set([...(previa?.motivos || []), ...c.motivos])] });
  }
  return [...unicas.values()];
}

export function revisarCandidatosClientes(candidatos, clientes, normalizarTelefono) {
  return candidatos.map(c => {
    const exacto = clientes.find(cli => cli.importacionExcel?.version === 1 && cli.importacionExcel.clave === c.clave);
    const coincidencias = coincidenciasCliente(c, clientes, normalizarTelefono);
    const dentroArchivo = candidatos.filter(otro => otro !== c && coincidenciasCliente(c, [
      { id: 'fila ' + otro.fila, nombre: otro.nombre, telefono: otro.telefono }
    ], normalizarTelefono).length).map(otro => otro.fila);
    const posible = c.declaradoExistente || coincidencias.length > 0 || dentroArchivo.length > 0;
    return { ...c, exacto: exacto ? { id: exacto.id, eliminado: Boolean(exacto._deleted) } : null,
      coincidencias, dentroArchivo, posible,
      seleccionado: c.seleccionado ?? (!exacto && !c.errores.length && !posible && c.autorizado) };
  });
}

export function resumenCandidatosClientes(candidatos) {
  const aptos = candidatos.filter(c => !c.exacto && !c.errores.length);
  const seleccionados = aptos.filter(c => c.seleccionado);
  return {
    total: candidatos.length, seleccionados: seleccionados.length,
    posibles: aptos.filter(c => c.posible).length, nuevos: aptos.filter(c => !c.posible).length,
    advertencias: candidatos.filter(c => c.advertencias.length || c.posible).length,
    errores: candidatos.filter(c => c.errores.length).length, exactos: candidatos.filter(c => c.exacto).length,
    duplicadosSeleccionados: seleccionados.filter(c => c.posible).length,
    omitidos: candidatos.length - seleccionados.length
  };
}
