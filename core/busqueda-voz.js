// Compara transcripciones. No reconoce audio, no escribe ni ejecuta comandos.
import { aliasRegistrados, crearIndiceClientes, buscarEnIndice } from './busqueda.js';

function nombreNormalizado(valor) {
  return String(valor ?? '').toLowerCase().normalize('NFD').replace(/n\u0303/g, 'ñ')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function claveFonetica(valor) {
  // CH, Ñ y vocales se conservan; C/G/Q se transforman según la vocal siguiente.
  return nombreNormalizado(String(valor).toLowerCase().replace(/gü([ei])/g, 'gw$1'))
    .replace(/ch/g, 'X').replace(/ll/g, 'y').replace(/qu(?=[ei])/g, 'k')
    .replace(/gu(?=[ei])/g, 'G').replace(/g(?=[ei])/g, 'j')
    .replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/z/g, 's')
    .replace(/v/g, 'b').replace(/h/g, '').replace(/G/g, 'g').replace(/X/g, 'ch');
}

function clavesPalabra(palabra) {
  const claves = [claveFonetica(palabra)];
  // Variante inicial limitada para nombres como Joni/Yoni o Jesica/Yesica.
  // No se sustituye J por Y en el interior ni en palabras cortas.
  if (palabra.length >= 4 && /^[jy][aeiou]/.test(palabra)) {
    claves.push(claveFonetica((palabra[0] === 'j' ? 'y' : 'j') + palabra.slice(1)));
  }
  return claves;
}

function unaEdicion(a, b) {
  if (!/^[a-zñ]+$/.test(a) || !/^[a-zñ]+$/.test(b)) return false;
  if (a === b || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const distintos = [...a].map((c, i) => c === b[i] ? -1 : i).filter(i => i >= 0);
    return distintos.length === 1 || (distintos.length === 2 && distintos[1] === distintos[0] + 1
      && a[distintos[0]] === b[distintos[1]] && a[distintos[1]] === b[distintos[0]]);
  }
  const corto = a.length < b.length ? a : b, largo = a.length < b.length ? b : a;
  let i = 0, j = 0;
  while (i < corto.length && j < largo.length) {
    if (corto[i] === largo[j]) { i++; j++; } else { j++; if (j - i > 1) return false; }
  }
  return true;
}

function similitudTerminos(terminos, palabras, permitirEdicion = false) {
  // Asignación uno a uno: repetir una palabra no puede reutilizar un solo nombre.
  const opciones = terminos.map(t => palabras.map((p, i) => {
    if (t === p) return { i, coste: 0 };
    if (/^[a-zñ]{3,}$/.test(t) && /^[a-zñ]{3,}$/.test(p)
      && clavesPalabra(t).some(k => clavesPalabra(p).includes(k))) return { i, coste: 1 };
    if (permitirEdicion && unaEdicion(t, p)) return { i, coste: 2 };
    return null;
  }).filter(Boolean)).sort((a, b) => a.length - b.length);
  if (opciones.some(o => !o.length)) return false;
  const visitados = new Set();
  function asignar(pos, usados, ediciones) {
    if (ediciones > 1) return false;
    if (pos === opciones.length) return true;
    const key = `${pos}:${ediciones}:${[...usados].sort((a,b) => a-b).join(',')}`;
    if (visitados.has(key)) return false;
    visitados.add(key);
    for (const o of opciones[pos]) if (!usados.has(o.i)) {
      usados.add(o.i);
      const encontrado = asignar(pos + 1, usados, ediciones + (o.coste === 2 ? 1 : 0));
      usados.delete(o.i);
      if (encontrado) return true;
    }
    return false;
  }
  return asignar(0, new Set(), 0);
}

export function buscarClientesVoz(clientes, consulta) {
  const texto = nombreNormalizado(consulta), terminos = texto.split(' ').filter(Boolean);
  if (!texto || texto.length > 160 || terminos.length > 8) return [];
  const vigentes = [...new Map(clientes.filter(c => c && !c._deleted).map(c => [String(c.id), c])).values()];
  // La búsqueda por voz usa solo identidad/nombres y alias registrados, sin notas/direcciones.
  const identidades = vigentes.map(c => ({ id: c.id, nombre: c.nombre, aliases: aliasRegistrados(c) }));
  const porTexto = new Map(buscarEnIndice(crearIndiceClientes(identidades), consulta).map((c, i) => [String(c.id), i]));
  const literal = valor => String(valor ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const original = literal(consulta);
  return vigentes.map((cliente, posicion) => {
    const alias = aliasRegistrados(cliente), nombres = [cliente.nombre, ...alias];
    let prioridad, tipo;
    if (literal(cliente.nombre) === original) { prioridad = 0; tipo = 'Nombre exacto'; }
    else if (alias.some(a => literal(a) === original)) { prioridad = 1; tipo = 'Alias exacto registrado'; }
    else if (nombres.some(n => nombreNormalizado(n) === texto) || nombreNormalizado(cliente.id) === texto) {
      prioridad = 2; tipo = 'Coincidencia normalizada';
    } else if (porTexto.has(String(cliente.id)) && terminos.every(t => nombres.some(n => nombreNormalizado(n).includes(t))
      || nombreNormalizado(cliente.id).includes(t))) { prioridad = 3; tipo = 'Coincidencia parcial'; }
    else {
      const palabras = nombres.map(nombreNormalizado).join(' ').split(' ').filter(Boolean);
      const foneticas = similitudTerminos(terminos, palabras);
      if (!foneticas && !similitudTerminos(terminos, palabras, true)) return null;
      prioridad = foneticas ? 4 : 5;
      tipo = foneticas ? 'Coincidencia fonética aproximada' : 'Similitud de escritura aproximada';
    }
    return { cliente, prioridad, tipo, aproximada: prioridad >= 4, posicion, ordenTexto: porTexto.get(String(cliente.id)) ?? posicion };
  }).filter(Boolean).sort((a, b) => a.prioridad - b.prioridad || a.ordenTexto - b.ordenTexto || a.posicion - b.posicion);
}
