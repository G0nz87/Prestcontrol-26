import {
  leerCandidatosClientes, revisarCandidatosClientes, resumenCandidatosClientes,
  coincidenciasCliente, contarClientes
} from '../services/ImportacionClientesService.js';

let preview = null;
let ocupada = false;
const esc = valor => window.esc(String(valor ?? ''));
const mismoContexto = contexto => {
  if (!contexto || window._fbUser?.uid !== contexto.uid || window.obtenerDBLocalHistorica() !== contexto.local) {
    throw new Error('La cuenta o la base local cambió. Volvé a seleccionar el archivo.');
  }
};

export function contadorClientesHTML(clientes) {
  const c = contarClientes(clientes);
  return `<div class="clientes-contador" role="status" aria-live="polite">
    <span>Total de clientes registrados: <b>${c.total}</b></span>
    <span>Con teléfono: <b>${c.conTelefono}</b></span><span>Sin teléfono: <b>${c.sinTelefono}</b></span>
  </div><button class="btn btn-ghost" onclick="document.getElementById('imp-excel-file').click()">📥 Importar clientes desde Excel</button>`;
}

async function clientesParaRevision(contexto) {
  mismoContexto(contexto);
  // Lectura explícita del servidor: un error nunca equivale a una cuenta vacía.
  if (!navigator.onLine || !window._fbDb) throw new Error('Conectate a Internet y sincronizá antes de revisar o confirmar una importación.');
  const snap = await window._fbDb.collection('users').doc(contexto.uid).collection('clientes').get({ source: 'server' });
  mismoContexto(contexto);
  const remotos = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  const locales = await window.dbAllIncludeDeleted('clientes');
  mismoContexto(contexto);
  // Conservar ambas versiones para detectar procedencias e IDs aún no replicados.
  return [...locales, ...remotos];
}

export async function importarClientesExcel(input) {
  if (ocupada) { input.value = ''; return; }
  const file = input.files?.[0];
  if (!file) return;
  ocupada = true;
  const lock = window.iniciarOperacionProtegida('clientes:importar', [], '');
  try {
    if (!lock) return;
    if (await window.bloquearEscrituraPorRestorePending()) return;
    if (!window._fbUser?.uid || !window.obtenerDBLocalHistorica()) throw new Error('Ingresá a tu cuenta antes de importar.');
    if (!window.XLSX) throw new Error('SheetJS no está disponible. Conectate a Internet y volvé a abrir la aplicación.');
    if (!/\.xlsx?$/i.test(file.name)) throw new Error('Seleccioná un archivo .xlsx o .xls.');
    if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera el límite de 10 MB.');
    const contexto = { uid: window._fbUser.uid, local: window.obtenerDBLocalHistorica() };
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: true });
    const candidatos = await leerCandidatosClientes(wb, window.XLSX);
    const clientes = await clientesParaRevision(contexto);
    mismoContexto(contexto);
    preview = { contexto, candidatos: revisarCandidatosClientes(candidatos, clientes, window.normalizarTelefonoWA), resultados: [] };
    dibujarPreview();
    window.openSheet('sh-importar-clientes');
  } catch (error) {
    window.toast('⚠️ ' + error.message);
  } finally {
    input.value = '';
    ocupada = false;
    lock?.liberar();
    if (preview && document.getElementById('importar-clientes-resumen')) actualizarResumen();
  }
}

