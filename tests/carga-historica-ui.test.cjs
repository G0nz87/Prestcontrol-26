// DOM aislado, IndexedDB en memoria y SDK contra emulador demo. No se inicia la app productiva.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const deps=createRequire(path.join(process.env.PRESTCONTROL_TEST_RUNTIME||path.join(os.tmpdir(),'prestcontrol-caja-test-runtime'),'package.json'));
const {JSDOM}=deps('jsdom');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const prefix=read('tests/carga-historica.test.cjs').split('(async()=>{')[0];
const h2=new Function('require','__dirname',prefix+'\nreturn {h,win,historica,prestamoService,metricas,serializarHistorico,nueva,crear,pagar,cerrar,normal,rows,get,doc,compile,setEnv(e){env=e;h.setEnvironment(e);}};')(require,__dirname);
const results=[];let env,dom,local;
const test=async(name,fn)=>{await fn();results.push(name);console.log('OK '+name);};
(async()=>{
  env=await h2.h.initializeTestEnvironment({projectId:'demo-prestcontrol-apertura',firestore:{host:'127.0.0.1',port:8089,rules:read('firestore.rules')}});h2.setEnv(env);
  const c=await h2.nueva(false);local=await h2.h.localDb();
  const cliente=await h2.get(c,'clientes','CL-V70');await h2.h.put(local,'clientes',cliente);
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/aislado'});
  const window=dom.window,mensajes=[];
  Object.assign(window,h2.win,{
    _fbUser:{uid:c.uid},_fbDb:c.db,firebase:h2.h.firebase,obtenerDBLocalHistorica:()=>local,cargaHistoricaService:h2.historica,prestamoService:h2.prestamoService,metricasFinancierasService:h2.metricas,cajaService:h2.h.caja,
    getSyncQueuePending:async()=>h2.h.all(local,'sync_queue'),hayRestauracionLocalPendiente:async()=>false,
    dbAllIncludeDeleted:store=>h2.h.all(local,store),dbAll:async store=>(await h2.h.all(local,store)).filter(d=>!d._deleted),
    getConfig:async key=>(await h2.h.all(local,'config')).find(r=>r.key===key)?.value||null,
    setConfig:(key,value)=>h2.h.put(local,'config',{key,value}),toast:m=>mensajes.push(m),
    iniciarOperacionProtegida:()=>({liberar(){}}),openSheet:id=>window.document.getElementById(id).classList.add('on'),updateBadges:async()=>{},fmtMoney:n=>Number(n).toFixed(2)
  });
  const uiSource=read('ui/carga-historica.js');
  const nombres=[...uiSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
  const ui=new Function('window','document','navigator','HISTORICA_STORES','serializarHistorico','confirm',uiSource.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')+'\nreturn {'+nombres.join(',')+'};')(window,window.document,{onLine:true},['prestamos','cuotas','pagos_cuota','prendas','movimientos_caja'],h2.serializarHistorico,()=>true);
  Object.assign(window,ui);
  const value=(id,v)=>{const el=window.document.getElementById(id);assert(el,id);el.value=String(v);};
  const noError=()=>assert(!mensajes.at(-1)?.startsWith('⚠️'),mensajes.at(-1));
  const commit=h2.compile('dbCommitOperacionPrestamoCajaAtomic',{window,DB:local,hayRestauracionLocalPendiente:async()=>false,STAMPED_STORES:['clientes','prestamos','cuotas','prendas','movimientos_caja','pagos_cuota'],updateSyncPendingBadge:()=>{}});
  await test('Pantalla: activación explícita conserva cliente v70 y replica estado sin cola',async()=>{
    await ui.openCargaHistorica();assert.match(window.document.body.textContent,/Activar carga histórica explícitamente/);
    await ui.historicaActivar();noError();assert.match(window.document.body.textContent,/CARGA HISTÓRICA ACTIVA/);assert.deepEqual((await h2.h.all(local,'clientes'))[0],cliente);assert.equal((await h2.h.all(local,'sync_queue')).length,0);
  });
  await test('Commit financiero normal real se rechaza durante carga antes de escribir IndexedDB',async()=>{
    await assert.rejects(commit([{store:'prestamos',data:{id:'NO-CREAR'}}]),/Usá Carga histórica/);assert.equal((await h2.h.all(local,'prestamos')).length,0);assert.equal((await h2.h.all(local,'sync_queue')).length,0);
  });
  await test('Pantalla: préstamo, vista de plan y pagos completos/parciales sin movimientos',async()=>{
    value('hp-ref','UI-LOAN');value('hp-cliente','CL-V70');value('hp-fecha','2020-01-01');value('hp-monto',1000);value('hp-tasa',10);value('hp-n',2);value('hp-periodo','Mensual');
    ui.historicaPrepararPlan('hp');assert.equal(window.document.querySelectorAll('#hp-plan [data-cuota]').length,2);
    await ui.historicaGuardarPrestamo();noError();assert.equal((await h2.h.all(local,'prestamos')).length,1);
    for(const [ref,monto,fecha]of[['UI-PAY1',200,'2020-02-01'],['UI-PAY2',400,'2020-03-01']]) {
      value('hpay-ref',ref);value('hpay-prestamo','PH-UI-LOAN');ui.historicaActualizarCuotas();value('hpay-cuota','CH-UI-LOAN-001');value('hpay-fecha',fecha);value('hpay-monto',monto);value('hpay-medio','Efectivo');await ui.historicaGuardarPago();noError();
    }
    assert.equal((await h2.h.all(local,'pagos_cuota')).length,2);assert.equal((await h2.rows(c,'movimientos_caja')).length,0);assert.equal((await h2.h.all(local,'sync_queue')).length,0);
  });
  await test('Respaldo durante carga conserva auditoría pero no puede restaurarse sobre carga activa',async()=>{
    const data=await ui.prepararBackupHistorico({clientes:[cliente],prestamos:[],cuotas:[]});assert.equal(data.cargaHistorica.estado.estado,'activa');assert.equal(data.cargaHistorica.eventos.length,3);
    await assert.rejects(ui.validarRespaldoHistorico(data),/antes de restaurar/);await assert.rejects(ui.validarEliminacionClienteHistorico('CL-V70'),/no puede eliminarse/);
  });
  await test('Pantalla: renovación mantiene vínculos y dinero adicional histórico sin Caja',async()=>{
    value('hr-ref','UI-RENEW');value('hr-origen','PH-UI-LOAN');value('hr-modalidad','refinanciacion_deuda_total');value('hr-fecha','2020-04-01');value('hr-monto',800);value('hr-tasa',10);value('hr-n',1);value('hr-periodo','Mensual');value('hr-entregado',200);value('hr-interes',0);
    await ui.historicaGuardarRenovacion();noError();assert.equal((await h2.get(c,'prestamos','PH-UI-RENEW')).montoCompensado,600);assert.equal((await h2.h.all(local,'prestamos')).length,2);assert.equal((await h2.rows(c,'movimientos_caja')).length,0);
  });
  await test('Historial real: fechas originales, cobros sin duplicar e interés/compensación correctos',async()=>{
    const book=await h2.historica.snapshot(c);
    const api=new Function('window',read('ui/historial.js').replace(/^export /gm,'')+'\nreturn {buildHistorial};')(window);
    const html=api.buildHistorial(book.prestamos,book.cuotas,book.pagos_cuota);
    assert.match(html,/2020/);assert.match(html,/600\.00/);assert.match(html,/100\.00/);assert.match(html,/no generan movimientos de Caja/);
    const porPeriodo=h2.metricas.calcularInteresPorPeriodo({...book,pagosCuota:book.pagos_cuota,periodoKey:fecha=>fecha?.slice(0,7)});
    assert.equal(porPeriodo['2020-02'],33.33);assert.equal(porPeriodo['2020-03'],66.67);assert.equal(Object.values(porPeriodo).reduce((s,n)=>s+n,0),100);
  });
  await test('Pantalla: verificación, confirmación escrita y cierre con corte remoto',async()=>{
    await ui.historicaVerificar();noError();assert.match(window.document.getElementById('historica-informe').textContent,/Verificación correcta/);
    value('historica-confirmacion','FINALIZAR');await ui.historicaFinalizar();noError();assert.match(window.document.body.textContent,/Carga finalizada de forma irreversible/);assert.equal((await h2.historica.leer(c)).estado,'finalizada');
  });
  await test('Pantalla: reapertura desde otro dispositivo recupera cierre; ya no hay formularios históricos',async()=>{
    await ui.openCargaHistorica();noError();assert.equal(window.document.getElementById('hp-ref'),null);assert.match(window.document.body.textContent,/Corte operativo/);
  });
  await test('Después del corte y antes de Caja, el commit normal y el borrado general siguen bloqueados',async()=>{
    await assert.rejects(commit([{store:'prestamos',data:{id:'NO-CREAR'}}]),/Abrí Caja/);await assert.rejects(ui.validarMantenimientoHistorico(),/No se permite/);
  });
  await test('Respaldo desde UI incorpora libro remoto y auditoría, conservando clientes',async()=>{
    const data=await ui.prepararBackupHistorico({tipo:'prestcontrol-respaldo-manual',fecha:new Date().toISOString(),clientes:[cliente],prestamos:[],cuotas:[],prendas:[],movimientosCaja:[],pagosCuota:[],bitacora:[]});
    assert.equal(data.v,7);assert.equal(data.cargaHistorica.estado.estado,'finalizada');assert.equal(data.cargaHistorica.eventos.length,4);assert.equal(data.prestamos.length,2);assert.deepEqual(data.clientes,[cliente]);await ui.validarRespaldoHistorico(data);
  });
  await test('Restauración completa real: rechazo previo sin mutaciones de respaldo anterior',async()=>{
    const p=await h2.h.peer(c.uid,c.db,local);
    p.context.window.validarRespaldoHistorico=ui.validarRespaldoHistorico;
    Object.assign(p.context,{validarBackupCompletoPreview:()=>null,appDesbloqueada:true,toast:()=>{},getSyncQueuePending:async()=>h2.h.all(local,'sync_queue'),_syncProcessing:false,_restoreApplying:false,detenerSyncRealtime:()=>{},iniciarSyncRealtime:()=>{},clearTimeout:()=>{},_syncDebounce:null,drivePendingSync:false,updateBadges:async()=>{},renderPage:async()=>{}});
    for(const name of ['crearAutoridadRestauracion','prepararDatosRestauracionAutoritativa','dbRestoreStoresAtomic','aplicarRestauracionBackupCompleto'])vm.runInContext(h2.h.extract(name),p.context);
    const antes=JSON.stringify(await h2.h.all(local,'prestamos'));
    await assert.rejects(p.context.aplicarRestauracionBackupCompleto({clientes:[],prestamos:[],cuotas:[]}),/difiere/);assert.equal(JSON.stringify(await h2.h.all(local,'prestamos')),antes);
  });
  await test('Restauración completa real y publicación idéntica preservan autoridad histórica y apertura',async()=>{
    const p=await h2.h.peer(c.uid,c.db,local);await p.confirm(h2.h.candidate(20000000));
    const data=await ui.prepararBackupHistorico({tipo:'prestcontrol-respaldo-manual',fecha:new Date().toISOString(),clientes:[cliente],prestamos:[],cuotas:[],prendas:[],movimientosCaja:[],pagosCuota:[],bitacora:[]});
    const corte=h2.serializarHistorico(await h2.historica.leer(c));
    p.context.window.validarRespaldoHistorico=ui.validarRespaldoHistorico;
    Object.assign(p.context,{validarBackupCompletoPreview:()=>null,appDesbloqueada:true,toast:()=>{},getSyncQueuePending:async()=>h2.h.all(local,'sync_queue'),_syncProcessing:false,_restoreApplying:false,detenerSyncRealtime:()=>{},iniciarSyncRealtime:()=>{},clearTimeout:()=>{},_syncDebounce:null,drivePendingSync:false,updateBadges:async()=>{},renderPage:async()=>{}});
    for(const name of ['crearAutoridadRestauracion','prepararDatosRestauracionAutoritativa','dbRestoreStoresAtomic','aplicarRestauracionBackupCompleto'])vm.runInContext(h2.h.extract(name),p.context);
    await p.context.aplicarRestauracionBackupCompleto(data);assert.equal((await h2.h.all(local,'prestamos')).length,2);
    const locals={};for(const [store,key]of[['clientes','clientes'],['prestamos','prestamos'],['cuotas','cuotas'],['prendas','prendas'],['movimientos_caja','movimientosCaja'],['pagos_cuota','pagosCuota'],['bitacora','bitacora']])locals[store]=await h2.h.all(local,store);
    const authority=(await h2.h.all(local,'config')).find(r=>r.key==='restorePending').value.authority;
    const plan={authority};for(const [store,data]of Object.entries(locals))plan[store]={subir:data,sobrantesRemotos:[]};
    const scope={_fbUser:{uid:c.uid},_fbDb:c.db,firebase:h2.h.firebase,hayRestauracionLocalPendiente:async()=>true,_userDoc:(s,id)=>h2.doc(c,s,id),fbObtenerTodosDesdeServidor:s=>h2.rows(c,s)};
    for(const name of ['idAutoridadRestauracion','verificarPublicacionRestauracionFirebase','publicarRestauracionFirebaseDesdePlan'])scope[name]=h2.compile(name,scope);
    await scope.publicarRestauracionFirebaseDesdePlan(plan);
    assert.deepEqual(h2.serializarHistorico(await h2.historica.leer(c)),corte);assert.equal((await h2.rows(c,'movimientos_caja')).length,1);assert.equal(h2.h.caja.calcularSaldo(await h2.rows(c,'movimientos_caja')),20000000);assert.equal((await h2.rows(c,'carga_inicial_eventos')).length,4);
  });
  await test('Commit IndexedDB y push reales después del corte: préstamo nuevo genera solo el egreso nuevo',async()=>{
    await h2.h.put(local,'config',{key:'restorePending',value:{active:false}});
    const p={id:'PR-NORMAL-UI',clienteId:'CL-V70',clienteNombre:cliente.nombre,monto:100,total:110,ganancia:10,nCuotas:1,tipo:'Mensual',estado:'Activo',fecha:'2026-01-01T12:00:00Z'};
    const cuotas=h2.prestamoService.generarCuotas({prestamoId:p.id,clienteId:p.clienteId,clienteNombre:p.clienteNombre,fechaInicio:new Date(p.fecha),tipo:'Mensual',nCuotas:1,cuotaMonto:110,primerNumeroId:1});
    const m=h2.h.caja.crearMovimiento({id:'MC-NORMAL-UI',tipo:'DESEMBOLSO_PRESTAMO',direccion:'egreso',monto:100,fecha:p.fecha,prestamoId:p.id,clienteId:p.clienteId,automatico:true,sourceKey:'DESEMBOLSO_PRESTAMO:'+p.id});
    await commit([{store:'prestamos',data:p},...cuotas.map(data=>({store:'cuotas',data})),{store:'movimientos_caja',data:m}]);
    const pendientes=async()=>(await h2.h.all(local,'sync_queue')).filter(q=>['pending','error'].includes(q.estado));assert.equal((await pendientes()).length,3);
    const scope={_fbUser:{uid:c.uid},_fbDb:c.db,DB:local,currentUser:'ISOLATED',drivePendingSync:true,aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,getSyncQueuePending:pendientes,consolidateSyncOperations:lista=>lista.map(op=>({op,opIds:[op.opId]})),dbGet:async(s,id)=>(await h2.h.all(local,s)).find(d=>d.id===id),_userDoc:(s,id)=>h2.doc(c,s,id),isDeleteSyncOperation:()=>false,normalizarRegistroActivoParaSync:(s,d)=>d,normalizarUpdatedAtRemoto:d=>d,debePrevalecerRestauracionRemota:()=>false,debeConservarRestauracionLocal:()=>false,esRegresionEstadoMonotonico:()=>false,syncOperationTime:()=>0,markSyncOpDone:async id=>{const q=(await h2.h.all(local,'sync_queue')).find(q=>q.opId===id);await h2.h.put(local,'sync_queue',{...q,estado:'done'});},markSyncOpError:async(id,error)=>{throw new Error(error);},syncDebugLog:()=>{},firebaseErrorMessage:e=>e.message,driveSetStatus:()=>{},setGlobalConfig:async()=>{},detectarEstadosHibridos:async()=>{},firebase:h2.h.firebase};
    assert.equal(await h2.compile('_pushToFirebaseSinLock',scope)(),true);assert.equal((await pendientes()).length,0);assert.equal(h2.h.caja.calcularSaldo(await h2.rows(c,'movimientos_caja')),19999900);assert.equal((await h2.rows(c,'carga_inicial_eventos')).length,4);assert.equal((await h2.get(c,'prestamos',p.id)).cargaInicial,undefined);
  });
  console.log(JSON.stringify({passed:results.length,scope:'JSDOM + fake-indexeddb + Firestore Emulator demo',results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{local?.close();dom?.window.close();if(env)await env.cleanup();});
