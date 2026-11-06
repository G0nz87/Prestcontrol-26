// Revisión de compatibilidad y despliegue. Solo proyecto demo y emulador local.
// Las comprobaciones RIESGO reproducen comportamientos permitidos; no son correcciones.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const original = file => execFileSync('git', ['show', '3ed27bc:' + file], { cwd: root, encoding: 'utf8' });
// Reutilizar las herramientas de la suite anterior sin ejecutar su main.
const prefix = read('tests/apertura-caja.test.cjs').split('(async () => {')[0];
const h = new Function('require', '__dirname', prefix + '\nreturn {initializeTestEnvironment,assertFails,apertura,caja,candidate,peer,put,all,uid,dbFor,user,resolve,seed,source,extract,firebase,setEnvironment(value){env=value;}};')(require, __dirname);
const environments = [];
const results = [];
let env;
const oldRules = original('firestore.rules');
const newRules = read('firestore.rules');
const oldHtml = original('index.html');
const extractFrom = (source, name) => {
  const m = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n}'));
  assert(m, name); return m[0];
};
const compile = (source, name, scope) => new Function('scope', 'with (scope) { return (' + extractFrom(source, name) + '); }')(scope);
async function rules(source) {
  env = await h.initializeTestEnvironment({ projectId:'demo-prestcontrol-apertura', firestore:{host:'127.0.0.1',port:8089,rules:source} });
  environments.push(env); h.setEnvironment(env);
}
async function test(name, fn) { await fn(); results.push(name); console.log('OK ' + name); }
const rows = async (db, account, store) => (await h.user(db,account).collection(store).get({source:'server'})).docs.map(d=>({...d.data(),id:d.id}));
const openingCount = async (db, account) => (await rows(db,account,'movimientos_caja')).filter(m=>m.tipo==='SALDO_INICIAL'&&!m._deleted).length;

function queuePush(db, account, records, version) {
  const local = new Map(records.map(item=>[item.store+'/'+item.data.id,item.data]));
  const queue = records.map((item,i)=>({opId:'Q'+i,store:item.store,recordId:item.data.id,payload:item.data,operation:'upsert',estado:'pending'}));
  const errors=[];
  const scope = {
    _fbUser:{uid:account},_fbDb:db,DB:{},currentUser:'ISOLATED',drivePendingSync:true,
    aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,
    getSyncQueuePending:async()=>queue.filter(op=>['pending','error'].includes(op.estado)),
    consolidateSyncOperations:list=>list.map(op=>({op,opIds:[op.opId]})),
    dbGet:async(store,id)=>local.get(store+'/'+id),
    _userDoc:(store,id)=>h.user(db,account).collection(store).doc(id),
    isDeleteSyncOperation:()=>false,normalizarRegistroActivoParaSync:(store,data)=>data,
    normalizarUpdatedAtRemoto:data=>data,debePrevalecerRestauracionRemota:()=>false,
    debeConservarRestauracionLocal:()=>false,esRegresionEstadoMonotonico:()=>false,
    syncOperationTime:()=>0,markSyncOpDone:async id=>{queue.find(op=>op.opId===id).estado='done';},
    markSyncOpError:async(id,error)=>{queue.find(op=>op.opId===id).estado='error';errors.push(error);},
    syncDebugLog:()=>{},firebaseErrorMessage:e=>e.message,driveSetStatus:()=>{},
    setGlobalConfig:async()=>{},detectarEstadosHibridos:async()=>{},firebase:h.firebase
  };
  return {scope,queue,errors,push:compile(version===70?oldHtml:read('index.html'),'_pushToFirebaseSinLock',scope)};
}

