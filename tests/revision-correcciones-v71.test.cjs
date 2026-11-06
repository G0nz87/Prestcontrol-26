// Regresiones de las correcciones. Evidencia previa intacta en docs/evidencia-v71/.
// Solo Emulator demo y réplicas en memoria.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const deps=createRequire(path.join(process.env.PRESTCONTROL_TEST_RUNTIME||path.join(os.tmpdir(),'prestcontrol-caja-test-runtime'),'package.json'));
const {JSDOM}=deps('jsdom');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const prefix=read('tests/carga-historica.test.cjs').split('(async()=>{')[0];
const a=new Function('require','__dirname',prefix+'\nreturn {h,win,historica,prestamoService,metricas,serializarHistorico,nueva,crear,pagar,cerrar,rows,get,doc,compile,solicitudPrestamo,setEnv(e){env=e;h.setEnvironment(e);}};')(require,__dirname);
let env;const results=[];
async function test(nombre,fn){await fn();results.push(nombre);console.log('OK '+nombre);}
const anular=(c,id,ref)=>a.historica.ejecutar(c,{tipo:'anulacion',referencia:ref,prestamoId:id,fecha:'2020-04-01',notas:'Prueba aislada de error de carga'});

async function editor(c,id,cambios,opciones={}) {
  const local=await a.h.localDb();
  for(const store of ['prestamos','cuotas','pagos_cuota','movimientos_caja'])for(const row of await a.rows(c,store))await a.h.put(local,store,a.serializarHistorico(row));
  const p=await a.get(c,'prestamos',id);
  const dom=new JSDOM('<body>'+['edit-pre-error','edit-pre-save','edit-pre-prenda','edit-pre-notas','edit-pre-monto','edit-pre-interes','edit-pre-ncuotas','edit-pre-tipo','edit-pre-fecha'].map(id=>`<input id="${id}">`).join('')+'</body>');
  const document=dom.window.document;
  const valores={'edit-pre-prenda':p.prenda||'','edit-pre-notas':p.notas||'','edit-pre-monto':p.monto,'edit-pre-interes':p.interesPorCuota,'edit-pre-ncuotas':p.nCuotas,'edit-pre-tipo':p.tipo,'edit-pre-fecha':p.fecha.slice(0,10),...cambios};
  Object.entries(valores).forEach(([id,v])=>{document.getElementById(id).value=String(v);});
  const dbAll=store=>a.h.all(local,store),dbGet=async(store,id)=>(await dbAll(store)).find(d=>d.id===id);
  const window={...a.win,_fbUser:{uid:c.uid},_fbDb:opciones.db||c.db,firebase:a.h.firebase,obtenerDBLocalHistorica:()=>local,cargaHistoricaService:a.historica,prestamoService:a.prestamoService,cajaService:a.h.caja,getConfig:async key=>(await dbAll('config')).find(r=>r.key===key)?.value||null,setConfig:(key,value)=>a.h.put(local,'config',{key,value}),dbAll};
  const uiScope={window,navigator:{onLine:!opciones.offline},serializarHistorico:a.serializarHistorico,HISTORICA_STORES:['prestamos','cuotas','pagos_cuota','prendas','movimientos_caja'],referenciasNotas:new Map()};
  for(const name of ['contexto','mismaSesion','pendientes','replica','guardarNotasPrestamoHistorico','validarOperacionFinancieraNormal'])uiScope[name]=a.compile(name,uiScope,read('ui/carga-historica.js'));
  window.validarOperacionFinancieraNormal=uiScope.validarOperacionFinancieraNormal;
  window.guardarNotasPrestamoHistorico=uiScope.guardarNotasPrestamoHistorico;
  if(opciones.fallaReplica)uiScope.replica=async()=>{throw new Error('Falla de almacenamiento sintética');};
  const mensajes=[];
  const scope={...a.win,window,document,DB:local,_editarPrestamoId:id,activeSheet:'sh-editar-prestamo',ESTADOS_PRESTAMO_NO_COBRABLE:['Pagado','Ejecutado','Cancelado'],STAMPED_STORES:['clientes','prestamos','cuotas','prendas','movimientos_caja','pagos_cuota'],iniciarOperacionProtegida:()=>({liberar(){}}),bloquearEscrituraPorRestorePending:async()=>false,hayRestauracionLocalPendiente:async()=>false,dbAll,dbAllIncludeDeleted:dbAll,dbGet,updateSyncPendingBadge:()=>{},toast:msg=>mensajes.push(msg),fmtMoney:n=>String(n),logBitacora:async()=>{},closeSheet:()=>{},renderPrestamos:async()=>{},updateBadges:async()=>{},renderDashboard:async()=>{},openPrestamoDetail:async()=>{},_fbUser:{uid:c.uid},DEVICE_ID:'ISOLATED',
    addToSyncQueueOrThrow:async(store,recordId,payload,operation)=>a.h.put(local,'sync_queue',{opId:'EDITOR-'+store+'-'+recordId,store,recordId,payload,operation,estado:'pending'})};
  for(const name of ['cuotaTieneEvidenciaPago','prestamoTienePagosRegistrados','validarDesembolsoCajaParaEdicion','dbPut','dbCommitOperacionPrestamoCajaAtomic','guardarEdicionPrestamo'])scope[name]=a.compile(name,scope);
  await scope.guardarEdicionPrestamo();
  return {local,mensajes,error:document.getElementById('edit-pre-error').textContent,dispose:()=>{local.close();dom.window.close();}};
}

