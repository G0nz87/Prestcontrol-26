import { buscarClientesVoz } from '../core/busqueda-voz.js';
import { aliasRegistrados } from '../core/busqueda.js';
import { contextoBuscadores, mismoContextoBuscadores } from './buscadores.js';

let revisionVoz = 0;
let resultadoActual = null;
const identidad = cliente => JSON.stringify([cliente.id, cliente.nombre, ...aliasRegistrados(cliente)]);

export function cancelarBusquedaVoz() {
  revisionVoz++;
  window.detenerComandosVoz?.(false);
  ocultarResultadosVoz();
}

export function iniciarCicloVoz(contexto = contextoBuscadores()) {
  cancelarBusquedaVoz();
  return { revision: revisionVoz, contexto };
}

export function comandoVozVigente(ciclo) {
  return Boolean(ciclo && ciclo.revision === revisionVoz && mismoContextoBuscadores(ciclo.contexto));
}

function ocultarResultadosVoz() {
  resultadoActual = null;
  const sheet = document.getElementById('sh-busqueda-voz');
  if (sheet?.classList.contains('on')) window.closeSheet();
  sheet?.replaceChildren();
}

export async function coincidenciasClienteVoz(nombre, contexto = contextoBuscadores(), ciclo = null) {
  if (!mismoContextoBuscadores(contexto)) return [];
  ciclo = ciclo || iniciarCicloVoz(contexto);
  if (!comandoVozVigente(ciclo)) return [];
  const clientes = await window.dbAll('clientes');
  return comandoVozVigente(ciclo) ? buscarClientesVoz(clientes, nombre) : [];
}

function pintarCoincidenciasVoz(estado, aviso = '') {
  const sheet = document.getElementById('sh-busqueda-voz');
  if (!sheet || resultadoActual !== estado || !comandoVozVigente(estado.ciclo)) return;
  const resultados = buscarClientesVoz(estado.clientes, estado.consulta);
  const version = estado.version = (estado.version || 0) + 1;
  const lista = sheet.querySelector('[data-voz-resultados]'), resumen = sheet.querySelector('[data-voz-resumen]');
  lista.replaceChildren();
  resumen.textContent = aviso || (!resultados.length ? 'No se encontró ningún cliente. Corregí el nombre o probá un alias registrado.'
    : `Clientes encontrados: ${resultados.length}. Elegí el correcto.${resultados.some(r => r.aproximada) ? ' Las coincidencias aproximadas requieren tu selección.' : ''}`);
  for (const resultado of resultados.slice(0, 30)) {
    const boton = document.createElement('button'); boton.type = 'button'; boton.className = 'btn btn-ghost voz-cliente-opcion';
    boton.dataset.clienteId = resultado.cliente.id;
    const nombre = document.createElement('span'); nombre.textContent = `${resultado.cliente.nombre} · ${resultado.cliente.id}`;
    const tipo = document.createElement('span'); tipo.className = 'voz-cliente-tipo'; tipo.textContent = resultado.tipo;
    boton.append(nombre, tipo);
    boton.onclick = async () => {
      if (boton.disabled || resultadoActual !== estado || estado.version !== version || !sheet.classList.contains('on')) return;
      if (!comandoVozVigente(estado.ciclo)) { cancelarBusquedaVoz(); return; }
      boton.disabled = true;
      try {
        const clientes = await window.dbAll('clientes');
        if (resultadoActual !== estado || estado.version !== version || !comandoVozVigente(estado.ciclo) || !sheet.classList.contains('on')) return;
        const vigente = buscarClientesVoz(clientes, estado.consulta).find(r => r.cliente.id === resultado.cliente.id);
        if (!vigente || identidad(vigente.cliente) !== identidad(resultado.cliente)) {
          estado.clientes = clientes; pintarCoincidenciasVoz(estado, 'Los resultados cambiaron. Revisá y seleccioná nuevamente.'); return;
        }
        ocultarResultadosVoz();
        await window.openClienteDetail(vigente.cliente.id, { vigenteVoz: () => comandoVozVigente(estado.ciclo) });
      } catch (error) {
        if (resultadoActual === estado && comandoVozVigente(estado.ciclo)) resumen.textContent = 'No se pudo abrir el cliente. Volvé a intentarlo.';
      } finally {
        if (comandoVozVigente(estado.ciclo) && estado.version === version && boton.isConnected) boton.disabled = false;
      }
    };
    lista.append(boton);
  }
  if (resultados.length > 30) {
    const texto = document.createElement('p'); texto.textContent = 'Se muestran 30 opciones. Precisá el nombre para ver las restantes.'; lista.append(texto);
  }
  return resultados;
}

