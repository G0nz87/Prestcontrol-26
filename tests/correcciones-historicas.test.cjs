// Pruebas financieras y de persistencia reales contra Emulator demo, nunca producción.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const prefix=read('tests/revision-correcciones-v71.test.cjs').split(/\r?\n\(async\(\)=>\{/)[0];
const kit=new Function('require','__dirname',prefix+'\nreturn {a,editor};')(require,__dirname),a=kit.a;
let env;const results=[];
async function test(name,fn){await fn();results.push(name);console.log('OK '+name);}
const deshacer=(c,id,motivo='Error documental de prueba')=>a.historica.deshacer(c,id,motivo);
const renovar=(c,origen,ref,nominal,entregado=0)=>a.historica.ejecutar(c,{...a.solicitudPrestamo(ref,{nCuotas:1,monto:nominal,fecha:'2020-04-01'}),tipo:'renovacion',prestamoId:origen,modalidad:'refinanciacion_deuda_total',montoEntregado:entregado,interesRecibido:0});
const vivo=async(c,s)=>(await a.rows(c,s)).filter(d=>!d._deleted);
const replica=async(c,local)=>a.compile('replica',{window:{_fbUser:{uid:c.uid},obtenerDBLocalHistorica:()=>local},serializarHistorico:a.serializarHistorico,mismaSesion:()=>{}},read('ui/carga-historica.js'))({...c,local},await a.historica.snapshot(c));
const cajaCero=async c=>assert.equal((await a.rows(c,'movimientos_caja')).length,0);

// Simula una escritura de una versión vieja: lleva un evento sintácticamente válido,
// pero intenta cancelar un sucesor de renovación. Las reglas deben rechazarlo.
async function anulacionDirecta(c,id){
  const p=await a.get(c,'prestamos',id),estado=await a.historica.leer(c),opId='H-CLIENTE-VIEJO';
  const data={...p,estado:'Cancelado',ultimaOperacionHistorica:opId,eventoHistoricoVigente:opId};
  const key='prestamos__'+id,b=c.db.batch();
  b.set(a.doc(c,'prestamos',id),data);
  b.set(a.doc(c,'carga_inicial_eventos',opId),{id:opId,version:1,formato:2,userId:c.uid,sesionId:estado.sesionId,revision:estado.revision+1,tipo:'anulacion',fechaEconomica:new Date('2020-04-01'),confirmadaAt:a.h.firebase.firestore.FieldValue.serverTimestamp(),registros:[{store:'prestamos',data}],registrosPorClave:{[key]:data},anterioresPorClave:{[key]:p}});
  b.update(a.doc(c,'carga_inicial','estado'),{revision:estado.revision+1,ultimaOperacion:opId,actualizadaAt:a.h.firebase.firestore.FieldValue.serverTimestamp()});
  return b.commit();
}

