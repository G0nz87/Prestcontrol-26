import { crearIndiceClientes, crearIndicePrestamos, buscarEnIndice } from '../core/busqueda.js';

const elementos = tipo => ({
  pagina: document.getElementById('pg-' + tipo),
  input: document.getElementById(tipo === 'clientes' ? 'clientes-busqueda' : 'prestamos-busqueda'),
  lista: document.getElementById(tipo === 'clientes' ? 'cli-list' : 'prest-list'),
  resumen: document.getElementById(tipo + '-resultados')
});

export function contextoBuscadores() {
  return { uid: window._fbUser?.uid || null, local: window.obtenerDBLocalHistorica() };
}

export function mismoContextoBuscadores(contexto) {
  return Boolean(contexto?.uid && contexto?.local) && contexto.uid === window._fbUser?.uid && contexto.local === window.obtenerDBLocalHistorica();
}

export function capturarBusqueda(tipo, contexto) {
  const { pagina, input } = elementos(tipo);
  const anterior = pagina?._busqueda;
  if (!anterior || !mismoContextoBuscadores(anterior.contexto) || !mismoContextoBuscadores(contexto)) {
    return { consulta: '', filtro: 'activos', foco: false };
  }
  return { consulta: input?.value ?? anterior.consulta, filtro: anterior.filtro || 'activos',
    foco: document.activeElement === input, inicio: input?.selectionStart, fin: input?.selectionEnd };
}

export function prepararBuscador(tipo, contexto, registros, clientes, anterior) {
  const { pagina, input } = elementos(tipo);
  if (!mismoContextoBuscadores(contexto)) return;
  if (pagina._busqueda?.frame) window.cancelAnimationFrame(pagina._busqueda.frame);
  pagina._busqueda = { contexto, consulta: anterior.consulta, filtro: anterior.filtro,
    indice: tipo === 'clientes' ? crearIndiceClientes(registros) : crearIndicePrestamos(registros, clientes), frame: null };
  input.value = anterior.consulta;
  if (anterior.foco) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(anterior.inicio ?? input.value.length, anterior.fin ?? input.value.length);
  }
}

function estadoActual(tipo) {
  const e = elementos(tipo), estado = e.pagina?._busqueda;
  if (!estado || !mismoContextoBuscadores(estado.contexto)) {
    if (estado?.frame) window.cancelAnimationFrame(estado.frame);
    if (e.lista) e.lista.replaceChildren();
    if (e.resumen) e.resumen.textContent = 'La cuenta cambió. Volvé a abrir esta sección.';
    if (e.pagina) { e.pagina._busqueda = null; e.pagina._data = []; }
    if (e.input) e.input.value = '';
    return null;
  }
  return { ...e, estado };
}

function pintarResultados(tipo, resultados, estado, dibujar) {
  const { lista } = elementos(tipo);
  if (!lista) return;
  if (estado.frame) window.cancelAnimationFrame(estado.frame);
  lista.replaceChildren();
  estado.resultados = resultados;
  let cursor = 0;
  const agregar = () => {
    if (elementos(tipo).pagina?._busqueda !== estado || !mismoContextoBuscadores(estado.contexto)) return;
    // Los lotes permiten escribir otra consulta antes de pintar miles de fichas.
    const bloque = resultados.slice(cursor, cursor + 60);
    lista.insertAdjacentHTML('beforeend', bloque.map(dibujar).join(''));
    cursor += bloque.length;
    estado.frame = cursor < resultados.length ? window.requestAnimationFrame(agregar) : null;
  };
  if (resultados.length) agregar();
  else if (estado.consulta.trim()) lista.innerHTML = window.emptyHTML('🔍', tipo === 'clientes'
    ? 'No se encontraron clientes con esa búsqueda' : 'No se encontraron préstamos con esa búsqueda y filtro', '');
  else if (tipo === 'clientes') lista.innerHTML = window.emptyHTML('👤', 'Sin clientes', 'Tocá ＋ para agregar tu primer cliente.');
  else if (!estado.indice.length) lista.innerHTML = window.emptyHTML('📋', 'Sin préstamos', 'Tocá ＋ para crear el primer préstamo.');
  else if (estado.filtro === 'activos') lista.innerHTML = window.emptyHTML('🎉', 'Sin préstamos activos', 'Todos al día.');
  else lista.innerHTML = window.emptyHTML('🔍', 'Sin resultados', '');
}

export function aplicarBusquedaClientes(consulta) {
  const e = estadoActual('clientes');
  if (!e) return;
  e.estado.consulta = String(consulta ?? '');
  const resultados = buscarEnIndice(e.estado.indice, e.estado.consulta);
  e.resumen.textContent = 'Resultados encontrados: ' + resultados.length;
  pintarResultados('clientes', resultados, e.estado, window.cliItemHTML);
}

const alcances = {
  activos: 'Activos: incluye atrasados; excluye pagados, cancelados y ejecutados',
  todos: 'Todos: cartera completa', Activo: 'Al día', Atrasado: 'Atrasados',
  Pagado: 'Pagados: excluye renovados', Renovado: 'Renovados', Ejecutado: 'Ejecutados', Cancelado: 'Cancelados',
  Semanal: 'Semanales vigentes: excluye pagados, cancelados y ejecutados',
  Mensual: 'Mensuales vigentes: excluye pagados, cancelados y ejecutados'
};

export function aplicarBusquedaPrestamos(filtrada, filtro) {
  const e = estadoActual('prestamos');
  if (!e) return;
  e.estado.filtro = filtro;
  e.estado.consulta = e.input.value;
  const resultados = buscarEnIndice(e.estado.indice, e.estado.consulta, new Set(filtrada.map(p => p.id)));
  e.resumen.textContent = `Resultados encontrados: ${resultados.length} · Filtro: ${alcances[filtro] || filtro}`;
  pintarResultados('prestamos', resultados, e.estado, p => window.loanItemHTML(p, e.pagina._cuotas || [],
    e.pagina._prendas || [], e.pagina._renovacionCapitalElegibles?.has(p.id) === true));
}

export function buscarPrestamos() {
  const e = estadoActual('prestamos');
  if (e) window.filtrarPrestamos(e.estado.filtro || 'activos');
}