function mostrarResultadosVoz(estado) {
  if (!comandoVozVigente(estado.ciclo)) return [];
  let sheet = document.getElementById('sh-busqueda-voz');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'sh-busqueda-voz'; sheet.className = 'sheet form-sheet'; document.body.append(sheet); }
  sheet.innerHTML = '<div class="sheet-box"><div class="sheet-handle"></div><div class="sheet-hdr"><div class="sheet-title">Buscar cliente por voz</div><button type="button" class="icon-btn sheet-close" aria-label="Cerrar búsqueda">✕</button></div><div class="voz-busqueda-cuerpo"><p data-voz-transcripcion></p><label class="lbl" for="voz-cliente-consulta">Nombre o alias interpretado</label><input class="inp" type="search" id="voz-cliente-consulta" autocomplete="off" aria-describedby="voz-clientes-resumen"><p id="voz-clientes-resumen" class="busqueda-resumen" role="status" aria-live="polite" data-voz-resumen></p><div data-voz-resultados></div></div></div>';
  resultadoActual = estado;
  sheet.querySelector('.sheet-close').onclick = cancelarBusquedaVoz;
  sheet.querySelector('[data-voz-transcripcion]').textContent = 'Escuché: ' + estado.transcript;
  const input = sheet.querySelector('input'); input.value = estado.consulta;
  input.oninput = () => {
    if (resultadoActual !== estado) return;
    if (!comandoVozVigente(estado.ciclo)) { cancelarBusquedaVoz(); return; }
    estado.consulta = input.value; pintarCoincidenciasVoz(estado);
  };
  const resultados = pintarCoincidenciasVoz(estado);
  window.detenerComandosVoz?.(false);
  window.openSheet('sh-busqueda-voz');
  return resultados;
}

export function actualizarBusquedaVozAbierta(clientes, contexto) {
  if (!resultadoActual || !comandoVozVigente(resultadoActual.ciclo)
    || !mismoContextoBuscadores(contexto)) return;
  resultadoActual.clientes = clientes;
  pintarCoincidenciasVoz(resultadoActual);
}

export async function resolverBusquedaClienteVoz(nombre, { transcript = nombre, contexto = contextoBuscadores(), soloMostrar = false, ciclo = null } = {}) {
  if (!mismoContextoBuscadores(contexto)) return { accion: 'voz-descartada' };
  ciclo = ciclo || iniciarCicloVoz(contexto);
  if (!comandoVozVigente(ciclo)) return { accion: 'voz-descartada' };
  const clientes = await window.dbAll('clientes');
  if (!comandoVozVigente(ciclo)) return { accion: 'voz-descartada' };
  const coincidencias = buscarClientesVoz(clientes, nombre);
  if (!soloMostrar && coincidencias.length === 1 && coincidencias[0].prioridad <= 2) {
    ocultarResultadosVoz();
    window.detenerComandosVoz?.(false);
    window.toast('🎙️ Escuché: ' + transcript);
    await window.openClienteDetail(coincidencias[0].cliente.id, { vigenteVoz: () => comandoVozVigente(ciclo) });
    if (!comandoVozVigente(ciclo)) return { accion: 'voz-descartada' };
    return { accion: 'abrir-cliente', clienteId: coincidencias[0].cliente.id };
  }
  mostrarResultadosVoz({ clientes, consulta: nombre, transcript, contexto, ciclo });
  return { accion: !coincidencias.length ? 'cliente-no-encontrado' : coincidencias.length > 1 ? 'cliente-ambiguo' : 'cliente-seleccion-requerida',
    coincidencias: coincidencias.length };
}