(async()=>{
  env=await a.h.initializeTestEnvironment({projectId:'demo-prestcontrol-apertura',firestore:{host:'127.0.0.1',port:8089,rules:read('firestore.rules')}});a.setEnv(env);
  await test('Capital/interés/vencimientos: deshacer alta y recargar conserva auditoría y clientes',async()=>{
    const c=await a.nueva(),cliente=await a.get(c,'clientes','CL-V70');await a.crear(c,'ERROR');
    const original=await a.get(c,'carga_inicial_eventos','H-ERROR');await deshacer(c,'H-ERROR');
    assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,0);assert.equal((await vivo(c,'prestamos')).length,0);
    await a.crear(c,'CORRECTO',{monto:900,interesPorCuota:20,nCuotas:1,plan:[{fechaVenc:'2020-05-01T12:00:00Z',monto:1080}]});
    const v=await a.historica.verificar(c);assert.equal(v.prestamos,1);assert.equal(v.metricas.capitalPendiente,900);assert.equal(v.metricas.interesPendiente,180);
    assert.deepEqual(await a.get(c,'carga_inicial_eventos','H-ERROR'),original);assert.deepEqual(await a.get(c,'clientes','CL-V70'),cliente);await cajaCero(c);
    await assert.rejects(a.crear(c,'ERROR',{monto:900}),/referencia ya/);
  });
  await test('Deshacer anulación simple recupera exactamente la deuda y el plan anterior',async()=>{
    const c=await a.nueva();await a.crear(c,'ANULABLE');await a.historica.ejecutar(c,{tipo:'anulacion',referencia:'ANULA',prestamoId:'PH-ANULABLE',fecha:'2020-04-01'});
    assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,0);await deshacer(c,'H-ANULA');assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1200);await cajaCero(c);
  });
  await test('Cadena de renovaciones con parcial: solo se deshace en orden inverso',async()=>{
    const c=await a.nueva();await a.crear(c,'RAIZ');await a.pagar(c,'PARCIAL-RAIZ','PH-RAIZ','CH-RAIZ-001',200);
    await renovar(c,'PH-RAIZ','R1',1300,300);await a.pagar(c,'PARCIAL-R1','PH-R1','CH-R1-001',100,'2020-04-01');
    await renovar(c,'PH-R1','R2',1530,200);
    await assert.rejects(deshacer(c,'H-R1'),/posteriores/);await assert.rejects(deshacer(c,'H-PARCIAL-RAIZ'),/posteriores/);
    let v=await a.historica.verificar(c);assert.equal(v.metricas.totalPendiente,1683);assert.equal(v.metricas.totalCobrado,300);
    await deshacer(c,'H-R2');v=await a.historica.verificar(c);assert.equal(v.metricas.totalPendiente,1330);assert.equal(v.metricas.totalCobrado,300);
    await assert.rejects(deshacer(c,'H-R1'),/posteriores/);await deshacer(c,'H-PARCIAL-R1');await deshacer(c,'H-R1');
    v=await a.historica.verificar(c);assert.equal(v.metricas.totalPendiente,1000);assert.equal(v.metricas.totalCobrado,200);assert.equal(v.metricas.totalCompensadoRenovaciones,0);assert.equal((await vivo(c,'prestamos')).length,1);
    await deshacer(c,'H-PARCIAL-RAIZ');v=await a.historica.verificar(c);assert.equal(v.metricas.totalCobrado,0);assert.equal(v.metricas.totalPendiente,1200);await cajaCero(c);
  });
  await test('Renovación de capital/interés real: deshacer no convierte compensación en recuperación',async()=>{
    const c=await a.nueva();await a.crear(c,'CAPITAL',{nCuotas:1});
    await a.historica.ejecutar(c,{...a.solicitudPrestamo('CAPITAL-R',{nCuotas:1,fecha:'2020-03-01'}),tipo:'renovacion',prestamoId:'PH-CAPITAL',modalidad:'interes_cobrado_capital_renovado',montoEntregado:0,interesRecibido:100,medioPago:'Efectivo'});
    let v=await a.historica.verificar(c);assert.equal(v.metricas.capitalRecuperado,0);assert.equal(v.metricas.interesCobrado,100);
    await deshacer(c,'H-CAPITAL-R');v=await a.historica.verificar(c);assert.equal(v.metricas.capitalRecuperado,0);assert.equal(v.metricas.interesCobrado,0);assert.equal(v.metricas.capitalPendiente,1000);assert.equal(v.metricas.interesPendiente,100);await cajaCero(c);
  });
  await test('Reglas bloquean anulación directa aun con evento y revisión nuevos',async()=>{
    const c=await a.nueva();await a.crear(c,'ROOT');await renovar(c,'PH-ROOT','CHILD',1500,300);
    await a.h.assertFails(anulacionDirecta(c,'PH-CHILD'));assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1650);assert.equal((await a.historica.leer(c)).revision,2);
  });
  await test('Verificador rechaza cadena rota aunque sus after-images coincidan con auditoría',async()=>{
    const c=await a.nueva();await a.crear(c,'ROOT');await renovar(c,'PH-ROOT','CHILD',1500,300);const libro=await a.historica.snapshot(c);
    // Emula un libro legado defectuoso, sin formato 2: el control de cadena es independiente.
    for(const e of libro.carga_inicial_eventos)delete e.formato;
    const p=libro.prestamos.find(p=>p.id==='PH-CHILD');p.estado='Cancelado';
    libro.carga_inicial_eventos.find(e=>e.id==='H-CHILD').registros.find(r=>r.store==='prestamos'&&r.data.id===p.id).data.estado='Cancelado';
    assert.throws(()=>a.historica.verificarLibro(libro),/Cadena de renovación/);
  });
  await test('Deshacer un pago parcial anterior se bloquea mientras exista otro pago posterior',async()=>{
    const c=await a.nueva();await a.crear(c,'P');await a.pagar(c,'P1','PH-P','CH-P-001',200);await a.pagar(c,'P2','PH-P','CH-P-002',300,'2020-03-01');
    await assert.rejects(deshacer(c,'H-P1'),/posteriores/);await deshacer(c,'H-P2');await deshacer(c,'H-P1');assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1200);await cajaCero(c);
  });
  await test('Eventos de otra cadena no impiden corregir el último de la cadena elegida',async()=>{
    const c=await a.nueva();await a.crear(c,'A');await a.crear(c,'B');await a.pagar(c,'PA','PH-A','CH-A-001',100);await a.pagar(c,'PB','PH-B','CH-B-001',200);await deshacer(c,'H-PA');
    const v=await a.historica.verificar(c);assert.equal(v.metricas.totalCobrado,200);assert.equal((await a.get(c,'cuotas','CH-B-001')).totalAbonado,200);await cajaCero(c);
  });
  await test('Dos dispositivos deshacen simultáneamente: una sola corrección y revisión',async()=>{
    const c=await a.nueva();await a.crear(c,'DOBLE');const other={...c,db:a.h.dbFor(c.uid)};
    const r=await Promise.allSettled([deshacer(c,'H-DOBLE'),deshacer(other,'H-DOBLE')]);assert(r.every(x=>x.status==='fulfilled'));
    assert.equal((await a.historica.leer(c)).revision,2);assert.equal((await a.rows(c,'carga_inicial_eventos')).filter(e=>e.tipo==='reversion').length,1);await a.historica.verificar(other);await cajaCero(c);
  });
  await test('Motivos distintos concurrentes no sobrescriben la corrección ya confirmada',async()=>{
    const c=await a.nueva();await a.crear(c,'MOTIVO');const other={...c,db:a.h.dbFor(c.uid)};
    const r=await Promise.allSettled([deshacer(c,'H-MOTIVO','Motivo A'),deshacer(other,'H-MOTIVO','Motivo B')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.filter(x=>x.status==='rejected').length,1);assert.equal((await a.historica.leer(c)).revision,2);
    await a.h.assertFails(a.doc(c,'carga_inicial_eventos','R-H-MOTIVO').update({motivo:'Reemplazo'}));await a.h.assertFails(a.doc(c,'carga_inicial_eventos','H-MOTIVO').delete());
  });
  await test('Pérdida de respuesta tras commit: reintento recupera corrección sin duplicados',async()=>{
    const c=await a.nueva();await a.crear(c,'RESPUESTA');const interrupted={collection:(...args)=>c.db.collection(...args),runTransaction:async fn=>{await c.db.runTransaction(fn);throw new Error('Respuesta perdida tras commit remoto');}};
    await assert.rejects(deshacer({...c,db:interrupted},'H-RESPUESTA'),/Respuesta perdida/);assert.equal((await a.historica.leer(c)).revision,2);
    await deshacer(c,'H-RESPUESTA');assert.equal((await a.rows(c,'carga_inicial_eventos')).length,2);assert.equal((await a.historica.verificar(c)).prestamos,0);await cajaCero(c);
  });
  await test('Respuesta sin confirmación con red deshabilitada: recuperación remota idempotente',async()=>{
    const c=await a.nueva();await a.crear(c,'SIN-RED');await c.db.disableNetwork();
    try {await assert.rejects(deshacer({...c,db:{collection:(...x)=>c.db.collection(...x),runTransaction:fn=>c.db.runTransaction(fn,{maxAttempts:1})}},'H-SIN-RED'));}
    finally{await c.db.enableNetwork();}
    // disableNetwork no es un cortafuegos para las RPC de transacción del SDK.
    // El resultado de red puede ser ambiguo; no se anunció éxito y se recupera por ID fijo.
    await deshacer(c,'H-SIN-RED');assert.equal((await a.historica.leer(c)).revision,2);assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,0);await cajaCero(c);
  });
  await test('Fallo de transporte antes del envío no crea eventos ni cambios financieros',async()=>{
    const c=await a.nueva();await a.crear(c,'NO-ENVIO');const offline={collection:(...x)=>c.db.collection(...x),runTransaction:async()=>{throw Object.assign(new Error('Sin transporte'),{code:'unavailable'});}};
    await assert.rejects(deshacer({...c,db:offline},'H-NO-ENVIO'),/Sin transporte/);assert.equal((await a.historica.leer(c)).revision,1);assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1200);await cajaCero(c);
  });
  await test('Dos réplicas convergen a tombstones y saldo confirmado; ninguna cola histórica',async()=>{
    const c=await a.nueva();await a.crear(c,'DOS');await a.pagar(c,'DOS-P','PH-DOS','CH-DOS-001',200);const l1=await a.h.localDb(),l2=await a.h.localDb();
    try{await replica(c,l1);await replica(c,l2);await deshacer(c,'H-DOS-P');await replica(c,l1);assert.equal((await a.h.all(l2,'cuotas'))[0].totalAbonado,200);await replica(c,l2);
      for(const s of ['prestamos','cuotas','pagos_cuota'])assert.deepEqual(await a.h.all(l1,s),await a.h.all(l2,s));assert.equal((await a.h.all(l1,'sync_queue')).length,0);assert.equal((await a.h.all(l2,'sync_queue')).length,0);
    }finally{l1.close();l2.close();}
  });
  await test('Editor histórico sin red muestra error y conserva notas/cola sin éxito',async()=>{
    const c=await a.nueva();await a.crear(c,'NOTA-OFF');const e=await kit.editor(c,'PH-NOTA-OFF',{'edit-pre-notas':'No confirmado'},{offline:true});
    try{assert.match(e.error,/conexión/);assert.equal(e.mensajes.length,0);assert.equal((await a.h.all(e.local,'prestamos'))[0].notas,'');assert.equal((await a.h.all(e.local,'sync_queue')).length,0);assert.equal((await a.get(c,'prestamos','PH-NOTA-OFF')).notas,'');}finally{e.dispose();}
  });
  await test('Rechazo real de permisos: editor no cambia IndexedDB ni anuncia éxito',async()=>{
    const c=await a.nueva();await a.crear(c,'NOTA-DENY');const e=await kit.editor(c,'PH-NOTA-DENY',{'edit-pre-notas':'No autorizado'},{db:a.h.dbFor(a.h.uid())});
    try{assert(e.error);assert.equal(e.mensajes.length,0);assert.equal((await a.h.all(e.local,'prestamos'))[0].notas,'');assert.equal((await a.h.all(e.local,'sync_queue')).length,0);assert.equal((await a.get(c,'prestamos','PH-NOTA-DENY')).notas,'');}finally{e.dispose();}
  });
  await test('Notas legítimas tras cierre se confirman sobre dato remoto sin sobrescribir finanzas',async()=>{
    const c=await a.nueva();await a.crear(c,'NOTA-CERRADA');await a.cerrar(c);await a.h.apertura.resolver({...c,candidato:a.h.candidate(20000000)});
    const e=await kit.editor(c,'PH-NOTA-CERRADA',{'edit-pre-notas':'Documento revisado'});
    try{assert.equal(e.error,'');assert(e.mensajes.includes('Notas confirmadas por el servidor'));assert.equal((await a.h.all(e.local,'sync_queue')).length,0);assert.equal((await a.get(c,'prestamos','PH-NOTA-CERRADA')).notas,'Documento revisado');assert.equal(a.h.caja.calcularSaldo(await a.rows(c,'movimientos_caja')),20000000);}finally{e.dispose();}
  });
  await test('Reglas rechazan condiciones/cuotas históricas después del corte y aceptan cobros normales',async()=>{
    const c=await a.nueva();await a.crear(c,'POST');await a.cerrar(c);await a.h.apertura.resolver({...c,candidato:a.h.candidate(20000000)});
    for(const fields of [{monto:500},{nCuotas:1},{interesPorCuota:99},{fecha:'2020-05-01'},{estado:'Cancelado'}])await a.h.assertFails(a.doc(c,'prestamos','PH-POST').update(fields));
    for(const fields of [{monto:1},{fechaVenc:'2020-05-01'},{_deleted:true}])await a.h.assertFails(a.doc(c,'cuotas','CH-POST-001').update(fields));
    const scopeSource=read('tests/carga-historica.test.cjs').split('(async()=>{')[0];const normal=new Function('require','__dirname',scopeSource+'\nreturn {normal,set(e){env=e;h.setEnvironment(e);}};')(require,__dirname);normal.set(env);
    await normal.normal(c).registrarAbonoCuotaCaja('CH-POST-001',100,'Efectivo','2020-03-01T12:00:00Z');assert.equal(a.h.caja.calcularSaldo(await a.rows(c,'movimientos_caja')),20000100);await assert.rejects(deshacer(c,'H-POST'),/finalizada/);
  });
  await test('Respaldo tras corrección conserva eventos/tombstones y no reabre el corte',async()=>{
    const c=await a.nueva();await a.crear(c,'BACK');await a.pagar(c,'BACK-P','PH-BACK','CH-BACK-001',200);const viejo=await a.historica.snapshot(c);await deshacer(c,'H-BACK-P');await a.cerrar(c);
    const backup=await a.historica.respaldo(c);assert.equal(backup.eventos.length,3);assert.equal(backup.estado.estado,'finalizada');
    const book=await a.historica.snapshot(c),data={prestamos:book.prestamos,cuotas:book.cuotas,pagosCuota:book.pagos_cuota,prendas:[],movimientosCaja:[],cargaHistorica:backup};await a.historica.validarRespaldo(c,data);
    await assert.rejects(a.historica.validarRespaldo(c,{...data,prestamos:viejo.prestamos,cuotas:viejo.cuotas,pagosCuota:viejo.pagos_cuota}),/difiere/);await assert.rejects(deshacer(c,'H-BACK'),/finalizada/);await assert.rejects(a.historica.activar(c,'REABRIR-SESSION'));
  });
  await test('Edición normal de cuotas conserva cálculo/cola y el batch es aceptado por Firestore',async()=>{
    const c=await a.nueva(false),plan=a.historica.plan(a.solicitudPrestamo('NORMAL'),await a.get(c,'clientes','CL-V70'),'NORMAL',new Date().toISOString());
    const b=c.db.batch();b.set(a.doc(c,'prestamos',plan.prestamo.id),plan.prestamo);for(const q of plan.cuotas)b.set(a.doc(c,'cuotas',q.id),q);await b.commit();
    const e=await kit.editor(c,'PH-NORMAL',{'edit-pre-ncuotas':1});
    try{
      assert.equal(e.error,'');assert(e.mensajes.includes('Edición guardada en este dispositivo · pendiente de sincronización'));
      const cola=await a.h.all(e.local,'sync_queue');assert.equal(cola.length,3);const batch=c.db.batch();for(const op of cola)batch.set(a.doc(c,op.store,op.recordId),op.payload,{merge:true});await batch.commit();
      assert.equal((await a.get(c,'prestamos','PH-NORMAL')).nCuotas,1);assert.equal((await a.get(c,'prestamos','PH-NORMAL')).total,1100);await cajaCero(c);
    }finally{e.dispose();}
  });
  await test('Observaciones de clientes y préstamo normal con parcial siguen siendo legítimas',async()=>{
    const c=await a.nueva(false),plan=a.historica.plan(a.solicitudPrestamo('NORMAL-NOTA'),await a.get(c,'clientes','CL-V70'),'NORMAL-NOTA',new Date().toISOString());
    await a.doc(c,'prestamos',plan.prestamo.id).set(plan.prestamo);for(const q of plan.cuotas)await a.doc(c,'cuotas',q.id).set({...q,...(q.nro===1?{totalAbonado:100,estado:'Parcial'}:{})});
    await a.doc(c,'clientes','CL-V70').update({telefono:'55555555',observaciones:'Dato de contacto legítimo'});
    const e=await kit.editor(c,'PH-NORMAL-NOTA',{'edit-pre-notas':'Nota legítima normal'});
    try{assert.equal(e.error,'');const cola=await a.h.all(e.local,'sync_queue');assert.equal(cola.length,1);await a.doc(c,'prestamos','PH-NORMAL-NOTA').set(cola[0].payload,{merge:true});assert.equal((await a.get(c,'prestamos','PH-NORMAL-NOTA')).notas,'Nota legítima normal');assert.equal((await a.get(c,'clientes','CL-V70')).telefono,'55555555');}finally{e.dispose();}
  });
  await test('Confirmación remota y falla local se distinguen; consulta posterior recupera notas',async()=>{
    const c=await a.nueva();await a.crear(c,'REPLICA');const e=await kit.editor(c,'PH-REPLICA',{'edit-pre-notas':'Confirmada remota'},{fallaReplica:true});
    try{assert.match(e.error,/confirmadas en el servidor.*réplica local/);assert.equal(e.mensajes.length,0);assert.equal((await a.h.all(e.local,'prestamos'))[0].notas,'');assert.equal((await a.get(c,'prestamos','PH-REPLICA')).notas,'Confirmada remota');await replica(c,e.local);assert.equal((await a.h.all(e.local,'prestamos'))[0].notas,'Confirmada remota');assert.equal((await a.h.all(e.local,'sync_queue')).length,0);}finally{e.dispose();}
  });
  await test('Motivo obligatorio, evento inexistente, formato previo y reversión de corrección se bloquean',async()=>{
    const c=await a.nueva();await a.crear(c,'VALIDAR');await assert.rejects(deshacer(c,'H-VALIDAR',''),/motivo/);await assert.rejects(deshacer(c,'R-H-VALIDAR'),/evento histórico original/);await assert.rejects(deshacer(c,'H-INEXISTENTE'));
    const original=await a.get(c,'carga_inicial_eventos','H-VALIDAR');delete original.formato;
    await assert.rejects(a.historica.construirReversion(original,'R-H-VALIDAR',()=>{},await a.historica.leer(c)),/formato/);assert.equal((await a.historica.leer(c)).revision,1);
  });
  await test('Carrera de pago y corrección solo confirma estados serializables, sin deuda perdida',async()=>{
    const c=await a.nueva();await a.crear(c,'CARRERA');await a.pagar(c,'CARRERA-P1','PH-CARRERA','CH-CARRERA-001',200);
    const other={...c,db:a.h.dbFor(c.uid)};await Promise.allSettled([deshacer(c,'H-CARRERA-P1'),a.pagar(other,'CARRERA-P2','PH-CARRERA','CH-CARRERA-001',100,'2020-03-01')]);
    const v=await a.historica.verificar(c);assert([100,300].includes(v.metricas.totalCobrado));assert.equal(v.metricas.totalPendiente,1200-v.metricas.totalCobrado);await cajaCero(c);
  });
  await test('Carrera de cierre y corrección conserva corte o exige volver a verificar',async()=>{
    const c=await a.nueva();await a.crear(c,'CORTE');const v=await a.historica.verificar(c),other={...c,db:a.h.dbFor(c.uid)};
    const r=await Promise.allSettled([a.historica.finalizar(c,v.revision),deshacer(other,'H-CORTE')]);assert(r.some(x=>x.status==='fulfilled'));
    const estado=await a.historica.leer(c);
    if(estado.estado==='finalizada'){assert.equal(estado.revision,1);assert.equal((await vivo(c,'prestamos')).length,1);await assert.rejects(deshacer(c,'H-CORTE'),/finalizada/);}
    else{assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,0);await a.cerrar(c);}
    await cajaCero(c);
  });
  await test('Renovación de 120 cuotas y su reversión son atómicas dentro de límites de reglas',async()=>{
    const c=await a.nueva();await a.crear(c,'LARGO',{nCuotas:120,interesPorCuota:0});await a.historica.ejecutar(c,{...a.solicitudPrestamo('LARGO-R',{nCuotas:120,interesPorCuota:0,fecha:'2020-03-01'}),tipo:'renovacion',prestamoId:'PH-LARGO',modalidad:'refinanciacion_deuda_total',montoEntregado:0,interesRecibido:0});
    await deshacer(c,'H-LARGO-R');const v=await a.historica.verificar(c);assert.equal(v.prestamos,1);assert.equal(v.cuotas,120);assert.equal(v.metricas.totalPendiente,1000);await cajaCero(c);
  });
  await test('Pantalla real: deshacer exige motivo, recupera cuota y conserva cliente/cola',async()=>{
    const {createRequire}=require('node:module'),deps=createRequire(path.join(require('node:os').tmpdir(),'prestcontrol-caja-test-runtime','package.json')),{JSDOM}=deps('jsdom');
    const c=await a.nueva();await a.crear(c,'UI');await a.pagar(c,'UI-P','PH-UI','CH-UI-001',200);
    const local=await a.h.localDb(),cliente=await a.get(c,'clientes','CL-V70');await a.h.put(local,'clientes',cliente);
    const dom=new JSDOM('<body></body>'),window=dom.window,mensajes=[];
    Object.assign(window,a.win,{_fbUser:{uid:c.uid},_fbDb:c.db,firebase:a.h.firebase,obtenerDBLocalHistorica:()=>local,cargaHistoricaService:a.historica,prestamoService:a.prestamoService,fmtMoney:n=>String(n),hayRestauracionLocalPendiente:async()=>false,dbAllIncludeDeleted:s=>a.h.all(local,s),toast:m=>mensajes.push(m),iniciarOperacionProtegida:()=>({liberar(){}}),openSheet:()=>{},updateBadges:async()=>{}});
    const src=read('ui/carga-historica.js'),nombres=[...src.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
    const ui=new Function('window','document','navigator','HISTORICA_STORES','serializarHistorico','confirm',src.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')+'\nreturn {'+nombres.join(',')+'};')(window,window.document,{onLine:true},['prestamos','cuotas','pagos_cuota','prendas','movimientos_caja'],a.serializarHistorico,()=>true);Object.assign(window,ui);
    try{
      await ui.openCargaHistorica();assert.equal(window.document.getElementById('hrev-evento').value,'H-UI-P');await ui.historicaDeshacer();assert.match(mensajes.at(-1),/motivo/);assert.equal((await a.historica.leer(c)).revision,2);
      window.document.getElementById('hrev-motivo').value='Recibo ingresado por error';await ui.historicaDeshacer();assert.match(mensajes.at(-1),/Corrección histórica confirmada/);assert.equal((await a.historica.verificar(c)).metricas.totalPendiente,1200);
      assert.equal((await a.h.all(local,'pagos_cuota'))[0]._deleted,true);assert.deepEqual((await a.h.all(local,'clientes'))[0],cliente);assert.equal((await a.h.all(local,'sync_queue')).length,0);
      await a.h.put(local,'sync_queue',{opId:'PENDIENTE',store:'prestamos',estado:'error'});window.document.getElementById('hrev-motivo').value='No debe ejecutarse';await ui.historicaDeshacer();assert.match(mensajes.at(-1),/pendientes/);assert.equal((await a.historica.leer(c)).revision,3);
    }finally{local.close();dom.window.close();}
  });
  await test('Restore y publicación reales de respaldo idéntico conservan pagos revertidos y saldo inicial',async()=>{
    const vm=require('node:vm'),c=await a.nueva();await a.crear(c,'RESTORE');await a.pagar(c,'RESTORE-P','PH-RESTORE','CH-RESTORE-001',200);await deshacer(c,'H-RESTORE-P');await a.cerrar(c);
    const p=await a.h.peer(c.uid,c.db);try{
      await p.confirm(a.h.candidate(20000000));const book=await a.historica.snapshot(c),backup={tipo:'prestcontrol-respaldo-manual',v:7,fecha:new Date().toISOString(),clientes:book.clientes,prestamos:book.prestamos,cuotas:book.cuotas,pagosCuota:book.pagos_cuota,prendas:[],movimientosCaja:book.movimientos_caja,bitacora:[],cargaHistorica:await a.historica.respaldo(c)};
      const corte=a.serializarHistorico(await a.historica.leer(c));p.context.window.validarRespaldoHistorico=data=>a.historica.validarRespaldo(c,data);
      Object.assign(p.context,{validarBackupCompletoPreview:()=>null,appDesbloqueada:true,toast:()=>{},getSyncQueuePending:async()=>a.h.all(p.local,'sync_queue'),_syncProcessing:false,_restoreApplying:false,detenerSyncRealtime:()=>{},iniciarSyncRealtime:()=>{},clearTimeout:()=>{},_syncDebounce:null,drivePendingSync:false,updateBadges:async()=>{},renderPage:async()=>{}});
      for(const name of ['crearAutoridadRestauracion','prepararDatosRestauracionAutoritativa','dbRestoreStoresAtomic','aplicarRestauracionBackupCompleto'])vm.runInContext(a.h.extract(name),p.context);
      await p.context.aplicarRestauracionBackupCompleto(backup);
      const authority=(await a.h.all(p.local,'config')).find(r=>r.key==='restorePending').value.authority,plan={authority};
      for(const s of ['clientes','prestamos','cuotas','pagos_cuota','prendas','movimientos_caja','bitacora'])plan[s]={subir:await a.h.all(p.local,s),sobrantesRemotos:[]};
      const scope={_fbUser:{uid:c.uid},_fbDb:c.db,firebase:a.h.firebase,hayRestauracionLocalPendiente:async()=>true,_userDoc:(s,id)=>a.doc(c,s,id),fbObtenerTodosDesdeServidor:s=>a.rows(c,s)};
      for(const name of ['idAutoridadRestauracion','verificarPublicacionRestauracionFirebase','publicarRestauracionFirebaseDesdePlan'])scope[name]=a.compile(name,scope);
      await scope.publicarRestauracionFirebaseDesdePlan(plan);assert.equal((await a.get(c,'pagos_cuota','HH-RESTORE-P'))._deleted,true);assert.equal((await a.get(c,'cuotas','CH-RESTORE-001')).totalAbonado||0,0);assert.equal(a.h.caja.calcularSaldo(await a.rows(c,'movimientos_caja')),20000000);assert.deepEqual(a.serializarHistorico(await a.historica.leer(c)),corte);assert.equal((await a.rows(c,'carga_inicial_eventos')).length,3);
    }finally{p.local.close();}
  });
  await test('Reglas rechazan una reversión que intenta cambiar el capital de la imagen anterior',async()=>{
    const c=await a.nueva();await a.crear(c,'IMAGEN');await a.pagar(c,'IMAGEN-P','PH-IMAGEN','CH-IMAGEN-001',200);
    const original=await a.get(c,'carga_inicial_eventos','H-IMAGEN-P'),estado=await a.historica.leer(c),opId='R-H-IMAGEN-P',now=new Date().toISOString();
    const registros=await a.historica.construirReversion(original,opId,(s,id)=>a.get(c,s,id),estado),antes={},despues={};
    for(const item of registros){item.data={...item.data,ultimaOperacionHistorica:opId,updatedAt:now};if(item.store==='prestamos')item.data.monto=1;const key=item.store+'__'+item.data.id;antes[key]=await a.get(c,item.store,item.data.id);despues[key]=item.data;}
    const b=c.db.batch();for(const item of registros)b.set(a.doc(c,item.store,item.data.id),item.data);
    b.set(a.doc(c,'carga_inicial_eventos',opId),{id:opId,version:1,formato:2,userId:c.uid,sesionId:estado.sesionId,revision:estado.revision+1,tipo:'reversion',eventoOriginalId:original.id,motivo:'Intento inválido',fechaEconomica:new Date('2020-04-01'),confirmadaAt:a.h.firebase.firestore.FieldValue.serverTimestamp(),registros,registrosPorClave:despues,anterioresPorClave:antes});
    b.update(a.doc(c,'carga_inicial','estado'),{revision:estado.revision+1,ultimaOperacion:opId,actualizadaAt:a.h.firebase.firestore.FieldValue.serverTimestamp()});await a.h.assertFails(b.commit());
    assert.equal((await a.get(c,'prestamos','PH-IMAGEN')).monto,1000);assert.equal((await a.historica.verificar(c)).metricas.totalCobrado,200);assert.equal((await a.historica.leer(c)).revision,2);
  });
  console.log(JSON.stringify({passed:results.length,scope:'Correcciones verificadas, no reproducciones contabilizadas como soluciones',results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(env)await env.cleanup();});
