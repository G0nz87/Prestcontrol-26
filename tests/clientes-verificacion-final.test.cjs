// Verificación acotada: sin SDK Firebase, red, datos reales ni cálculos financieros.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), sw = read('sw.js');
const BASE_CLIENTES = '936a06bd74b32100df1ecff5f3d3701364d8197b';
const original = p => execFileSync('git', ['show', BASE_CLIENTES + ':' + p], { cwd: root, encoding: 'utf8', maxBuffer: 5e6 }).replace(/\r\n/g, '\n');
const oldHtml = original('index.html');
const extract = (source, name) => {
  const found = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n}'));
  assert(found, name); return found[0];
};
const compile = (source, name, scope) => new Function('scope', 'with(scope){return (' + extract(source, name) + ')}')(scope);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('OK ' + name); }

async function pushScenario(source, mode) {
  const records = [
    { store:'clientes', data:{id:'CL-NORMAL',nombre:'Cliente ficticio'} },
    { store:'prestamos', data:{id:'PR-FICTICIO',estado:'Activo',monto:100} },
    { store:'cuotas', data:{id:'CU-FICTICIA',estado:'Pendiente',monto:10} },
    { store:'movimientos_caja', data:{id:'MC-FICTICIO',tipo:'DESEMBOLSO_PRESTAMO',direccion:'egreso',monto:100} }
  ];
  if (mode) records.splice(2, 0, {store:'clientes',data:{id:'CL-IMPORTADO',nombre:'Importado ficticio',estado:'Activo',_deleted:false,
    updatedAt:'2026-01-01T00:00:00Z',importacionExcel:{version:1,clave:'f'.repeat(64),uid:'UID-FICTICIO'}}});
  const local = new Map(records.map(r => [r.store + '/' + r.data.id, r.data]));
  const remote = new Map();
  if (mode === 'conflicto') remote.set('clientes/CL-IMPORTADO', {id:'CL-IMPORTADO',nombre:'Existente protegido',updatedAt:'2020-01-01T00:00:00Z'});
  const queue = records.map((r, i) => ({opId:r.data.importacionExcel ? 'sq_import_ficticio' : 'op-' + i,
    store:r.store,recordId:r.data.id,payload:r.data,operation:'upsert',estado:'pending'}));
  const done = [], errors = [];
  let transactions = 0;
  const apply = writes => writes.forEach(([ref, data]) => remote.set(ref.key, {...remote.get(ref.key),...data}));
  const ref = (s, id) => ({ key:s + '/' + id, get:async() => ({exists:remote.has(s + '/' + id),id,data:() => remote.get(s + '/' + id)}) });
  const db = {
    batch() { const writes = []; return {set:(r,d) => writes.push([r,d]),commit:async() => apply(writes)}; },
    async runTransaction(fn) { transactions++; const writes = []; await fn({get:r=>r.get(),set:(r,d)=>writes.push([r,d])}); apply(writes); }
  };
  const scope = {_fbUser:{uid:'UID-FICTICIO'},_fbDb:db,DB:{},currentUser:'FICTICIO',drivePendingSync:true,
    aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,
    getSyncQueuePending:async()=>queue.filter(q=>q.estado!=='done'),
    consolidateSyncOperations:q=>q.map(op=>({op,opIds:[op.opId]})),dbGet:async(s,id)=>local.get(s+'/'+id),_userDoc:ref,
    normalizarUpdatedAtRemoto:d=>d,debePrevalecerRestauracionRemota:()=>false,debeConservarRestauracionLocal:()=>false,
    esRegresionEstadoMonotonico:()=>false,isDeleteSyncOperation:()=>false,syncOperationTime:()=>0,
    normalizarRegistroActivoParaSync:(s,d)=>d,
    markSyncOpDone:async id=>{done.push(id);queue.find(q=>q.opId===id).estado='done';},
    markSyncOpError:async(id,error)=>{errors.push(error);queue.find(q=>q.opId===id).estado='error';},
    syncDebugLog:()=>{},firebaseErrorMessage:e=>e.message,driveSetStatus:()=>{},setGlobalConfig:async()=>{},detectarEstadosHibridos:async()=>{},
    firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'FECHA-SINTETICA'}}}};
  const success = await compile(source, '_pushToFirebaseSinLock', scope)();
  return {success,remote,queue,done,errors,transactions};
}