(async()=>{
  env=await a.h.initializeTestEnvironment({projectId:'demo-prestcontrol-apertura',firestore:{host:'127.0.0.1',port:8089,rules:read('firestore.rules')}});a.setEnv(env);
  await test('Borrador: capital, intereses, cuotas y vencimientos editables antes de confirmar',async()=>{
    const cliente={id:'C',nombre:'Prueba'},ahora=new Date().toISOString();
    const original=a.historica.plan(a.solicitudPrestamo('DRAFT'),cliente,'DRAFT',ahora);
    const corregido=a.historica.plan(a.solicitudPrestamo('DRAFT',{monto:900,nCuotas:1,interesPorCuota:20,plan:[{fechaVenc:'2020-05-01T12:00:00Z',monto:1080}]}),cliente,'DRAFT',ahora);
    assert.equal(original.prestamo.monto,1000);assert.equal(corregido.prestamo.monto,900);assert.equal(corregido.prestamo.total,1080);assert.equal(corregido.cuotas[0].fechaVenc,'2020-05-01T12:00:00.000Z');
  });
  await test('Préstamo confirmado sin pagos: no se sobrescribe; anular y recargar conserva original y no mueve Caja',async()=>{
    const c=await a.nueva();await a.crear(c,'CAPITAL');
    await assert.rejects(a.crear(c,'CAPITAL',{monto:900}),/referencia ya/);await a.h.assertFails(a.doc(c,'prestamos','PH-CAPITAL').update({monto:900}));
    await anular(c,'PH-CAPITAL','ANULA-CAPITAL');await a.crear(c,'CAPITAL-CORRECTO',{monto:900,notas:'Sustituye el error PH-CAPITAL'});
    const v=await a.historica.verificar(c);assert.equal((await a.get(c,'prestamos','PH-CAPITAL')).estado,'Cancelado');assert.equal(v.metricas.capitalBase,900);assert.equal((await a.rows(c,'carga_inicial_eventos')).length,3);assert.equal((await a.rows(c,'movimientos_caja')).length,0);
  });
  await test('Pago completo erróneo: negativa y borrado rechazados; corrector recupera deuda sin Caja',async()=>{
    const c=await a.nueva();await a.crear(c,'PAGADO',{nCuotas:1});await a.pagar(c,'RECIBO','PH-PAGADO','CH-PAGADO-001',1100);
    await assert.rejects(a.pagar(c,'RECIBO','PH-PAGADO','CH-PAGADO-001',100));await assert.rejects(a.pagar(c,'NEGATIVO','PH-PAGADO','CH-PAGADO-001',-1100));await assert.rejects(anular(c,'PH-PAGADO','ANULAR'));
    await a.h.assertFails(a.doc(c,'pagos_cuota','HH-RECIBO').delete());assert.equal((await a.get(c,'cuotas','CH-PAGADO-001')).estado,'Pagado');assert.equal((await a.historica.verificar(c)).metricas.totalCobrado,1100);
    await a.historica.deshacer(c,'H-RECIBO','Recibo marcado por error');const v=await a.historica.verificar(c);assert.equal(v.metricas.totalCobrado,0);assert.equal(v.metricas.totalPendiente,1100);assert.equal((await a.get(c,'pagos_cuota','HH-RECIBO'))._deleted,true);assert.equal((await a.rows(c,'movimientos_caja')).length,0);
  });
  await test('Parcial histórico sobrecargado: deshacer y recargar corrige sin dinero ficticio',async()=>{
    const c=await a.nueva();await a.crear(c,'PARCIAL');await a.pagar(c,'PARCIAL-RECIBO','PH-PARCIAL','CH-PARCIAL-001',200);
    await assert.rejects(a.pagar(c,'PARCIAL-RECIBO','PH-PARCIAL','CH-PARCIAL-001',100));await assert.rejects(a.pagar(c,'REDUCIR','PH-PARCIAL','CH-PARCIAL-001',-100));await assert.rejects(anular(c,'PH-PARCIAL','ANULA-PARCIAL'));
    assert.equal((await a.get(c,'cuotas','CH-PARCIAL-001')).totalAbonado,200);assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1000);
    await a.historica.deshacer(c,'H-PARCIAL-RECIBO','Importe digitado incorrectamente');await a.pagar(c,'PARCIAL-CORREGIDO','PH-PARCIAL','CH-PARCIAL-001',100);
    const v=await a.historica.verificar(c);assert.equal(v.metricas.totalCobrado,100);assert.equal(v.metricas.totalPendiente,1100);assert.equal(v.pagos,1);assert.equal((await a.rows(c,'pagos_cuota')).length,2);
  });
  await test('Parcial subregistrado: solo puede agregarse la parte real faltante con otro evento',async()=>{
    const c=await a.nueva();await a.crear(c,'FALTANTE');await a.pagar(c,'PRIMERA-PARTE','PH-FALTANTE','CH-FALTANTE-001',100);await a.pagar(c,'COMPLEMENTO-DOCUMENTADO','PH-FALTANTE','CH-FALTANTE-001',100);
    assert.equal((await a.historica.verificar(c)).metricas.totalCobrado,200);assert.equal((await a.rows(c,'pagos_cuota')).length,2);assert.equal((await a.rows(c,'movimientos_caja')).length,0);
  });
  await test('REGRESIÓN B1: anular hijo renovado se bloquea; corrector recupera deuda original',async()=>{
    const c=await a.nueva();await a.crear(c,'ORIGEN');
    const request={...a.solicitudPrestamo('RENOVACION',{nCuotas:1,monto:1500,fecha:'2020-03-01'}),tipo:'renovacion',prestamoId:'PH-ORIGEN',modalidad:'refinanciacion_deuda_total',montoEntregado:300,interesRecibido:0};
    await a.historica.ejecutar(c,request);assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1650);
    await assert.rejects(a.historica.ejecutar(c,{...request,monto:1600,montoEntregado:400}));
    await assert.rejects(anular(c,'PH-RENOVACION','ANULA-RENOVACION'),/cadena de renovación/);
    assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1650);
    await a.historica.deshacer(c,'H-RENOVACION','Renovación ingresada por error');
    const v=await a.historica.verificar(c);assert.equal(v.metricas.totalPendiente,1200);assert.equal((await a.get(c,'prestamos','PH-ORIGEN')).prestamoRenovacionId,undefined);assert.equal((await a.get(c,'prestamos','PH-RENOVACION'))._deleted,true);assert.equal((await a.rows(c,'movimientos_caja')).length,0);
    await a.historica.finalizar(c,v.revision);assert.equal((await a.historica.leer(c)).estado,'finalizada');
  });
  await test('Después del corte: no reabre; el cambio de capital histórico no tiene desembolso original para editar',async()=>{
    const c=await a.nueva();await a.crear(c,'CERRADO');await a.cerrar(c);await a.h.apertura.resolver({...c,candidato:a.h.candidate(20000000)});
    await assert.rejects(a.crear(c,'NUEVO-HISTORICO'));await assert.rejects(a.historica.activar(c,'SESSION-REOPEN'));
    const validar=a.compile('validarDesembolsoCajaParaEdicion',{round2:a.win.round2});assert.throws(()=>validar({id:'PH-CERRADO',monto:1000},[]),/desembolso original/);
    assert.equal(a.h.caja.calcularSaldo(await a.rows(c,'movimientos_caja')),20000000);
  });
  await test('REGRESIÓN B2: reducir cuotas históricas se bloquea sin escritura ni falso éxito',async()=>{
    const c=await a.nueva();await a.crear(c,'EDITAR');await a.cerrar(c);await a.h.apertura.resolver({...c,candidato:a.h.candidate(20000000)});
    const e=await editor(c,'PH-EDITAR',{'edit-pre-ncuotas':1});
    try {
      assert.match(e.error,/No se pueden editar/);assert(!e.mensajes.length);
      const local=(await a.h.all(e.local,'prestamos')).find(p=>p.id==='PH-EDITAR');assert.equal(local.nCuotas,2);
      assert.equal((await a.h.all(e.local,'sync_queue')).length,0);await a.h.assertFails(a.doc(c,'prestamos','PH-EDITAR').update({nCuotas:1}));
      assert.equal((await a.get(c,'prestamos','PH-EDITAR')).nCuotas,2);assert.equal(a.h.caja.calcularSaldo(await a.rows(c,'movimientos_caja')),20000000);
    }finally{e.dispose();}
  });
  await test('REGRESIÓN B3: notas con parcial se confirman y replican sin usar cola',async()=>{
    const c=await a.nueva();await a.crear(c,'NOTAS');await a.pagar(c,'ABONO-NOTAS','PH-NOTAS','CH-NOTAS-001',100);
    const e=await editor(c,'PH-NOTAS',{'edit-pre-notas':'Corrección documental aislada'});
    try {
      assert.equal(e.error,'');assert(e.mensajes.includes('Notas confirmadas por el servidor'));
      assert.equal((await a.get(c,'prestamos','PH-NOTAS')).notas,'Corrección documental aislada');assert.equal((await a.h.all(e.local,'sync_queue')).length,0);
      assert.equal((await a.h.all(e.local,'prestamos')).find(p=>p.id==='PH-NOTAS').notas,'Corrección documental aislada');assert.equal((await a.historica.verificar(c)).metricas.totalCobrado,100);assert.equal((await a.rows(c,'movimientos_caja')).length,0);
    }finally{e.dispose();}
  });
  console.log(JSON.stringify({passed:results.length,scope:'Regresiones corregidas, Emulator e IndexedDB aislados; evidencia anterior conservada por separado',results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(env)await env.cleanup();});
