// Exclusivamente emulador demo local e IndexedDB en memoria. Sin configuración productiva.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtime = process.env.PRESTCONTROL_TEST_RUNTIME || path.join(os.tmpdir(), 'prestcontrol-caja-test-runtime');
const deps = createRequire(path.join(runtime, 'package.json'));
const { initializeTestEnvironment, assertFails } = deps('@firebase/rules-unit-testing');
const { indexedDB } = deps('fake-indexeddb');
const firebase = deps('firebase/compat/app');
deps('firebase/compat/firestore');
firebase.firestore.setLogLevel('silent');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = source('index.html');
const extract = name => {
  const match = html.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n}'));
  assert(match, 'Falta función ' + name);
  return match[0];
};
const load = (file, expression) => new Function(source(file).replace(/^export /gm, '') + '\nreturn ' + expression)();
const CajaService = load('services/CajaService.js', 'CajaService');
const { CajaAperturaService, APERTURA_MOVIMIENTO_ID } = load('services/CajaAperturaService.js', '({ CajaAperturaService, APERTURA_MOVIMIENTO_ID })');
const caja = new CajaService();
const apertura = new CajaAperturaService(caja);
const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();
let env;
let sequence = 0;
const namespace = 'ISOLATED-' + require('node:crypto').randomUUID();
const cases = [];
const uid = () => namespace + '-' + (++sequence);
const dbFor = account => env.authenticatedContext(account).firestore();
const user = (db, account) => db.collection('users').doc(account);
const resolve = (db, account, candidato = null) => apertura.resolver({ db, uid: account, candidato, serverTimestamp });
const candidate = (monto, operationId = 'ISOLATED-OP') => caja.crearMovimiento({
  id: caja.generarIdAutomatico('SALDO_INICIAL:GENERAL'), tipo: 'SALDO_INICIAL', direccion: 'ingreso',
  monto, fecha: '2026-11-05', concepto: 'Inicio de Caja', nota: '', medioPago: 'Efectivo',
  cuentaId: 'GENERAL', sourceKey: 'SALDO_INICIAL:GENERAL', operationId,
  createdByUid: null, deviceId: 'ISOLATED-DEVICE'
});
async function seed(account, rows) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const row of rows) await user(db, account).collection('movimientos_caja').doc(row.id).set(row);
  });
}
async function all(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function put(db, store, row) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
    tx.objectStore(store).put(row);
  });
}
async function localDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ISOLATED-CAJA-' + (++sequence), 1);
    request.onupgradeneeded = () => {
      for (const [store, keyPath] of [['movimientos_caja','id'],['sync_queue','opId'],['config','key'],['clientes','id'],['prestamos','id'],['cuotas','id'],['prendas','id'],['pagos_cuota','id'],['bitacora','id']]) request.result.createObjectStore(store, { keyPath });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function peer(account, db, local = null) {
  local ||= await localDb();
  const context = vm.createContext({
    DB: local, _fbUser: { uid: account }, _fbDb: db, navigator: { onLine: true },
    firebase, window: { cajaAperturaService: apertura }, updateSyncPendingBadge: async () => {}, console
  });
  vm.runInContext(extract('dbAplicarAperturaConfirmadaAtomic') + '\n' + extract('confirmarAperturaCajaAutoritativa'), context);
  context.window.confirmarAperturaCajaAutoritativa = context.confirmarAperturaCajaAutoritativa;
  return { context, local, confirm: c => context.confirmarAperturaCajaAutoritativa(c) };
}
async function test(name, fn) {
  await fn();
  cases.push(name);
  console.log('OK ' + name);
}
async function checkSingle(db, account, expected) {
  const snap = await user(db, account).collection('movimientos_caja').where('tipo','==','SALDO_INICIAL').get({ source: 'server' });
  assert.equal(snap.size, 1);
  assert.equal(snap.docs[0].data().monto, expected);
}

(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-prestcontrol-apertura',
    firestore: { host: '127.0.0.1', port: 8089, rules: source('firestore.rules') }
  });
  for (const amounts of [[20000000,30000000],[20000000,20000000]]) {
    await test('Dos dispositivos concurrentes: ' + amounts.join(' / '), async () => {
      const account = uid(), a = await peer(account, dbFor(account)), b = await peer(account, dbFor(account));
      const [first, second] = await Promise.all([a.confirm(candidate(amounts[0],'A')), b.confirm(candidate(amounts[1],'B'))]);
      assert.equal(first.movimiento.monto, second.movimiento.monto);
      assert.equal(Number(first.creada) + Number(second.creada), 1);
      await checkSingle(a.context._fbDb, account, first.movimiento.monto);
      for (const p of [a,b]) {
        assert.equal((await all(p.local,'movimientos_caja'))[0].monto, first.movimiento.monto);
        assert.equal((await all(p.local,'sync_queue')).length, 0);
        p.local.close();
      }
    });
  }
  await test('Dos pestañas con la misma IndexedDB convergen', async () => {
    const account = uid(), local = await localDb();
    const a = await peer(account, dbFor(account), local), b = await peer(account, dbFor(account), local);
    const results = await Promise.all([a.confirm(candidate(20,'A')),b.confirm(candidate(30,'B'))]);
    const rows = await all(local,'movimientos_caja');
    assert.equal(rows.length,1);
    assert.equal(results[0].movimiento.monto,results[1].movimiento.monto);
    assert.equal(rows[0].monto,results[0].movimiento.monto);
    local.close();
  });
  await test('Reintento con importe distinto recupera la apertura, sin reescribirla', async () => {
    const account = uid(), db = dbFor(account);
    const initial = await resolve(db,account,candidate(20));
    const before = (await user(db,account).collection('movimientos_caja').doc(initial.movimiento.id).get()).data();
    const retried = await resolve(db,account,candidate(999));
    assert.equal(retried.creada,false); assert.equal(retried.movimiento.monto,20);
    assert.deepEqual((await user(db,account).collection('movimientos_caja').doc(initial.movimiento.id).get()).data(),before);
  });
  await test('Sin conexión: no se crea apertura local ni operación pendiente', async () => {
    const account=uid(), p=await peer(account,dbFor(account));
    p.context.navigator.onLine=false;
    await assert.rejects(p.confirm(candidate(20)),/Internet/);
    assert.equal((await all(p.local,'movimientos_caja')).length,0);
    assert.equal((await all(p.local,'sync_queue')).length,0);
    p.local.close();
  });
  await test('Red caída aunque navigator diga online: lectura del servidor rechazada', async () => {
    const account=uid(), db=dbFor(account), p=await peer(account,db);
    await db.disableNetwork();
    await assert.rejects(p.confirm(candidate(20)));
    assert.equal((await all(p.local,'movimientos_caja')).length,0);
    await db.enableNetwork();
    assert.equal(await resolve(db,account),null);
    p.local.close();
  });
  await test('Respuesta perdida tras commit real: el reintento recupera una sola apertura', async () => {
    const account=uid(), db=dbFor(account);
    const interrupted={collection: (...args)=>db.collection(...args),runTransaction: async cb=>{await db.runTransaction(cb);throw new Error('Respuesta perdida después del commit');}};
    const p=await peer(account,interrupted);
    await assert.rejects(p.confirm(candidate(20)),/Respuesta perdida/);
    assert.equal((await all(p.local,'movimientos_caja')).length,0);
    p.context._fbDb=db;
    const recovered=await p.confirm(candidate(30));
    assert.equal(recovered.creada,false); assert.equal(recovered.movimiento.monto,20);
    await checkSingle(db,account,20); p.local.close();
  });
  await test('Fallo atómico local después del commit remoto: recuperación sin duplicación', async () => {
    const account=uid(), db=dbFor(account), p=await peer(account,db), real=p.local;
    p.context.DB={transaction: (...args)=>{const tx=real.transaction(...args);queueMicrotask(()=>tx.abort());return tx;}};
    await assert.rejects(p.confirm(candidate(20)));
    assert.equal((await all(real,'movimientos_caja')).length,0);
    p.context.DB=real;
    assert.equal((await p.confirm(candidate(30))).movimiento.monto,20);
    await checkSingle(db,account,20); real.close();
  });
  await test('Réplica y cola obsoletas se reconcilian con auditoría; otro movimiento queda intacto', async () => {
    const account=uid(),db=dbFor(account); await resolve(db,account,candidate(30));
    const p=await peer(account,db), old=candidate(20,'OLD');
    const other={id:'UNCHANGED',tipo:'OTRO_INGRESO',monto:5};
    await put(p.local,'movimientos_caja',old); await put(p.local,'movimientos_caja',other);
    await put(p.local,'sync_queue',{opId:'OLD',store:'movimientos_caja',recordId:old.id,payload:old,estado:'pending'});
    await p.confirm();
    const rows=await all(p.local,'movimientos_caja');
    assert.equal(rows.filter(m=>m.tipo==='SALDO_INICIAL'&&!m._deleted).length,1);
    assert.equal(rows.find(m=>m.id===APERTURA_MOVIMIENTO_ID).monto,30);
    assert.deepEqual(rows.find(m=>m.id==='UNCHANGED'),other);
    assert.equal((await all(p.local,'sync_queue'))[0].estado,'superseded');
    assert((await all(p.local,'config')).some(c=>c.value.registro?.monto===20));
    await checkSingle(db,account,30); p.local.close();
  });
  await test('Respaldo anterior conserva la apertura remota; importe incompatible se rechaza', async () => {
    const account=uid(), db=dbFor(account), confirmed=await resolve(db,account,candidate(20));
    const input={movimientosCaja:[]}, result=apertura.preservarEnRespaldo(input,confirmed);
    assert.equal(input.movimientosCaja.length,0); assert.equal(result.movimientosCaja[0].monto,20);
    assert.throws(()=>apertura.preservarEnRespaldo({movimientosCaja:[{...confirmed.movimiento,monto:30}]},confirmed));
    assert.throws(()=>apertura.preservarEnRespaldo({movimientosCaja:[candidate(20)]},null));
    await checkSingle(db,account,20);
  });
  await test('Apertura legacy se vincula sin alterar ningún movimiento', async () => {
    const account=uid(),db=dbFor(account),legacy=candidate(20),other={id:'NORMAL',tipo:'OTRO_INGRESO',monto:5};
    await seed(account,[legacy,other]);
    const before=(await user(db,account).collection('movimientos_caja').doc(legacy.id).get()).data();
    const result=await resolve(db,account,candidate(30));
    assert.equal(result.creada,false); assert.equal(result.movimiento.id,legacy.id);
    assert.deepEqual((await user(db,account).collection('movimientos_caja').doc(legacy.id).get()).data(),before);
    assert.deepEqual((await user(db,account).collection('movimientos_caja').doc('NORMAL').get()).data(),other);
    await checkSingle(db,account,20);
  });
  await test('Duplicados anteriores o apertura eliminada: bloqueo sin conversión', async () => {
    for(const rows of [[{...candidate(20),id:'OLD-A'},{...candidate(30),id:'OLD-B'}],[{...candidate(20),_deleted:true}]]) {
      const account=uid(),db=dbFor(account); await seed(account,rows);
      await assert.rejects(resolve(db,account,candidate(40)));
      assert.equal((await user(db,account).collection('control_caja').get()).size,0);
      assert.equal((await user(db,account).collection('movimientos_caja').get()).size,rows.length);
    }
  });
  await test('PWA antigua no puede crear apertura sin autoridad ni sobrescribir la ganadora', async () => {
    const account=uid(),db=dbFor(account),mov=user(db,account).collection('movimientos_caja');
    await assertFails(mov.doc(candidate(20).id).set(candidate(20)));
    const result=await resolve(db,account,candidate(20));
    await assertFails(mov.doc(result.movimiento.id).set({...result.movimiento,monto:30}));
    await assertFails(mov.doc(candidate(30).id).set(candidate(30)));
    await assertFails(mov.doc(result.movimiento.id).delete());
    await assertFails(mov.doc(result.movimiento.id).update({tipo:'OTRO_INGRESO'}));
    await assertFails(mov.doc(result.movimiento.id).set({id:result.movimiento.id,_deleted:true}));
    await checkSingle(db,account,20);
  });
  await test('Autoridad inmutable, no puede crearse sin movimiento ni reiniciarse la cuenta protegida', async () => {
    const account=uid(),db=dbFor(account),control=user(db,account).collection('control_caja').doc('apertura_GENERAL');
    await assertFails(control.set({version:1,cuentaId:'GENERAL',movimientoId:'MISSING',userId:account,confirmadaAt:serverTimestamp()}));
    await resolve(db,account,candidate(20));
    await assertFails(control.update({movimientoId:'OTHER'})); await assertFails(control.delete());
    await assertFails(user(db,account).set({prestcontrolDataReset:{id:'BAD',status:'preparing'}},{merge:true}));
    await user(db,account).set({foto:'ISOLATED'},{merge:true});
    await assertFails(user(db,account).delete());
  });
  await test('Aislamiento de usuarios y permisos financieros restantes conservados', async () => {
    const account=uid(),db=dbFor(account),otherDb=dbFor(uid()); await resolve(db,account,candidate(20));
    await assertFails(user(otherDb,account).collection('control_caja').doc('apertura_GENERAL').get());
    await assertFails(user(otherDb,account).collection('movimientos_caja').doc(APERTURA_MOVIMIENTO_ID).update({monto:999}));
    const normal=user(db,account).collection('movimientos_caja').doc('OTHER');
    await normal.set({tipo:'OTRO_INGRESO',monto:5}); await normal.update({nota:'normal'}); await normal.delete();
    const client=user(db,account).collection('clientes').doc('TEST');
    await client.set({nombre:'Prueba aislada'}); await client.update({nombre:'Prueba editada'}); await client.delete();
  });
  await test('La cola local rechaza altas nuevas de SALDO_INICIAL', async () => {
    const p=await peer(uid(),dbFor(uid()));
    vm.runInContext(extract('dbPutCajaAndQueueAtomic'),p.context);
    await assert.rejects(p.context.dbPutCajaAndQueueAtomic(candidate(20)),/no se encola/);
    assert.equal((await all(p.local,'sync_queue')).length,0); p.local.close();
  });
  await test('Push de cola vieja recupera autoridad, sin batch de apertura', async () => {
    const account=uid(),db=dbFor(account); await resolve(db,account,candidate(30));
    const p=await peer(account,db),old=candidate(20);
    await put(p.local,'movimientos_caja',old);
    await put(p.local,'sync_queue',{opId:'OLD',store:'movimientos_caja',recordId:old.id,payload:old,estado:'pending'});
    Object.assign(p.context,{
      aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,
      getSyncQueuePending:async()=>(await all(p.local,'sync_queue')).filter(op=>['pending','error'].includes(op.estado)),
      driveSetStatus:()=>{},drivePendingSync:true
    });
    vm.runInContext(extract('_pushToFirebaseSinLock'),p.context);
    assert.equal(await p.context._pushToFirebaseSinLock(),true);
    assert.equal((await all(p.local,'sync_queue'))[0].estado,'superseded');
    await checkSingle(db,account,30); p.local.close();
  });
  await test('Cola pendiente sin autoridad nunca abre Caja automáticamente', async () => {
    const account=uid(),db=dbFor(account),p=await peer(account,db),old=candidate(20);
    await put(p.local,'movimientos_caja',old);
    await put(p.local,'sync_queue',{opId:'OLD',store:'movimientos_caja',recordId:old.id,payload:old,estado:'pending'});
    Object.assign(p.context,{aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,getSyncQueuePending:async()=>all(p.local,'sync_queue')});
    vm.runInContext(extract('_pushToFirebaseSinLock'),p.context);
    await assert.rejects(p.context._pushToFirebaseSinLock(),/No se publicará automáticamente/);
    assert.equal((await user(db,account).collection('movimientos_caja').get()).size,0);
    p.local.close();
  });
  await test('Publicación de restauración omite apertura y su tombstone, preservando otros registros', async () => {
    const account=uid(),db=dbFor(account),confirmed=await resolve(db,account,candidate(20)),p=await peer(account,db);
    Object.assign(p.context,{
      hayRestauracionLocalPendiente:async()=>true,
      _userDoc:(store,id)=>user(db,account).collection(store).doc(id),
      verificarPublicacionRestauracionFirebase:async()=>{}
    });
    const publish = new Function('scope', 'with (scope) { return (' + extract('publicarRestauracionFirebaseDesdePlan') + '); }')(p.context);
    const plan={authority:{id:'ISOLATED-RESTORE',restoredAt:'2026-11-05T12:00:00Z'},movimientos_caja:{subir:[confirmed.movimiento],sobrantesRemotos:[confirmed.movimiento]},clientes:{subir:[{id:'ISOLATED-CLIENT',nombre:'Prueba'}]}};
    const result=await publish(plan);
    assert.equal(result.totalOps,1);
    await checkSingle(db,account,20);
    assert.equal((await user(db,account).collection('clientes').doc('ISOLATED-CLIENT').get()).data().nombre,'Prueba');
    p.local.close();
  });
  await test('Interfaz: sin éxito ni cierre del formulario antes de confirmación autoritativa', async () => {
    const fn=source('ui/caja.js').match(/async function confirmarSaldoInicial\([^]*?\n}/)[0];
    let release;
    const gate=new Promise(r=>release=r), messages=[];
    const scope={
      operationId:'TEST',nuevaOperacion:()=>'',document:{getElementById:()=>({})},
      valor:id=>({'caja-fecha-inicial':'2026-11-05','caja-saldo-inicial':'20','caja-nota-inicial':''})[id],
      renderCaja:async()=>{},
      window:{cajaService:caja,iniciarOperacionProtegida:()=>({liberar(){}}),bloquearEscrituraPorRestorePending:async()=>false,
        getDataResetIdActual:async()=>'',_fbUser:{uid:'ISOLATED'},DEVICE_ID:'TEST',confirmarAperturaCajaAutoritativa:async()=>gate,
        closeSheet:()=>messages.push('CLOSED'),toast:msg=>messages.push(msg),fmtMoney:n=>String(n)}
    };
    const confirm=new Function('scope','with (scope) { return ('+fn+'); }')(scope);
    const waiting=confirm();
    await new Promise(r=>setTimeout(r,10)); assert.equal(messages.length,0);
    release({creada:true,movimiento:candidate(20)}); await waiting;
    assert(messages.some(msg=>msg.includes('confirmada por el servidor')));
    messages.length=0;
    scope.window.confirmarAperturaCajaAutoritativa=async()=>{throw new Error('Sin confirmación');};
    await confirm(); assert.equal(messages.length,1); assert(messages[0].includes('Sin confirmación')); assert(!messages.includes('CLOSED'));
  });
  await test('Restauración incompatible se rechaza antes de escribir stores locales', async () => {
    const account=uid(),db=dbFor(account),confirmed=await resolve(db,account,candidate(20)),p=await peer(account,db);
    await put(p.local,'movimientos_caja',confirmed.movimiento);
    let restored=false;
    Object.assign(p.context,{
      validarBackupCompletoPreview:()=>null,appDesbloqueada:true,
      toast:()=>{},getSyncQueuePending:async()=>[],_syncProcessing:false,_restoreApplying:false,
      dbRestoreStoresAtomic:async()=>{restored=true;}
    });
    vm.runInContext(extract('aplicarRestauracionBackupCompleto'),p.context);
    await assert.rejects(p.context.aplicarRestauracionBackupCompleto({clientes:[],prestamos:[],cuotas:[],movimientosCaja:[{...confirmed.movimiento,monto:30}]}),/difiere/);
    assert.equal(restored,false);
    assert.equal((await all(p.local,'movimientos_caja'))[0].monto,20);
    await checkSingle(db,account,20);p.local.close();
  });
  await test('Intento legacy pendiente sin servidor muestra la opción de confirmar explícitamente', async () => {
    const account=uid(),p=await peer(account,dbFor(account)),old=candidate(20);
    await put(p.local,'movimientos_caja',old);
    await put(p.local,'sync_queue',{opId:'OLD',store:'movimientos_caja',recordId:old.id,payload:old,estado:'pending'});
    const el={innerHTML:'',insertAdjacentHTML(position,html){this.innerHTML=html+this.innerHTML;}};
    Object.assign(p.context.window,{cajaService:caja,dbAll:async store=>all(p.local,store),getSyncQueuePending:async()=>all(p.local,'sync_queue'),esc:String});
    const render=new Function('window','document','navigator',source('ui/caja.js').replace(/^export /gm,'')+'\nreturn renderCaja;')(p.context.window,{getElementById:()=>el},p.context.navigator);
    await render();
    assert(el.innerHTML.includes('openIniciarCaja()'));assert(el.innerHTML.includes('sin confirmación'));
    p.context.navigator.onLine=false;await render();assert(el.innerHTML.includes('sin confirmación'));
    p.local.close();
  });
  await test('Cambio de sesión durante la confirmación no escribe en otra cuenta local', async () => {
    const account=uid(),db=dbFor(account),confirmed=await resolve(db,account,candidate(20)),p=await peer(account,db);
    let release;const wait=new Promise(r=>release=r);
    p.context.window.cajaAperturaService={resolver:async()=>wait};
    const result=p.confirm();p.context._fbUser={uid:uid()};release(confirmed);
    await assert.rejects(result,/sesión cambió/);
    assert.equal((await all(p.local,'movimientos_caja')).length,0);p.local.close();
  });
  await test('Cuenta anterior con reset completado: adopta solo su apertura activa sin cambiar movimientos', async () => {
    const account=uid(),db=dbFor(account),old={...candidate(10),_deleted:true};
    const active={...candidate(20),id:'LEGACY-RESET',resetId:'RESET-ANTERIOR',sourceKey:'SALDO_INICIAL:GENERAL:RESET-ANTERIOR'};
    await seed(account,[old,active]);
    const result=await resolve(db,account,candidate(30));
    assert.equal(result.movimiento.id,active.id);assert.equal(result.movimiento.monto,20);
    assert.deepEqual((await user(db,account).collection('movimientos_caja').doc(old.id).get()).data(),old);
    assert.deepEqual((await user(db,account).collection('movimientos_caja').doc(active.id).get()).data(),active);
  });
  await test('Restauración completa real en IndexedDB de un respaldo anterior conserva apertura y autoridad', async () => {
    const account=uid(),db=dbFor(account),confirmed=await resolve(db,account,candidate(20)),p=await peer(account,db);
    await p.confirm();
    const serverBefore=(await user(db,account).collection('movimientos_caja').doc(confirmed.movimiento.id).get()).data();
    Object.assign(p.context,{
      validarBackupCompletoPreview:()=>null,appDesbloqueada:true,toast:()=>{},
      getSyncQueuePending:async()=>all(p.local,'sync_queue'),_syncProcessing:false,_restoreApplying:false,
      detenerSyncRealtime:()=>{},iniciarSyncRealtime:()=>{},clearTimeout:()=>{},_syncDebounce:null,
      drivePendingSync:false,updateBadges:async()=>{},renderPage:async()=>{}
    });
    for(const name of ['crearAutoridadRestauracion','prepararDatosRestauracionAutoritativa','dbRestoreStoresAtomic','aplicarRestauracionBackupCompleto'])vm.runInContext(extract(name),p.context);
    await p.context.aplicarRestauracionBackupCompleto({tipo:'prestcontrol-respaldo-manual',fecha:'2025-01-01',clientes:[],prestamos:[],cuotas:[],prendas:[],movimientosCaja:[],pagosCuota:[],bitacora:[]});
    const local=await all(p.local,'movimientos_caja');assert.equal(local.length,1);assert.equal(local[0].monto,20);
    assert((await all(p.local,'config')).some(row=>row.key==='restorePending'&&row.value.active));
    assert.equal((await user(db,account).collection('control_caja').doc('apertura_GENERAL').get()).data().movimientoId,confirmed.movimiento.id);
    assert.deepEqual((await user(db,account).collection('movimientos_caja').doc(confirmed.movimiento.id).get()).data(),serverBefore);
    p.local.close();
  });
  console.log(JSON.stringify({passed:cases.length,project:'demo-prestcontrol-apertura',backend:'Firestore Emulator 127.0.0.1:8089',local:'fake-indexeddb en memoria'},null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{await env?.cleanup();});