async function normalOperations() {
  const account=h.uid(),db=h.dbFor(account),opening=h.candidate(20000000);
  await h.seed(account,[opening]);
  const window={};
  new Function('window',read('core/helpers.js').replace(/^export /gm,''))(window);
  const PrestamoService=new Function('window',read('services/PrestamoService.js').replace(/^export /gm,'')+'\nreturn PrestamoService;')(window);
  window.prestamoService=new PrestamoService({});window.cajaService=h.caja;
  window._fbUser={uid:account};window._fbDb=db;window.firebase=h.firebase;window.round2 ||= n=>Math.round(n*100)/100;
  const plan=window.prestamoService.calcularPlanPagos(1000,10,2);
  const loan={id:'PR-NORMAL',clienteId:'CL-NORMAL',clienteNombre:'Prueba aislada',fecha:'2026-01-01T12:00:00.000Z',monto:1000,total:plan.total,ganancia:plan.ganancia,nCuotas:2,estado:'Activo'};
  const installments=window.prestamoService.generarCuotas({prestamoId:loan.id,clienteId:loan.clienteId,clienteNombre:loan.clienteNombre,fechaInicio:new Date(loan.fecha),tipo:'Mensual',nCuotas:2,cuotaMonto:plan.cuotaMonto,primerNumeroId:1,nowISO:'2026-01-01T12:00:00.000Z'});
  const payout=h.caja.crearMovimiento({id:'MC-NORMAL',tipo:'DESEMBOLSO_PRESTAMO',direccion:'egreso',monto:1000,fecha:loan.fecha,prestamoId:loan.id,clienteId:loan.clienteId,automatico:true,sourceKey:'DESEMBOLSO_PRESTAMO:'+loan.id});
  const batch=db.batch();
  for(const item of [{store:'prestamos',data:loan},...installments.map(data=>({store:'cuotas',data})),{store:'movimientos_caja',data:payout}])batch.set(h.user(db,account).collection(item.store).doc(item.data.id),item.data);
  await batch.commit();
  // Funciones financieras actuales. El adaptador de commit publica los payloads
  // para comprobar permisos; no simula el protocolo completo de sync/DOM.
  const scope={window,DB:{},_fbUser:window._fbUser,_fbDb:db,DEVICE_ID:'ISOLATED',navigator:{onLine:true},firebase:h.firebase,
    ...window,MEDIOS_PAGO_PERMITIDOS:['Efectivo','Transferencia','MercadoPago','Otro'],ORIGEN_PAGO_ABONO:'abono_cuota',
    bloquearEscrituraPorRestorePending:async()=>false,nuevaOperacionFinanciera:()=>h.uid(),
    dbGet:async(store,id)=>{const s=await h.user(db,account).collection(store).doc(id).get({source:'server'});return s.exists?{...s.data(),id:s.id}:null;},
    dbAll:store=>rows(db,account,store),dbAllIncludeDeleted:store=>rows(db,account,store),
    _userDoc:(store,id)=>h.user(db,account).collection(store).doc(id),
    dbCommitOperacionPrestamoCajaAtomic:async records=>{const b=db.batch();for(const item of records)b.set(h.user(db,account).collection(item.store).doc(item.data.id),item.data,{merge:true});await b.commit();return{};}
  };
  for(const name of ['componentePagoIdDesdeMedio','normalizarComponentesPago','validarImporteContraSaldoCobrable','siguienteNumeroAbonoCuota','validarPayloadFinancieroFirestore','registrarCobroCuotaCaja','registrarAbonoCuotaCaja'])scope[name]=compile(read('index.html'),name,scope);
  await scope.registrarCobroCuotaCaja(installments[0].id,'Efectivo','2026-02-01T12:00:00.000Z');
  await scope.registrarAbonoCuotaCaja(installments[1].id,200,'Efectivo','2026-03-01T12:00:00.000Z');
  assert.equal((await scope.dbGet('cuotas',installments[1].id)).saldoPendiente,400);
  const current=await scope.dbGet('prestamos',loan.id),partial=await scope.dbGet('cuotas',installments[1].id);
  const renewalSource=read('ui/prestamos.js');
  scope.cuotaRemotaCoincideParaRenovacion=compile(renewalSource,'cuotaRemotaCoincideParaRenovacion',scope);
  scope.saldoCobrableCuota=window.saldoCobrableCuota;
  const close=compile(renewalSource,'cerrarCuotasPorRenovacion',scope);
  const closed=close([partial],'PR-RENOVADO','2026-04-01T12:00:00.000Z')[0];
  const renewalPlan=window.prestamoService.calcularPlanPagos(700,10,1);
  const next={...loan,id:'PR-RENOVADO',monto:700,total:renewalPlan.total,ganancia:renewalPlan.ganancia,nCuotas:1,estado:'Activo',origen:'renovacion',prestamoOrigenId:loan.id,montoNominal:700,montoCompensado:400,montoEntregado:300};
  const nextCuotas=window.prestamoService.generarCuotas({prestamoId:next.id,clienteId:loan.clienteId,clienteNombre:loan.clienteNombre,fechaInicio:new Date('2026-04-01T12:00:00.000Z'),tipo:'Mensual',nCuotas:1,cuotaMonto:renewalPlan.cuotaMonto,primerNumeroId:3,nowISO:'2026-04-01T12:00:00.000Z'});
  const cash=h.caja.crearMovimiento({id:'MC-RENOVADO',tipo:'DESEMBOLSO_RENOVACION',direccion:'egreso',monto:300,fecha:'2026-04-01',prestamoId:next.id,clienteId:loan.clienteId,automatico:true,sourceKey:'DESEMBOLSO_RENOVACION:'+next.id});
  const records=[{store:'prestamos',data:next},{store:'prestamos',data:{...current,estado:'Pagado',cerradoPor:'renovacion',prestamoRenovacionId:next.id}},{store:'cuotas',data:closed},...nextCuotas.map(data=>({store:'cuotas',data})),{store:'movimientos_caja',data:cash}];
  await compile(renewalSource,'confirmarRenovacionParcialEnFirebase',scope)({prestamoOrigen:current,cuotasOrigen:[partial],registros:records});
  const movements=await rows(db,account,'movimientos_caja');
  assert.equal(h.caja.calcularSaldo(movements),19999500);
  assert.equal(movements.find(m=>m.id===opening.id).monto,20000000);
  assert.equal(await openingCount(db,account),1);
  assert.equal((await scope.dbGet('prestamos',loan.id)).prestamoRenovacionId,next.id);
}