function asegurarSheet() {
  if (document.getElementById('sh-importar-clientes')) return;
  const sheet = document.createElement('div');
  sheet.id = 'sh-importar-clientes';
  sheet.className = 'sheet form-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Importar clientes desde Excel');
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-hdr">
    <div class="sheet-title">Importar clientes desde Excel</div>
    <button class="icon-btn" aria-label="Cerrar importación" onclick="closeSheet()">✕</button></div>
    <div class="sheet-body form-sheet-body" id="importar-clientes-body"></div>`;
  document.body.appendChild(sheet);
}

function dibujarPreview() {
  asegurarSheet();
  const r = resumenCandidatosClientes(preview.candidatos);
  document.getElementById('importar-clientes-body').innerHTML = `
    <p>Solo se lee «Para PrestControl». Se guardan nombre o alias, teléfono y Observaciones como notas.
    Los datos faltantes quedan vacíos. Cada familiar conserva su ficha independiente.</p>
    <p>Usá un solo dispositivo para cargar clientes durante la importación y esperá la sincronización antes de repetirla en otro equipo.</p>
    <div id="importar-clientes-resumen" role="status" aria-live="polite"></div>
    <p>Los posibles duplicados comienzan desmarcados. Podés seleccionarlos después de revisar las coincidencias.
    Una fila ya importada, incluso eliminada después, queda bloqueada.</p>
    <div class="importar-clientes-acciones"><button class="btn btn-ghost" onclick="seleccionarClientesExcel(true)">Seleccionar nuevos</button>
    <button class="btn btn-ghost" onclick="seleccionarClientesExcel(false)">Deseleccionar todos</button></div>
    <div id="importar-clientes-filas">${preview.candidatos.map((c, i) => {
      const bloqueado = Boolean(c.exacto || c.errores.length);
      const estado = c.exacto ? `YA IMPORTADO: ${c.exacto.id}${c.exacto.eliminado ? ' (eliminado; no se recreará)' : ''}`
        : c.errores.length ? 'ERROR' : c.posible ? 'POSIBLE DUPLICADO: revisar' : 'NUEVO';
      return `<article class="importar-cliente-fila"><label><input type="checkbox" data-candidato="${i}"
        ${c.seleccionado && !bloqueado ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}
        onchange="seleccionarClienteExcel(${i},this.checked)"> <b>Fila ${c.fila}: ${esc(c.nombre || '(sin nombre)')}</b></label>
        <div>${esc(c.telefono || 'Sin teléfono')} · ${esc(estado)}</div>
        ${c.coincidencias.map(m => `<div>Coincide con ${esc(m.id)} · ${esc(m.nombre)} (${esc(m.motivos.join(', '))})</div>`).join('')}
        ${c.dentroArchivo.length ? `<div>Revisar también filas del archivo: ${c.dentroArchivo.join(', ')}</div>` : ''}
        ${[...c.errores, ...c.advertencias].map(m => `<div>${esc(m)}</div>`).join('')}
        <details><summary>Datos de revisión y notas</summary>${Object.entries(c.revision).filter(([,v]) => v).map(([k,v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</details>
      </article>`;
    }).join('')}</div>
    <label><input id="importar-clientes-duplicados" type="checkbox"> Confirmo incorporar por separado los posibles duplicados seleccionados.</label>
    <button id="importar-clientes-confirmar" class="btn btn-gold btn-full" onclick="confirmarClientesExcel()" ${!r.seleccionados ? 'disabled' : ''}>Importar seleccionados</button>
    <div id="importar-clientes-resultados" role="status"></div>`;
  actualizarResumen();
  dibujarResultados();
}

function actualizarResumen() {
  const r = resumenCandidatosClientes(preview.candidatos);
  document.getElementById('importar-clientes-resumen').textContent =
    `Filas: ${r.total} · Seleccionadas / a incorporar: ${r.seleccionados} · Nuevos: ${r.nuevos} · Posiblemente existentes: ${r.posibles} · Advertencias: ${r.advertencias} · Errores: ${r.errores} · Ya importados: ${r.exactos} · Omitidos: ${r.omitidos}`;
  document.getElementById('importar-clientes-confirmar').disabled = ocupada || !r.seleccionados;
}

export function seleccionarClienteExcel(i, seleccionado) {
  if (ocupada || !preview) return;
  const c = preview.candidatos[i];
  if (!c || c.exacto || c.errores.length) return;
  c.seleccionado = seleccionado;
  document.getElementById('importar-clientes-duplicados').checked = false;
  actualizarResumen();
}

export function seleccionarClientesExcel(seleccionado) {
  if (ocupada || !preview) return;
  preview.candidatos.forEach((c, i) => {
    c.seleccionado = seleccionado && !c.exacto && !c.errores.length && !c.posible && c.autorizado;
    document.querySelector(`[data-candidato="${i}"]`).checked = c.seleccionado;
  });
  document.getElementById('importar-clientes-duplicados').checked = false;
  actualizarResumen();
}

function dibujarResultados() {
  const destino = document.getElementById('importar-clientes-resultados');
  if (!destino || !preview.resultados.length) return;
  destino.innerHTML = `<p>Resultados locales. La sincronización remota queda pendiente de confirmación en el indicador habitual de la aplicación.</p>`
    + preview.resultados.map(r => `<div>Fila ${r.fila}: ${esc(r.nombre)} · ${esc(r.estado)}${r.id ? ' · ' + esc(r.id) : ''}${r.error ? ' · ' + esc(r.error) : ''}</div>`).join('');
}

export async function confirmarClientesExcel() {
  if (ocupada || !preview) return;
  const lock = window.iniciarOperacionProtegida('clientes:importar', document.getElementById('importar-clientes-confirmar'), 'Importando...');
  if (!lock) return;
  ocupada = true;
  try {
    mismoContexto(preview.contexto);
    if (await window.bloquearEscrituraPorRestorePending()) return;
    const clientes = await clientesParaRevision(preview.contexto);
    const anteriores = preview.candidatos;
    const revisados = revisarCandidatosClientes(anteriores, clientes, window.normalizarTelefonoWA);
    // Una nueva coincidencia o una fila importada en otro dispositivo exige revisar otra vez.
    const cambio = revisados.some((c, i) => c.seleccionado &&
      (Boolean(c.exacto) !== Boolean(anteriores[i].exacto) ||
       JSON.stringify(c.coincidencias) !== JSON.stringify(anteriores[i].coincidencias)));
    preview.candidatos = revisados;
    if (cambio) {
      dibujarPreview();
      throw new Error('Los clientes cambiaron desde la vista previa. Revisá las coincidencias actualizadas y confirmá otra vez.');
    }
    const r = resumenCandidatosClientes(revisados);
    if (!r.seleccionados) return;
    const permiteDuplicados = document.getElementById('importar-clientes-duplicados').checked;
    if (r.duplicadosSeleccionados && !permiteDuplicados) throw new Error('Marcá la confirmación de posibles duplicados para continuar.');
    if (!window.confirm(`Se incorporarán ${r.seleccionados} clientes en la cuenta activa.\nPosibles duplicados seleccionados: ${r.duplicadosSeleccionados}.\nOmitidos: ${r.omitidos}.\nRevisá las advertencias: se conservarán los alias, familiares y datos incompletos seleccionados.\nLos clientes existentes se conservan. ¿Confirmás la importación?`)) return;
    for (const c of revisados.filter(c => c.seleccionado && !c.exacto && !c.errores.length)) {
      try {
        mismoContexto(preview.contexto);
        await window.clienteService.validarDatosCliente({ nombre: c.nombre, telefono: c.telefono });
        const resultado = await window.dbImportarClienteAtomic(c, preview.contexto, clientes, permiteDuplicados);
        clientes.push(resultado.cliente);
        c.seleccionado = false;
        c.exacto = { id: resultado.cliente.id, eliminado: Boolean(resultado.cliente._deleted) };
        preview.resultados.push({ fila: c.fila, nombre: c.nombre, id: resultado.cliente.id,
          estado: resultado.repetido ? 'Omitido: ya importado' : 'Incorporado localmente y en cola de sincronización' });
        // Las coincidencias entre filas del archivo ya fueron mostradas y
        // autorizadas. No volver a bloquear a la segunda persona por el alta
        // de la primera dentro de este mismo lote confirmado.
        if (permiteDuplicados) {
          for (const pendiente of revisados.filter(p => p.seleccionado && p.dentroArchivo.includes(c.fila))) {
            pendiente.coincidencias.push({ id: resultado.cliente.id, nombre: c.nombre, motivos: ['fila del archivo revisada: ' + c.fila] });
          }
        }
        if (!resultado.repetido && window._fbUser?.uid === preview.contexto.uid && window.obtenerDBLocalHistorica() === preview.contexto.local) {
          // Un fallo de bitácora no convierte un cliente confirmado en una alta fallida.
          try { await window.logBitacora('nuevo_cliente', 'Cliente incorporado desde Excel: ' + c.nombre, resultado.cliente.id); }
          catch (_) { preview.resultados.push({ fila: c.fila, nombre: c.nombre, estado: 'Alta conservada; no se pudo registrar la bitácora' }); }
        }
      } catch (error) {
        preview.resultados.push({ fila: c.fila, nombre: c.nombre, estado: 'No incorporado', error: error.message });
        // Detener el resto si la sesión cambió; ningún dato pasa a la cuenta nueva.
        if (window._fbUser?.uid !== preview.contexto.uid || window.obtenerDBLocalHistorica() !== preview.contexto.local) break;
      }
    }
    mismoContexto(preview.contexto);
    window.scheduleDriveSync();
    dibujarPreview();
    await window.renderPage('clientes');
  } catch (error) {
    window.toast('⚠️ ' + error.message);
  } finally {
    ocupada = false;
    lock.liberar();
    if (preview && document.getElementById('importar-clientes-resumen')) actualizarResumen();
  }
}

// Bridge para el punto inline de persistencia, sin introducir acceso financiero.
window.coincidenciasClienteExcel = coincidenciasCliente;