function workerHarness(source, failInstall = false) {
  const base = 'https://prestcontrol.example/';
  const oldName = 'prestcontrol-shell-v71-clientes-v1', foreignName = 'otra-app';
  const storage = new Map([[oldName,new Map([[base+'index.html','HTML-ANTERIOR']])],[foreignName,new Map()]]);
  const events = {}, messages = [];
  let skipped = 0, claimed = 0, offline = false;
  const key = r => typeof r === 'string' ? new URL(r, base).href : r.url;
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map());
      const entries = storage.get(name);
      return {
        async addAll(requests) {if(failInstall) throw Error('Fallo sintético de descarga'); requests.forEach(r=>entries.set(key(r),'NUEVO:'+key(r)));},
        async add(r) {entries.set(key(r),'SDK');},async put(r,value) {entries.set(key(r),value);}
      };
    },
    keys:async()=>[...storage.keys()],delete:async name=>storage.delete(name),
    async match(r) {for(const cache of storage.values()) if(cache.has(key(r))) return cache.get(key(r));}
  };
  const self = {location:{origin:new URL(base).origin},addEventListener:(name,fn)=>{events[name]=fn;},skipWaiting:()=>{skipped++;},
    clients:{claim:async()=>{claimed++;},matchAll:async()=>[{postMessage:m=>messages.push(m)}]}};
  class Request {constructor(url,options={}){this.url=new URL(url,base).href;Object.assign(this,options);}}
  vm.runInNewContext(source,{self,caches,Request,URL,fetch:async()=>{if(offline)throw Error('Offline sintético');return {ok:true,clone:()=>({})};}});
  const name = vm.runInNewContext(source+'\nCACHE_NAME',{self:{addEventListener(){} }});
  const assets = vm.runInNewContext(source+'\nAPP_SHELL',{self:{addEventListener(){} }});
  async function dispatch(name, more={}) {let pending;events[name]({...more,waitUntil:p=>{pending=p;}});await pending;}
  async function fetchOffline(asset) {offline=true;let response;events.fetch({request:{url:new URL(asset,base).href,method:'GET',mode:'same-origin'},respondWith:p=>{response=p;}});return response;}
  return {storage,name,assets,oldName,foreignName,messages,dispatch,fetchOffline,get skipped(){return skipped;},get claimed(){return claimed;}};
}