(async()=>{
  await rules(oldRules);
  await test('v70/reglas v70: préstamo, cobro completo, parcial y renovación normales',normalOperations);
  await test('RIESGO frontend primero: v71 crea autoridad, v70 crea otra apertura con reglas viejas',async()=>{
    const account=h.uid(),db=h.dbFor(account);await h.resolve(db,account,h.candidate(20));
    const old=h.candidate(30);await h.user(db,account).collection('movimientos_caja').doc(old.id).set(old);
    assert.equal(await openingCount(db,account),2);
  });
  await test('RIESGO reglas viejas: autoridad y apertura v71 todavía se pueden sobrescribir',async()=>{
    const account=h.uid(),db=h.dbFor(account),confirmed=await h.resolve(db,account,h.candidate(20));
    await h.user(db,account).collection('movimientos_caja').doc(confirmed.movimiento.id).update({monto:30});
    await h.user(db,account).collection('control_caja').doc('apertura_GENERAL').update({movimientoId:'OTRO'});
    assert.equal((await h.user(db,account).collection('movimientos_caja').doc(confirmed.movimiento.id).get()).data().monto,30);
  });
  await rules(newRules);
  await test('v70/v71 con reglas nuevas y Caja existente: préstamos, cobros, parciales y renovación permitidos',normalOperations);
  await test('RIESGO reglas primero: batch v70 mixto rechazado entero, cola conservada',async()=>{
    const account=h.uid(),db=h.dbFor(account),old=h.candidate(20);
    const records=[{store:'movimientos_caja',data:old},{store:'clientes',data:{id:'CL-PENDING',nombre:'Prueba pendiente'}}];
    const state=queuePush(db,account,records,70);
    assert.equal(await state.push(),false);
    assert(state.queue.every(op=>op.estado!=='done'));
    assert.equal((await rows(db,account,'clientes')).length,0);
    assert.equal(await openingCount(db,account),0);
  });
  await test('RIESGO v71: apertura no confirmada impide publicar el resto de la cola',async()=>{
    const account=h.uid(),db=h.dbFor(account),records=[{store:'movimientos_caja',data:h.candidate(20)},{store:'clientes',data:{id:'CL-PENDING'}}];
    const state=queuePush(db,account,records,71);
    state.scope.confirmarAperturaCajaAutoritativa=()=>h.resolve(db,account);
    await assert.rejects(state.push(),/No se publicará automáticamente/);
    assert(state.queue.every(op=>op.estado==='pending'));
    assert.equal((await rows(db,account,'clientes')).length,0);
  });
  await test('Cola normal v70/v71 con Caja existente sigue publicándose con reglas nuevas',async()=>{
    for(const version of [70,71]){
      const account=h.uid(),db=h.dbFor(account);await h.seed(account,[h.candidate(20)]);
      const state=queuePush(db,account,[{store:'clientes',data:{id:'CL-NORMAL',nombre:'Prueba normal'}}],version);
      assert.equal(await state.push(),true);assert.equal(state.queue[0].estado,'done');
      assert.equal((await rows(db,account,'clientes')).length,1);
    }
  });
  await test('RIESGO restauración v70 grande: movimiento sobrescrito antes de rechazar apertura',async()=>{
    const account=h.uid(),db=h.dbFor(account),confirmed=await h.resolve(db,account,h.candidate(20));
    const cash={id:'MC-RESTORE-TEST',tipo:'DESEMBOLSO_PRESTAMO',direccion:'egreso',monto:1000};
    const cashRef=h.user(db,account).collection('movimientos_caja').doc(cash.id);
    await cashRef.set(cash);
    const scope={_fbUser:{uid:account},_fbDb:db,firebase:h.firebase,hayRestauracionLocalPendiente:async()=>true,_userDoc:(store,id)=>h.user(db,account).collection(store).doc(id),verificarPublicacionRestauracionFirebase:async()=>{}};
    scope.crearTombstoneRestauracion=compile(oldHtml,'crearTombstoneRestauracion',scope);
    const publish=compile(oldHtml,'publicarRestauracionFirebaseDesdePlan',scope);
    const clients=Array.from({length:399},(_,i)=>({id:'REST-'+i,nombre:'Restaurado de prueba'}));
    await assert.rejects(publish({authority:{id:'RESTORE-ISOLATED',restoredAt:'2026-11-05T12:00:00Z'},clientes:{subir:clients},movimientos_caja:{subir:[{...cash,monto:900}],sobrantesRemotos:[confirmed.movimiento]}}),e=>e.code==='permission-denied');
    assert.equal((await rows(db,account,'clientes')).length,399);
    assert.equal((await cashRef.get({source:'server'})).data().monto,900);
    assert.equal((await h.user(db,account).collection('movimientos_caja').doc(confirmed.movimiento.id).get()).data().monto,20);
  });
  await test('RIESGO reset antiguo sin autoridad: barrera preparing y cambios anteriores al rechazo',async()=>{
    const account=h.uid(),db=h.dbFor(account),opening=h.candidate(20);await h.seed(account,[opening]);
    const user=h.user(db,account);await user.collection('clientes').doc('TEST').set({id:'TEST',nombre:'Prueba'});
    await user.set({prestcontrolDataReset:{id:'RESET-ISOLATED',status:'preparing'}},{merge:true});
    await user.collection('clientes').doc('TEST').set({id:'TEST',userId:account,_deleted:true,resetId:'RESET-ISOLATED'});
    await h.assertFails(user.collection('movimientos_caja').doc(opening.id).set({id:opening.id,userId:account,_deleted:true,resetId:'RESET-ISOLATED'}));
    assert.equal((await user.get()).data().prestcontrolDataReset.status,'preparing');
    assert.equal((await user.collection('clientes').doc('TEST').get()).data()._deleted,true);
  });
  await test('RIESGO residual: reglas nuevas no hacen inmutables los demás movimientos financieros',async()=>{
    const account=h.uid(),db=h.dbFor(account);await h.resolve(db,account,h.candidate(20));
    const ref=h.user(db,account).collection('movimientos_caja').doc('DESEMBOLSO-TEST');
    await ref.set({id:'DESEMBOLSO-TEST',tipo:'DESEMBOLSO_PRESTAMO',direccion:'egreso',monto:1000});
    await ref.update({monto:999});assert.equal((await ref.get()).data().monto,999);
  });
  const rollbackAccount=h.uid(),rollbackDb=h.dbFor(rollbackAccount);
  await h.resolve(rollbackDb,rollbackAccount,h.candidate(20));
  await rules(oldRules);
  await test('RIESGO rollback a reglas v70: permite otra apertura aun existiendo autoridad',async()=>{
    const old=h.candidate(30);await h.user(rollbackDb,rollbackAccount).collection('movimientos_caja').doc(old.id).set(old);
    assert.equal(await openingCount(rollbackDb,rollbackAccount),2);
  });
  await rules(newRules);
  console.log(JSON.stringify({passed:results.length,scope:'Firestore Emulator demo; riesgos reproducidos, ninguna corrección aplicada',results},null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{for(const e of environments)await e.cleanup();});
