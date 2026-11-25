import { crearIndiceClientes, buscarEnIndice } from '../core/busqueda.js';
import { contextoBuscadores, mismoContextoBuscadores } from './buscadores.js';

export function prepararSelectorClientes(elemento, clientes) {
  if (!elemento) return;
  elemento._selectorClientes = { contexto: contextoBuscadores(), indice: crearIndiceClientes(clientes) };
}

export function pintarSelectorClientes(elemento, consulta, seleccionar, { limite = 12, mostrarVacio = false, bloqueados = false } = {}) {
  const estado = elemento?._selectorClientes;
  if (!elemento) return;
  elemento.replaceChildren();
  if (!estado || !mismoContextoBuscadores(estado.contexto)) {
    elemento.classList.remove('on'); elemento._selectorClientes = null; return;
  }
  const vacia = !String(consulta ?? '').trim();
  const lista = vacia && !mostrarVacio ? [] : buscarEnIndice(estado.indice, consulta);
  const aviso = texto => {
    const fila = document.createElement('div'); fila.className = 'ac-item'; fila.textContent = texto; elemento.append(fila);
  };
  if (vacia && !mostrarVacio) aviso('Escribí una letra, nombre, alias, teléfono o DNI.');
  else if (!lista.length) aviso('Sin resultados');
  for (const cliente of lista.slice(0, limite)) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'ac-item ac-opcion';
    item.textContent = `${cliente.nombre} · ${cliente.id}${cliente.telefono ? ' · ' + cliente.telefono : ''}${bloqueados && cliente.estado === 'Bloqueado' ? ' · Bloqueado' : ''}`;
    item.dataset.clienteId = cliente.id;
    item.onclick = () => {
      if (elemento._selectorClientes !== estado || !mismoContextoBuscadores(estado.contexto)) {
        elemento.replaceChildren(); elemento.classList.remove('on'); return;
      }
      seleccionar(cliente);
    };
    elemento.append(item);
  }
  if (lista.length > limite) aviso(`Mostrando ${limite} de ${lista.length}. Agregá más letras para precisar.`);
  elemento.classList.add('on');
}

export function prepararFiltroClientesSelect(select, clientes, consulta = '') {
  if (!select) return;
  let input = document.getElementById(select.id + '-busqueda');
  if (!input) {
    input = document.createElement('input'); input.id = select.id + '-busqueda'; input.className = 'inp'; input.type = 'search';
    input.placeholder = 'Nombre, alias, teléfono o DNI…'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Buscar cliente en el selector');
    input.style.marginBottom = '6px'; select.before(input);
  }
  let resumen = document.getElementById(select.id + '-resultados');
  if (!resumen) {
    resumen = document.createElement('p'); resumen.id = select.id + '-resultados'; resumen.className = 'busqueda-resumen';
    resumen.setAttribute('role', 'status'); resumen.setAttribute('aria-live', 'polite'); select.after(resumen);
  }
  input.setAttribute('aria-describedby', resumen.id);
  select._selectorClientes?.observador?.disconnect();
  const estado = { contexto: contextoBuscadores(), indice: crearIndiceClientes(clientes),
    opciones: [...select.options].map(o => o.cloneNode(true)) };
  select._selectorClientes = estado;
  input.value = consulta; input.disabled = select.disabled;
  estado.observador = new MutationObserver(() => { input.disabled = select.disabled; });
  estado.observador.observe(select, { attributes: true, attributeFilter: ['disabled'] });
  input.oninput = () => {
    if (!mismoContextoBuscadores(estado.contexto) || select._selectorClientes !== estado) {
      input.value = ''; input.disabled = true; select.replaceChildren(); resumen.textContent = 'La cuenta cambió. Volvé a abrir esta sección.'; return;
    }
    if (select.disabled) return;
    const seleccionado = select.value, matches = buscarEnIndice(estado.indice, input.value), ids = new Set(matches.map(c => String(c.id)));
    const porId = new Map(estado.opciones.map(o => [o.value, o]));
    const opciones = estado.opciones.filter(o => !o.value);
    for (const cliente of matches) if (porId.has(String(cliente.id))) opciones.push(porId.get(String(cliente.id)));
    // Filtrar nunca cambia una selección ni dispara el onchange financiero existente.
    if (seleccionado && !ids.has(seleccionado) && porId.has(seleccionado)) opciones.push(porId.get(seleccionado));
    select.replaceChildren(...opciones.map(o => o.cloneNode(true))); select.value = seleccionado;
    resumen.textContent = `Resultados encontrados: ${matches.length}${seleccionado && !ids.has(seleccionado) ? ' · Se conserva el cliente seleccionado.' : ''}`;
  };
  input.oninput();
}

export async function actualizarSelectoresClientesAbiertos() {
  const pre = document.querySelector('#sh-prestamo.on #pre-cliente-drop');
  const prenda = document.querySelector('#sh-prenda.on #pda-cliente');
  const voz = document.querySelector('#sh-busqueda-voz.on');
  if (!pre && !prenda && !voz) return;
  const contexto = contextoBuscadores(), clientes = await window.dbAll('clientes');
  if (!mismoContextoBuscadores(contexto)) return;
  if (pre && mismoContextoBuscadores(pre._selectorClientes?.contexto)) {
    window._acClientes = clientes.filter(c => !c._deleted && ['Activo', 'Bloqueado'].includes(c.estado));
    prepararSelectorClientes(pre, window._acClientes);
    const input = document.getElementById('pre-cliente-search'); input.disabled = !window._acClientes.length;
    if (document.activeElement === input || pre.classList.contains('on')) window.filtrarClientesAC(input.value);
  }
  if (prenda && mismoContextoBuscadores(prenda._selectorClientes?.contexto)) {
    const seleccionado = prenda.value, consulta = document.getElementById(prenda.id + '-busqueda')?.value || '';
    prenda.replaceChildren(new Option('Seleccionar cliente', ''), ...clientes.filter(c => !c._deleted).map(c => new Option(`${c.nombre} · ${c.id}`, c.id)));
    // Conservar una relación seleccionada aunque su registro deje de estar disponible.
    if (seleccionado && ![...prenda.options].some(o => o.value === seleccionado)) prenda.add(new Option('Cliente seleccionado no disponible', seleccionado));
    prenda.value = seleccionado; prepararFiltroClientesSelect(prenda, clientes, consulta);
  }
  if (voz) window.actualizarBusquedaVozAbierta?.(clientes, contexto);
}
