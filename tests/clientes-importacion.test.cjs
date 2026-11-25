// Datos ficticios exclusivamente. No abre la aplicación ni su Firebase productivo.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const deps = createRequire(path.join(process.env.PRESTCONTROL_TEST_RUNTIME || path.join(os.tmpdir(), 'prestcontrol-caja-test-runtime'), 'package.json'));
const { indexedDB } = deps('fake-indexeddb'), { JSDOM } = deps('jsdom'), XLSX = deps('xlsx');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const BASE_CLIENTES = '936a06bd74b32100df1ecff5f3d3701364d8197b';
const extract = name => {
  const m = html.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n}'));
  assert(m, name); return m[0];
};
const compile = (name, scope) => new Function('scope', 'with(scope){return (' + extract(name) + ')}')(scope);
const model = new Function(read('services/ImportacionClientesService.js').replace(/^export /gm, '') +
  '\nreturn {COLUMNAS_CLIENTES,contarClientes,leerCandidatosClientes,coincidenciasCliente,revisarCandidatosClientes,resumenCandidatosClientes};')();
const validation = new Function(read('services/ClienteService.js').replace(/^export /gm, '') + '\nreturn ClienteService;')();
const normScope = {};
const normalizarTelefono = compile('normalizarTelefonoWA', normScope);
let seq = 0, env;
const openDbs = [], doms = [], results = [];
async function test(nombre, fn) { await fn(); results.push(nombre); console.log('OK ' + nombre); }
const row = (nombre, telefono = '', extra = {}) => model.COLUMNAS_CLIENTES.map(col => ({
  'Nº auxiliar': ++seq, 'Nombre o alias': nombre, 'Teléfono': telefono, '¿Autorizar importación?': 'Sí', ...extra
})[col] || '');
function workbook(rows, other = true) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([model.COLUMNAS_CLIENTES, ...rows]), 'Para PrestControl');
  if (other) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nombre o alias'], ['NO IMPORTAR ESTA MENCIÓN']]), 'Menciones elegidas');
  // Atravesar el serializador y lector reales, igual que un archivo elegido por el usuario.
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
}
async function candidates(rows) { return model.leerCandidatosClientes(workbook(rows), XLSX); }
function revise(c, clientes = []) { return model.revisarCandidatosClientes(c, clientes, normalizarTelefono); }
async function db() {
  const local = await new Promise((resolve, reject) => {
    const req = indexedDB.open('clientes-ficticios-' + (++seq), 1);
    req.onupgradeneeded = () => {
      for (const s of ['clientes', 'config', 'prestamos', 'cuotas', 'prendas', 'movimientos_caja', 'pagos_cuota', 'bitacora']) req.result.createObjectStore(s, { keyPath: s === 'config' ? 'key' : 'id' });
      req.result.createObjectStore('sync_queue', { keyPath: 'opId' });
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  openDbs.push(local); return local;
}
async function put(local, s, data) {
  return new Promise((resolve, reject) => {
    const tx = local.transaction(s, 'readwrite'); tx.objectStore(s).put(data);
    tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
async function harness() {
  const local = await db();
  const dom = new JSDOM('<body><div id="pg-clientes"></div><input id="imp-excel-file" type="file"></body>', { url: 'http://localhost/aislado', pretendToBeVisual: true });
  doms.push(dom);
  const window = dom.window, document = window.document;
  const mensajes = [], remote = [];
  let online = true, confirms = 0, confirmar = true, fallaServidor = false;
  Object.defineProperty(window.navigator, 'onLine', { get: () => online, configurable: true });
  new Function('window', read('core/helpers.js').replace(/^export /gm, ''))(window);
  const scope = { window, document, DB: local, appDesbloqueada: true, navigator: window.navigator,
    STAMPED_STORES: ['clientes','prestamos','cuotas','prendas','movimientos_caja','pagos_cuota'],
    hayRestauracionLocalPendiente: async () => false, updateSyncPendingBadge() {}, nextId: window.nextId,
    setTimeout, intentarAplicarActualizacionPwaPendiente() {},
    prestamosMap: () => new Map(), today: () => new Date(),
    situacionCrediticiaCliente: () => ({ prioridad: 0 }), riesgoClienteService: { calcular: () => ({}) },
    cliItemHTML: c => '<p>' + window.esc(c.nombre) + '</p>', emptyHTML: () => '<p>Sin clientes</p>' };
  Object.defineProperty(scope, '_fbUser', { get: () => window._fbUser });
  window._fbUser = { uid: 'USUARIO-FICTICIO' };
  window.clienteService = new validation({ getAll: async () => [] });
  window.obtenerDBLocalHistorica = () => scope.DB;
  window.normalizarTelefonoWA = normalizarTelefono;
  window._fbDb = { collection: () => ({ doc: () => ({ collection: () => ({ get: async opts => {
    assert.equal(opts.source, 'server');
    if (fallaServidor) throw Error('Falla de servidor sintética');
    return { docs: remote.map(c => ({ id: c.id, data: () => ({ ...c }) })) };
  } }) }) }) };
  for (const name of ['dbAll', 'dbAllIncludeDeleted', 'dbGet', 'dbPut', 'dbImportarClienteAtomic', 'iniciarOperacionProtegida', 'renderClientes']) {
    window[name] = scope[name] = compile(name, scope);
  }
  Object.assign(window, { XLSX, toast: m => mensajes.push(m), bloquearEscrituraPorRestorePending: async () => false,
    scheduleDriveSync() {}, logBitacora: async () => {}, renderPage: async () => window.renderClientes(), goPage: async () => window.renderClientes(),
    openSheet: id => document.getElementById(id).classList.add('on'), closeSheet() {},
    confirm: () => { confirms++; return confirmar; } });
  const src = read('ui/importacion-clientes.js').replace(/^import \{[^]*?\} from '[^']+';\r?\n/, '').replace(/^export /gm, '');
  const names = ['contadorClientesHTML','importarClientesExcel','seleccionarClienteExcel','seleccionarClientesExcel','confirmarClientesExcel'];
  const ui = new Function('window','document','navigator', ...Object.keys(model), src + '\nreturn {' + names.join(',') + ',getPreview:()=>preview};')
    (window, document, window.navigator, ...Object.values(model));
  Object.assign(window, ui);
  // El listado ahora utiliza los helpers de búsqueda; la importación permanece igual.
  const searchModel = new Function(read('core/busqueda.js').replace(/^export /gm, '') + '\nreturn {normalizarBusqueda,crearIndiceClientes,crearIndicePrestamos,buscarEnIndice};')();
  const searchSource = read('ui/buscadores.js');
  const searchNames = [...searchSource.matchAll(/export function (\w+)/g)].map(m=>m[1]);
  Object.assign(window, new Function('window','document',...Object.keys(searchModel), searchSource.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')+'\nreturn {'+searchNames.join(',')+'};')
    (window,document,...Object.values(searchModel)), {cliItemHTML:scope.cliItemHTML,emptyHTML:scope.emptyHTML});
  window.filterClientes = scope.filterClientes = compile('filterClientes',scope);
  async function select(rows) {
    const data = XLSX.write(workbook(rows), { type: 'buffer', bookType: 'xlsx' });
    const input = { files: [{ name: 'Contactos-FICTICIOS.xlsx', size: data.length, arrayBuffer: async () => data }], value: 'elegido' };
    await ui.importarClientesExcel(input); assert.equal(input.value, ''); return ui.getPreview();
  }
  return { window, document, scope, local, ui, select, mensajes, remote,
    all: s => window.dbAllIncludeDeleted(s), context: () => ({ uid: window._fbUser.uid, local }),
    online: value => { online = value; }, servidor: value => { fallaServidor = value; }, confirmar: value => { confirmar = value; }, confirms: () => confirms };
}

(async () => {
  await test('Contador cero, con/sin teléfono, tombstones y suma consistente', async () => {
    assert.deepEqual(model.contarClientes([]), { total:0, conTelefono:0, sinTelefono:0 });
    assert.deepEqual(model.contarClientes([{ telefono:'  ' },{ telefono:' +54 911 5555 0101 ' },{ _deleted:true, telefono:'123' }]), { total:2, conTelefono:1, sinTelefono:1 });
  });
  await test('Excel ficticio de 240 filas: hoja principal exclusiva y ninguna escritura al previsualizar', async () => {
    const h = await harness(); const p = await h.select(Array.from({ length:240 }, (_, i) => row('ContactoFicticio' + i)));
    assert.equal(p.candidatos.length, 240); assert.equal((await h.all('clientes')).length, 0); assert.equal((await h.all('sync_queue')).length, 0);
    assert.equal(h.document.querySelectorAll('[data-candidato]').length, 240);
    assert.equal(h.document.getElementById('importar-clientes-confirmar').disabled, false);
  });
  await test('Estructura inválida, encabezados repetidos, hoja de menciones sola y fórmulas se rechazan', async () => {
    const wb = workbook([row('Ejemplo')]); delete wb.Sheets['Para PrestControl'].B1;
    await assert.rejects(model.leerCandidatosClientes(wb, XLSX), /Columna/);
    const solo = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(solo, XLSX.utils.aoa_to_sheet([['Nombre']]), 'Menciones');
    await assert.rejects(model.leerCandidatosClientes(solo, XLSX), /Falta la hoja/);
    const formulas = workbook([row('Ejemplo')]); formulas.Sheets['Para PrestControl'].B2.f = '"Ejemplo"';
    assert.match((await model.leerCandidatosClientes(formulas, XLSX))[0].errores.join(), /fórmula/);
    const duplicado = workbook([]); duplicado.Sheets['Para PrestControl'].N1 = { t:'s',v:'Nombre o alias' }; duplicado.Sheets['Para PrestControl']['!ref'] = 'A1:N1';
    await assert.rejects(model.leerCandidatosClientes(duplicado, XLSX), /repetida/);
  });
  await test('Alias originales, familiares, dudas autorizadas y falta de teléfono son candidatos independientes', async () => {
    const c = revise(await candidates([row('ApodoFicticio'), row('Hermano de Persona Ficticia', '', { 'Duda':'Identidad por revisar', 'Persona familiar separada':'Sí' })]));
    assert.equal(c[0].nombre, 'ApodoFicticio'); assert.equal(c[1].nombre, 'Hermano de Persona Ficticia');
    assert(c.every(x => !x.errores.length && x.seleccionado)); assert(c[1].advertencias.some(a => a.includes('Duda')));
  });
  await test('Posibles duplicados por nombre, alias y teléfono; un apellido compartido no fusiona personas', async () => {
    const clientes = [{ id:'CL-001', nombre:'Persona Ejemplo', alias:'AliasFicticio', telefono:'+54 9 11 5555-0101' }];
    const c = revise(await candidates([row('Persona Ejemplo'), row('AliasFicticio'), row('Otro Nombre', '011 5555-0101'), row('Distinto Ejemplo')]), clientes);
    assert(c.slice(0,3).every(x => x.posible && !x.seleccionado)); assert(!c[3].posible); assert(c[3].seleccionado);
  });
  await test('Coincidencias dentro del archivo avisan sin fusionar; auxiliares diferentes conservan claves distintas', async () => {
    const c = revise(await candidates([row('Ejemplo Gemelo'), row('Ejemplo Gemelo')]));
    assert(c.every(x => x.posible && x.dentroArchivo.length === 1)); assert.notEqual(c[0].clave, c[1].clave);
  });
  await test('Filas sin nombre o teléfono inválido se bloquean; un No de autorización comienza desmarcado', async () => {
    const c = revise(await candidates([row('', '12345'), row('Prueba', 'NO-VALIDO'), row('PruebaNo', '', {'¿Autorizar importación?':'No'})]));
    assert(c[0].errores.length); assert(c[1].errores.length); assert(!c[2].seleccionado);
  });
  await test('Contador real del listado: alta manual, edición de teléfono y eliminación conservan el criterio', async () => {
    const h = await harness(); await h.window.renderClientes(); assert.match(h.document.body.textContent, /registrados: 0/);
    await put(h.local,'clientes',{id:'CL-001',nombre:'Persona Ficticia',telefono:''}); await h.window.renderClientes();
    assert.match(h.document.body.textContent,/registrados: 1/); assert.match(h.document.body.textContent,/Sin teléfono: 1/);
    await put(h.local,'clientes',{id:'CL-001',nombre:'Persona Ficticia',telefono:'123456'}); await h.window.renderClientes();
    assert.match(h.document.body.textContent,/Con teléfono: 1/);
    await put(h.local,'clientes',{id:'CL-001',nombre:'Persona Ficticia',telefono:'123456',_deleted:true}); await h.window.renderClientes();
    assert.match(h.document.body.textContent,/registrados: 0/); assert.equal(h.document.getElementById('pg-clientes')._data.length,0);
  });
  await test('Handlers reales de alta, edición y borrado actualizan el contador; protecciones de borrado se conservan', async () => {
    const h=await harness(), w=h.window, d=h.document;
    for(const id of ['cli-edit-id','cli-nombre','cli-dni','cli-tel','cli-dir','cli-notas','cli-estado','cli-riesgo','del-confirm-text','del-confirm-btn']) {
      const el=d.createElement('input'); el.id=id; d.body.appendChild(el);
    }
    d.getElementById('cli-estado').value='Activo'; d.getElementById('cli-nombre').value='ManualFicticio';
    w.addToSyncQueueOrThrow=h.scope.addToSyncQueue=h.scope.addToSyncQueueOrThrow=async(store,id,payload,operation)=>{
      const entry={opId:'manual-'+id,store,recordId:id,payload,operation,estado:'pending'};
      await put(h.local,'sync_queue',entry);return entry;
    };
    for(const name of ['dbSoftDelete','dbSoftDeleteAndQueue']) w[name]=h.scope[name]=compile(name,h.scope);
    const src=read('ui/clientes.js').replace(/^export /gm,'');
    const handlers=new Function('window','document',src+'\nreturn {saveCliente,borrarCliente,confirmarBorrarCliente};')(w,d);
    d.getElementById('del-confirm-btn').focus();
    await handlers.saveCliente(); assert.match(d.getElementById('pg-clientes').textContent,/registrados: 1/); assert.match(d.getElementById('pg-clientes').textContent,/Sin teléfono: 1/);
    d.getElementById('cli-edit-id').value='CL-001'; d.getElementById('cli-tel').value='5550100';
    await handlers.saveCliente(); assert.match(d.getElementById('pg-clientes').textContent,/Con teléfono: 1/);
    await put(h.local,'prestamos',{id:'PR-FICTICIO',clienteId:'CL-001',estado:'Activo'});
    await handlers.confirmarBorrarCliente('CL-001'); assert.match(h.mensajes.at(-1),/préstamo/); assert.equal((await h.all('clientes'))[0]._deleted,false);
    await put(h.local,'prestamos',{id:'PR-FICTICIO',clienteId:'CL-001',estado:'Pagado',cargaInicial:true});
    d.getElementById('del-confirm-text').value='ELIMINAR'; await handlers.borrarCliente('CL-001'); assert.match(h.mensajes.at(-1),/cartera histórica/);
    await put(h.local,'prestamos',{id:'PR-FICTICIO',clienteId:'SIN-RELACION',estado:'Pagado'});
    await handlers.borrarCliente('CL-001'); assert.match(d.getElementById('pg-clientes').textContent,/registrados: 0/); assert.equal((await h.all('clientes'))[0]._deleted,true);
  });
  await test('Importación múltiple, contador actualizado, ID superior a tombstones y reserva remota', async () => {
    const h = await harness(); await put(h.local,'clientes',{id:'CL-090',nombre:'Borrado Ficticio',_deleted:true});
    h.remote.push({id:'CL-100',nombre:'Remoto Ficticio',_deleted:true});
    await h.select([row('NuevoFicticioA','123456'),row('NuevoFicticioB')]); await h.ui.confirmarClientesExcel();
    assert.deepEqual((await h.all('clientes')).filter(c=>!c._deleted).map(c=>c.id),['CL-101','CL-102']);
    assert.equal((await h.all('sync_queue')).length,2); assert.match(h.document.body.textContent,/registrados: 2/);
    assert.match(h.document.getElementById('importar-clientes-resultados').textContent,/pendiente de confirmación/);
  });
  await test('Confirmación cancelada o posible duplicado sin aceptación explícita no escriben', async () => {
    const h = await harness(); await put(h.local,'clientes',{id:'CL-001',nombre:'Coincidente Ficticio'});
    await h.select([row('Coincidente Ficticio')]); h.ui.seleccionarClienteExcel(0,true);
    await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,1); assert.equal(h.confirms(),0);
    h.document.getElementById('importar-clientes-duplicados').checked = true; h.confirmar(false);
    await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,1); assert.equal(h.confirms(),1);
    h.confirmar(true); await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,2);
  });
  await test('Clientes existentes intactos, datos auxiliares no se guardan como campos ni IDs', async () => {
    const h = await harness(), original = {id:'CL-007',nombre:'Existente Ficticio',telefono:'5550100',dni:'11111111',notas:'Conservar'};
    await put(h.local,'clientes',original); await h.select([row('Nuevo Independiente','',{'Nº auxiliar':999,'Identidad':'No es un DNI','Observaciones':'Nota ficticia'})]);
    await h.ui.confirmarClientesExcel(); const rows = await h.all('clientes'); assert.deepEqual(rows[0],original);
    assert.equal(rows[1].id,'CL-008'); assert.equal(rows[1].dni,''); assert.equal(rows[1].notas,'Nota ficticia'); assert.equal(rows[1].Identidad,undefined);
  });
  await test('Dos personas similares y familiares del mismo Excel se incorporan por separado tras confirmación', async () => {
    const h=await harness(); await h.select([row('Persona Ficticia'),row('Hermano de Persona Ficticia')]);
    assert(h.ui.getPreview().candidatos.every(c=>c.posible));
    h.ui.seleccionarClienteExcel(0,true); h.ui.seleccionarClienteExcel(1,true);
    h.document.getElementById('importar-clientes-duplicados').checked=true;
    await h.ui.confirmarClientesExcel();
    assert.deepEqual((await h.all('clientes')).map(c=>c.nombre),['Persona Ficticia','Hermano de Persona Ficticia']);
    assert.equal((await h.all('sync_queue')).length,2);
  });
  await test('Doble clic, concurrencia local y reimportación de archivo no crean altas repetidas', async () => {
    const h = await harness(), rows = [row('IdempotenteFicticio')];
    await h.select(rows); await Promise.all([h.ui.confirmarClientesExcel(),h.ui.confirmarClientesExcel()]);
    assert.equal((await h.all('clientes')).length,1); await h.select(rows);
    assert(h.ui.getPreview().candidatos[0].exacto); assert.equal(h.ui.getPreview().candidatos[0].seleccionado,false);
    const h2 = await harness(), c = revise(await candidates([row('Atómico Ficticio')]))[0];
    const out = await Promise.all([h2.window.dbImportarClienteAtomic(c,h2.context()),h2.window.dbImportarClienteAtomic(c,h2.context())]);
    assert.equal(out.filter(r=>r.repetido).length,1); assert.equal((await h2.all('clientes')).length,1); assert.equal((await h2.all('sync_queue')).length,1);
  });
  await test('Tombstone de un importado también impide recrearlo al repetir el mismo Excel', async () => {
    const h = await harness(), rows = [row('EliminadoFicticio')]; await h.select(rows); await h.ui.confirmarClientesExcel();
    const [c] = await h.all('clientes');
    h.scope.addToSyncQueue=async(store,id,payload,operation)=>{
      const entry={opId:'delete-'+id,store,recordId:id,payload,operation,estado:'pending'};
      await put(h.local,'sync_queue',entry);return entry;
    };
    h.scope.dbSoftDelete=compile('dbSoftDelete',h.scope);
    await compile('dbSoftDeleteAndQueue',h.scope)('clientes',c.id);
    assert.equal((await h.all('sync_queue')).find(q=>q.operation==='delete').payload.importacionExcel.clave,c.importacionExcel.clave);
    await h.select(rows);
    assert(h.ui.getPreview().candidatos[0].exacto.eliminado); await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,1);
  });
  await test('Fallo individual conserva las altas confirmadas y permite reintentar solo las fallidas', async () => {
    const h = await harness(); await h.select([row('CorrectoFicticioA'),row('FallidoFicticio'),row('CorrectoFicticioB')]);
    const original = h.window.dbImportarClienteAtomic;
    h.window.dbImportarClienteAtomic = async (...args) => { if(args[0].nombre==='FallidoFicticio') throw Error('Fallo sintético'); return original(...args); };
    await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,2); assert.match(h.document.body.textContent,/Fallo sintético/);
    h.window.dbImportarClienteAtomic = original; await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,3);
  });
  await test('Fallo al encolar aborta también el cliente; ningún alta parcial ni número reutilizado', async () => {
    const h = await harness(), c = revise(await candidates([row('AbortadoFicticio')]))[0];
    await put(h.local,'sync_queue',{opId:'sq_import_CL-001_'+c.clave,estado:'pending'});
    await assert.rejects(h.window.dbImportarClienteAtomic(c,h.context())); assert.equal((await h.all('clientes')).length,0);
    assert.equal((await h.all('sync_queue')).length,1);
  });
  await test('Sin conexión al revisar o confirmar: no se interpreta como cuenta vacía ni se escribe', async () => {
    const h = await harness(); h.online(false); await h.select([row('OfflineFicticio')]); assert.equal(h.ui.getPreview(),null);
    h.online(true); await h.select([row('OfflineFicticio')]); h.online(false); await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,0);
    h.online(true); h.servidor(true); await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,0);
  });
  await test('Corte de conexión después de confirmar: altas locales y colas conservadas para reintento', async () => {
    const h = await harness(); await h.select([row('CorteFicticioA'),row('CorteFicticioB')]);
    const original = h.window.dbImportarClienteAtomic; h.window.dbImportarClienteAtomic = (...args) => {h.online(false);return original(...args);};
    await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,2); assert.equal((await h.all('sync_queue')).length,2);
  });
  await test('Cambios recibidos antes de confirmar fuerzan revisar las nuevas coincidencias', async () => {
    const h = await harness(); await h.select([row('Llegó Remoto')]); h.remote.push({id:'CL-040',nombre:'Llegó Remoto'});
    await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,0); assert.match(h.mensajes.at(-1),/cambiaron/);
  });
  await test('Cambio de usuario o de base y restauración pendiente bloquean nuevas escrituras', async () => {
    const h = await harness(); await h.select([row('CuentaFicticia')]); h.window._fbUser={uid:'OTRA-CUENTA-FICTICIA'};
    await h.ui.confirmarClientesExcel(); assert.equal((await h.all('clientes')).length,0);
    h.window._fbUser={uid:'USUARIO-FICTICIO'}; const c=revise(await candidates([row('RestoreFicticio')]))[0];
    await put(h.local,'config',{key:'restorePending',value:{active:true}});
    await assert.rejects(h.window.dbImportarClienteAtomic(c,h.context()),/restauración/); assert.equal((await h.all('clientes')).length,0);
    await put(h.local,'config',{key:'restorePending',value:{active:false}});
    const context=h.context(); h.scope.DB=await db(); await assert.rejects(h.window.dbImportarClienteAtomic(c,context),/sesión/);
  });
  await test('Excel con HTML se muestra escapado y las selecciones actualizan el total a incorporar', async () => {
    const h=await harness(); await h.select([row('<img src=x onerror=alert(1)>'),row('SegundoFicticio')]);
    assert.equal(h.document.querySelector('#importar-clientes-filas img'),null);
    h.ui.seleccionarClientesExcel(false); assert.match(h.document.getElementById('importar-clientes-resumen').textContent,/incorporar: 0/);
    h.ui.seleccionarClientesExcel(true); assert.match(h.document.getElementById('importar-clientes-resumen').textContent,/incorporar: 2/);
  });
  await test('Finanzas y borrado intactos; sync conserva protección Excel y solo añade aviso visual de búsqueda', async () => {
    const {execFileSync}=require('node:child_process');
    const original=execFileSync('git',['show',BASE_CLIENTES+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:5e6});
    const {funcionesBusqueda,sinGanchoVisual,assertModuloProtegido}=require('./busqueda-alcance.cjs');
    const funcs=s=>[...s.matchAll(/^(?:async )?function (\w+)\(/gm)].map(m=>m[1]);
    for(const name of funcs(original).filter(n=>![...funcionesBusqueda,'importarExcel'].includes(n))) {
      const re=new RegExp('(?:async )?function '+name+'\\([^]*?\\n}');
      const normalizar=s=>s?.replace(/\r\n/g,'\n').replace('📥 Importar clientes desde Excel','📥 Importar Excel')
        .replace(/^ *\/\/ IMPORTACION_CLIENTES_(?:GUARD|SESION|ERROR_SESION|TOMBSTONE)_INICIO\n[^]*?^ *\/\/ IMPORTACION_CLIENTES_(?:GUARD|SESION|ERROR_SESION|TOMBSTONE)_FIN\n\n?/gm,'');
      assert.equal(sinGanchoVisual(normalizar(html.match(re)?.[0])),sinGanchoVisual(normalizar(original.match(re)?.[0])),name);
    }
    for(const p of ['ui/clientes.js','ui/prestamos.js','ui/caja.js','ui/prendas.js','services/PrestamoService.js','services/MetricasFinancierasService.js','services/CargaHistoricaService.js','firestore.rules']) {
      assertModuloProtegido(p,read(p),execFileSync('git',['show',BASE_CLIENTES+':'+p],{cwd:root,encoding:'utf8'}));
    }
  });
  if (process.argv.includes('--emulator')) {
    await test('Firestore Emulator: cola real, permisos por UID, pérdida de red y réplica en otro dispositivo', async () => {
      const {initializeTestEnvironment,assertFails}=deps('@firebase/rules-unit-testing');
      const firebase=deps('firebase/compat/app'); deps('firebase/compat/firestore'); firebase.firestore.setLogLevel('silent');
      env=await initializeTestEnvironment({projectId:'demo-prestcontrol-apertura',firestore:{host:'127.0.0.1',port:8089,rules:read('firestore.rules')}});
      const uid='CLIENTES-SINTETICOS-'+Date.now(), remote=env.authenticatedContext(uid).firestore(), user=remote.collection('users').doc(uid);
      const h=await harness(); h.window._fbUser={uid};
      const rows=[row('RemotoSinteticoA','5550123'),row('RemotoSinteticoB')], c=revise(await candidates(rows));
      for(const candidate of c) await h.window.dbImportarClienteAtomic(candidate,h.context());
      const queue=await h.all('sync_queue'); let offline=false;
      const pushScope={_fbUser:{uid},_fbDb:remote,DB:h.local,currentUser:'FICTICIO',drivePendingSync:true,
        aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,
        getSyncQueuePending:async()=>queue.filter(q=>['pending','error'].includes(q.estado)),
        consolidateSyncOperations:q=>q.map(op=>({op,opIds:[op.opId]})),dbGet:h.window.dbGet,
        _userDoc:(s,id)=> {if(offline)throw Error('Corte de red sintético');return user.collection(s).doc(id);},
        isDeleteSyncOperation:()=>false,normalizarRegistroActivoParaSync:(s,d)=>d,normalizarUpdatedAtRemoto:compile('normalizarUpdatedAtRemoto',{}),
        debePrevalecerRestauracionRemota:()=>false,debeConservarRestauracionLocal:()=>false,esRegresionEstadoMonotonico:()=>false,
        syncOperationTime:()=>0,markSyncOpDone:async id=>{queue.find(q=>q.opId===id).estado='done';},
        markSyncOpError:async(id,e)=>{queue.find(q=>q.opId===id).estado='error';},syncDebugLog:()=>{},firebaseErrorMessage:e=>e.message,
        driveSetStatus:()=>{},setGlobalConfig:async()=>{},detectarEstadosHibridos:async()=>{},firebase};
      const push=compile('_pushToFirebaseSinLock',pushScope);
      offline=true; await push(); assert(queue.every(q=>q.estado!=='done')); assert.equal((await user.collection('clientes').get()).size,0);
      offline=false; assert.equal(await push(),true); assert(queue.every(q=>q.estado==='done')); assert.equal((await user.collection('clientes').get()).size,2);
      // Una respuesta perdida puede reintentar un alta ya confirmada. Si después
      // alguien editó la ficha remota, no sobrescribir esa edición al reintentar.
      const primerCliente=user.collection('clientes').doc('CL-001');
      await primerCliente.update({nombre:'EditadoRemotamenteFicticio',updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      queue[0].estado='pending'; assert.equal(await push(),false); assert.equal(queue[0].estado,'error');
      assert.equal((await primerCliente.get()).data().nombre,'EditadoRemotamenteFicticio');
      const otro=await harness();
      // Usar el listener de producción real para aplicar un snapshot al IndexedDB aislado.
      let callback, changed;
      const rt={_fbUser:{uid},_fbDb:{collection:()=>({doc:()=>({collection:col=>({onSnapshot:(opts,cb)=>{if(col==='clientes')callback=cb;return ()=>{};}})})})},
        _realtimeUnsub:[],_stoChangedStores:new Set(),appDesbloqueada:true,curPage:'clientes',PAGE_DEPS:{clientes:['clientes']},
        setTimeout:fn=>{changed=fn;return 1;},clearTimeout:()=>{},getPendingSyncGroups:async()=>[],pendingSyncGroupMap:()=>new Map(),getPendingSyncGroup:()=>null,shouldSkipRemoteForPending:async()=>false,
        normalizarUpdatedAtRemoto:d=>d,dbGet:otro.window.dbGet,dbPut:otro.window.dbPut,debeAplicarRemoto:()=>true,
        autoUpdateEstados:async()=>{},updateBadges:async()=>{},renderPage:async()=>otro.window.renderClientes(),detectarEstadosHibridos:async()=>{},driveSetStatus:()=>{}};
      compile('iniciarSyncRealtime',rt)();
      async function replicate() {
        const snap=await user.collection('clientes').get({source:'server'});
        await callback({metadata:{fromCache:false},docChanges:()=>snap.docs.map(doc=>({type:'modified',doc}))}); await changed();
      }
      await replicate(); assert.match(otro.document.body.textContent,/registrados: 2/); assert.match(otro.document.body.textContent,/Con teléfono: 1/);
      const imported=(await user.collection('clientes').get()).docs[0]; await imported.ref.update({telefono:'',_deleted:true});
      await replicate(); assert.match(otro.document.body.textContent,/registrados: 1/);
      const again=revise(await candidates(rows),await otro.all('clientes')); assert(again.every(c=>c.exacto));
      const otherAccount=env.authenticatedContext(uid+'-OTRO').firestore();
      await assertFails(otherAccount.collection('users').doc(uid).collection('clientes').get());
      // Si un segundo dispositivo ocupa un CL reservado localmente, la cola
      // conserva el pendiente y nunca sustituye al cliente remoto existente.
      const colision=await harness(); colision.window._fbUser={uid};
      await put(colision.local,'clientes',{id:'CL-002',nombre:'TombstoneFicticio',_deleted:true});
      const [nuevo]=revise(await candidates([row('ColisionFicticia')]));
      await colision.window.dbImportarClienteAtomic(nuevo,colision.context());
      const reservado=user.collection('clientes').doc('CL-003');
      await reservado.set({id:'CL-003',nombre:'Existente protegido',telefono:'5550199'});
      queue.splice(0,queue.length,...await colision.all('sync_queue'));
      pushScope.DB=colision.local; pushScope.dbGet=colision.window.dbGet;
      assert.equal(await push(),false); assert.equal(queue[0].estado,'error');
      assert.equal((await reservado.get()).data().nombre,'Existente protegido');
      assert.equal((await colision.all('clientes')).find(c=>c.id==='CL-003').nombre,'ColisionFicticia');
      for(const s of ['prestamos','cuotas','prendas','movimientos_caja','pagos_cuota']) assert.equal((await user.collection(s).get()).size,0,s);
    });
  }
  console.log(JSON.stringify({passed:results.length,scope:'Excel sintético + JSDOM + fake-indexeddb'+(env?' + Firestore Emulator demo':''),results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{openDbs.forEach(d=>d.close());doms.forEach(d=>d.window.close());if(env)await env.cleanup();});