(async()=>{
  await test('Exportaciones Excel/PDF, comprobantes, respaldos y restauraciones conservan exactamente su código',async()=>{
    const names=['exportarExcel','exportarGoogleSheets','_exportarXLSX','exportarPDF','imprimirComprobante','imprimirComprobantePrestamo','imprimirComprobanteAbono',
      'exportarBackup','importarBackup','validarBackupCompletoPreview','restaurarBackupCompletoPreview','aplicarRestauracionBackupCompleto',
      'construirPlanSubidaRestauracionFirebase','publicarRestauracionFirebaseDesdePlan','verificarPublicacionRestauracionFirebase'];
    for(const name of names) assert.equal(extract(html,name),extract(oldHtml,name),name);
    for(const handler of ['exportarExcel()','exportarPDF()','exportarBackup()','importarBackup(this)','restaurarBackupCompletoPreview(this)']) assert(html.includes(handler),handler);
  });
  await test('Retiro limitado al importador Excel genérico; el nuevo flujo escribe solo Clientes y su cola',async()=>{
    const old=extract(oldHtml,'importarExcel');
    for(const store of ['clientes','prestamos','cuotas']) assert(old.includes("dbPut('"+store+"'"));
    assert(extract(html,'importarExcel').includes('window.importarClientesExcel(input)'));
    const atomic=extract(html,'dbImportarClienteAtomic');
    assert(atomic.includes("transaction(['clientes', 'sync_queue', 'config'], 'readwrite')"));
    assert(atomic.includes("objectStore('clientes').add(cliente)"));
    const ui=read('ui/importacion-clientes.js');
    assert(!/prestamoService|cajaService|movimientos_caja|dbPut\(/.test(ui));
    assert(read('services/ImportacionClientesService.js').includes("const hoja = 'Para PrestControl'"));
  });
  await test('Sincronización general idéntica salvo los bloques exclusivos de Clientes Excel',async()=>{
    const quitar=s=>s.replace(/^ *\/\/ IMPORTACION_CLIENTES_(?:GUARD|SESION|ERROR_SESION)_INICIO\n[^]*?^ *\/\/ IMPORTACION_CLIENTES_(?:GUARD|SESION|ERROR_SESION)_FIN\n\n?/gm,'');
    assert.equal(quitar(extract(html,'_pushToFirebaseSinLock')),extract(oldHtml,'_pushToFirebaseSinLock'));
    for(const name of ['_pushCompletoAFirebase','iniciarSyncRealtime','consolidateSyncOperations']) assert.equal(extract(html,name),extract(oldHtml,name),name);
  });
  await test('Cola normal: préstamo, cuota, Caja y cliente mantienen el resultado anterior sin transacciones Excel',async()=>{
    const antes=await pushScenario(oldHtml),despues=await pushScenario(html);
    assert(antes.success && despues.success);assert.deepEqual(despues.remote,antes.remote);assert.deepEqual(despues.done,antes.done);
    assert.equal(despues.transactions,0);assert.equal(despues.errors.length,0);
  });
  await test('Cola mixta: un importado correcto se confirma; una colisión no impide enviar los demás registros',async()=>{
    const ok=await pushScenario(html,'nuevo');assert(ok.success);assert.equal(ok.transactions,1);assert(ok.queue.every(q=>q.estado==='done'));
    assert.equal(new Set(ok.done).size,ok.done.length);
    const bad=await pushScenario(html,'conflicto');assert.equal(bad.success,false);assert.match(bad.errors[0],/Colisión de ID/);
    assert.equal(bad.remote.get('clientes/CL-IMPORTADO').nombre,'Existente protegido');
    assert(bad.queue.filter(q=>q.store!=='clientes'||q.recordId==='CL-NORMAL').every(q=>q.estado==='done'));
    for(const key of ['prestamos/PR-FICTICIO','cuotas/CU-FICTICIA','movimientos_caja/MC-FICTICIO']) assert.deepEqual(bad.remote.get(key),ok.remote.get(key),key);
  });
  await test('Shell nuevo: caché versionada, dependencias completas, activación y disponibilidad offline',async()=>{
    const w=workerHarness(sw);assert.equal(w.name,'prestcontrol-shell-v71-buscadores-v1');assert.notEqual(w.name,w.oldName);
    assert.notEqual(sw,original('sw.js'));
    for(const asset of w.assets) assert(fs.existsSync(path.join(root,asset)),asset);
    for(const asset of ['./ui/importacion-clientes.js','./services/ImportacionClientesService.js','./ui/buscadores.js','./core/busqueda.js']) assert(w.assets.includes(asset));
    await w.dispatch('install');assert(w.storage.has(w.oldName));assert.equal(w.skipped,1);
    await w.dispatch('activate');assert(!w.storage.has(w.oldName));assert(w.storage.has(w.foreignName));assert.equal(w.claimed,1);
    assert.equal(w.messages[0].type,'PRESTCONTROL_SHELL_READY');assert.equal(w.messages[0].cacheName,w.name);
    for(const asset of ['./index.html','./ui/importacion-clientes.js','./services/ImportacionClientesService.js','./ui/buscadores.js','./core/busqueda.js']) assert.match(await w.fetchOffline(asset),/^NUEVO:/);
  });
  await test('Instalación fallida conserva íntegra la caché v71 anterior y no activa el nuevo worker',async()=>{
    const w=workerHarness(sw,true);await assert.rejects(w.dispatch('install'),/Fallo sintético/);
    assert.equal(w.storage.get(w.oldName).get('https://prestcontrol.example/index.html'),'HTML-ANTERIOR');assert.equal(w.claimed,0);assert.equal(w.messages.length,0);
  });
  await test('Recarga PWA diferida hasta liberar operación/formulario; registro sin caché del worker',async()=>{
    let reloads=0;
    const scope={actualizacionPwaPendiente:null,recargaPwaEnCurso:false,actualizacionPwaRetryTimer:null,activeSheet:null,DB:{},
      window:{__prestcontrolOperationLocks:new Set(['clientes:importar'])},document:{querySelector:()=>null},
      hayRestauracionLocalPendiente:async()=>false,location:{reload:()=>{reloads++;}},toast:()=>{},setTimeout:()=>1,clearTimeout:()=>{},Set};
    for(const name of ['programarReintentoActualizacionPwa','hayOperacionSensibleParaActualizacionPwa','intentarAplicarActualizacionPwaPendiente','recibirActualizacionPwa']) scope[name]=compile(html,name,scope);
    await scope.recibirActualizacionPwa({data:{type:'PRESTCONTROL_SHELL_READY',cacheName:'prestcontrol-shell-v71-buscadores-v1'}});
    assert.equal(reloads,0);assert(scope.actualizacionPwaPendiente);
    scope.window.__prestcontrolOperationLocks.clear();scope.activeSheet='sh-importar-clientes';await scope.intentarAplicarActualizacionPwaPendiente();assert.equal(reloads,0);
    scope.activeSheet=null;await scope.intentarAplicarActualizacionPwaPendiente();assert.equal(reloads,1);await scope.intentarAplicarActualizacionPwaPendiente();assert.equal(reloads,1);
    assert(extract(html,'instalarPWA').includes("updateViaCache: 'none'"));
    assert(extract(html,'importarExcel').includes('todavía no está disponible. Volvé a abrir la aplicación.'));
  });
  console.log(JSON.stringify({passed,scope:'Verificación de compatibilidad y PWA; simulación aislada, sin auditoría financiera'}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
