// Exclusivamente demo + Firestore Emulator + IndexedDB en memoria. Nunca producción.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const prefix=read('tests/apertura-caja.test.cjs').split('(async () => {')[0];
const h=new Function('require','__dirname',prefix+'\nreturn {initializeTestEnvironment,assertFails,firebase,caja,apertura,candidate,peer,localDb,put,all,uid,dbFor,user,source,extract,setEnvironment(e){env=e;}};')(require,__dirname);
const win={};new Function('window',read('core/helpers.js').replace(/^export /gm,''))(win);
const load=(file,exp,scope={})=>new Function(...Object.keys(scope),read(file).replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')+'\nreturn '+exp)(...Object.values(scope));
const Prestamo=load('services/PrestamoService.js','PrestamoService',{window:win});
const Metricas=load('services/MetricasFinancierasService.js','MetricasFinancierasService',win);
const {CargaHistoricaService,serializarHistorico}=load('services/CargaHistoricaService.js','({CargaHistoricaService,serializarHistorico})',win);
const prestamoService=new Prestamo({}),metricas=new Metricas(),historica=new CargaHistoricaService(prestamoService,metricas);
const ts=()=>h.firebase.firestore.FieldValue.serverTimestamp();
const results=[];let env;
const ctx=account=>({uid:account,db:h.dbFor(account),serverTimestamp:ts});
const doc=(c,s,id)=>h.user(c.db,c.uid).collection(s).doc(id);
const get=async(c,s,id)=>(await doc(c,s,id).get({source:'server'})).data();
const rows=async(c,s)=>(await h.user(c.db,c.uid).collection(s).get({source:'server'})).docs.map(d=>({...d.data(),id:d.id}));
// El campo tipo de solicitud indica el evento; el período del plan viaja aparte.
const solicitudPrestamo=(ref,extra={})=>({tipo:'prestamo',referencia:ref,clienteId:'CL-V70',monto:1000,interesPorCuota:10,nCuotas:2,periodo:'Mensual',fecha:'2020-01-01',...extra});
async function nueva(activa=true) {
  const c=ctx(h.uid());await doc(c,'clientes','CL-V70').set({id:'CL-V70',nombre:'Cliente previo v70',telefono:'12345678',estado:'Activo',updatedAt:'2020-01-01'});
  if(activa)await historica.activar(c,'SESSION-'+c.uid);
  return c;
}
async function crear(c,ref,extra={}) {return historica.ejecutar(c,solicitudPrestamo(ref,extra));}
async function pagar(c,ref,p,q,monto,fecha='2020-02-01') {return historica.ejecutar(c,{tipo:'pago',referencia:ref,prestamoId:p,cuotaId:q,monto,fecha,medioPago:'Efectivo'});}
async function cerrar(c) {const v=await historica.verificar(c);return historica.finalizar(c,v.revision);}
async function test(name,fn){await fn();results.push(name);console.log('OK '+name);}
function compile(name,scope,source=read('index.html')) {
  const match=source.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}'));assert(match,name);
  return new Function('scope','with(scope){return ('+match[0]+');}')(scope);
}
function normal(c) {
  const window={...win,prestamoService,cajaService:h.caja,_fbUser:{uid:c.uid},_fbDb:c.db,firebase:h.firebase};
  const scope={...window,window,DB:{},DEVICE_ID:'ISOLATED',navigator:{onLine:true},MEDIOS_PAGO_PERMITIDOS:['Efectivo','Transferencia','MercadoPago','Otro'],ORIGEN_PAGO_ABONO:'abono_cuota',bloquearEscrituraPorRestorePending:async()=>false,nuevaOperacionFinanciera:()=>h.uid(),
    dbGet:async(store,id)=>{const s=await doc(c,store,id).get({source:'server'});return s.exists?{...s.data(),id:s.id}:null;},dbAll:store=>rows(c,store),dbAllIncludeDeleted:store=>rows(c,store),_userDoc:(s,id)=>doc(c,s,id),
    dbCommitOperacionPrestamoCajaAtomic:async records=>{const b=c.db.batch();for(const item of records)b.set(doc(c,item.store,item.data.id),item.data,{merge:true});await b.commit();return{};}};
  for(const name of ['componentePagoIdDesdeMedio','normalizarComponentesPago','validarImporteContraSaldoCobrable','siguienteNumeroAbonoCuota','validarPayloadFinancieroFirestore','registrarCobroCuotaCaja','registrarAbonoCuotaCaja'])scope[name]=compile(name,scope);
  return scope;
}

(async()=>{
  env=await h.initializeTestEnvironment({projectId:'demo-prestcontrol-apertura',firestore:{host:'127.0.0.1',port:8089,rules:read('firestore.rules')}});h.setEnvironment(env);
  await test('Clientes cargados en v70 se preservan íntegros al activar; no se habilita automáticamente',async()=>{
    const c=await nueva(false),antes=await get(c,'clientes','CL-V70');assert.equal(await historica.leer(c),null);
    await historica.activar(c,'SESSION-'+c.uid);assert.deepEqual(await get(c,'clientes','CL-V70'),antes);assert.equal((await historica.leer(c)).estado,'activa');
  });
  await test('Datos financieros previos: sin conversión ni autoridad histórica',async()=>{
    const c=await nueva(false);await doc(c,'prestamos','PREVIO').set({id:'PREVIO',monto:50});
    await assert.rejects(historica.activar(c,'SESSION-'+c.uid),/datos financieros/);assert.equal(await historica.leer(c),null);assert.equal((await get(c,'prestamos','PREVIO')).monto,50);
  });
  await test('Caja iniciada impide activar y conserva su apertura',async()=>{
    const c=await nueva(false);await h.apertura.resolver({...c,candidato:h.candidate(20000000)});
    await assert.rejects(historica.activar(c,'SESSION-'+c.uid));assert.equal(await historica.leer(c),null);assert.equal((await rows(c,'movimientos_caja')).length,1);
  });
  await test('Carrera de activación: escritura previa a la barrera se detecta y no se convierte',async()=>{
    const c=await nueva(false);let primera=true;
    const db={collection:(...args)=>c.db.collection(...args),runTransaction:async fn=>{if(primera){primera=false;await doc(c,'prestamos','RACE').set({id:'RACE',monto:77});}return c.db.runTransaction(fn);}};
    await assert.rejects(historica.activar({...c,db},'SESSION-'+c.uid),/conservaron íntegros/);
    assert.equal((await historica.leer(c)).estado,'rechazada');assert.equal((await get(c,'prestamos','RACE')).monto,77);
  });
  await test('PWA antigua bloqueada para finanzas durante carga; clientes siguen admitidos',async()=>{
    const c=await nueva();await h.assertFails(doc(c,'prestamos','VIEJO').set({id:'VIEJO',monto:100}));
    await h.assertFails(doc(c,'movimientos_caja','VIEJO').set({id:'VIEJO',tipo:'DESEMBOLSO_PRESTAMO',monto:100}));
    await doc(c,'clientes','NUEVO').set({id:'NUEVO',nombre:'Alta normal'});assert.equal((await rows(c,'clientes')).length,2);
  });
  await test('Préstamo original, fechas, cuotas y total exactos; cero egresos',async()=>{
    const c=await nueva();await crear(c,'PLAN',{monto:100,totalOriginal:101,nCuotas:3});
    const p=await get(c,'prestamos','PH-PLAN'),q=await rows(c,'cuotas');assert.equal(p.cargaInicial.sesionId,(await historica.leer(c)).sesionId);assert.equal(p.total,101);assert.equal(win.round2(q.reduce((s,q)=>s+q.monto,0)),101);assert.equal(p.fecha.slice(0,10),'2020-01-01');assert.equal((await rows(c,'movimientos_caja')).length,0);
    await historica.verificar(c);
  });
  await test('Plan original personalizado conserva vencimientos e importes',async()=>{
    const c=await nueva();await crear(c,'CUSTOM',{plan:[{fechaVenc:'2020-02-15T12:00:00Z',monto:500},{fechaVenc:'2020-03-20T12:00:00Z',monto:700}]});
    assert.equal((await get(c,'cuotas','CH-CUSTOM-002')).monto,700);assert.equal((await get(c,'cuotas','CH-CUSTOM-001')).fechaVenc,'2020-02-15T12:00:00.000Z');
  });
  await test('Pago histórico completo cancela préstamo sin ingreso de Caja y calcula interés',async()=>{
    const c=await nueva();await crear(c,'CANCELADO',{nCuotas:1});await pagar(c,'RECIBO','PH-CANCELADO','CH-CANCELADO-001',1100);
    const v=await historica.verificar(c);assert.equal((await get(c,'prestamos','PH-CANCELADO')).estado,'Pagado');assert.equal(v.metricas.capitalRecuperado,1000);assert.equal(v.metricas.interesCobrado,100);assert.equal(v.metricas.totalPendiente,0);assert.equal((await rows(c,'movimientos_caja')).length,0);
  });
  await test('Pago parcial histórico: capital e interés pendientes y ganancia correctos',async()=>{
    const c=await nueva();await crear(c,'PARCIAL');await pagar(c,'ABONO','PH-PARCIAL','CH-PARCIAL-001',200);
    const v=await historica.verificar(c);assert.equal(v.metricas.capitalPendiente,833.33);assert.equal(v.metricas.interesPendiente,166.67);assert.equal(v.metricas.capitalRecuperado,166.67);assert.equal(v.metricas.interesCobrado,33.33);assert.equal(v.metricas.totalCobrado,200);assert.equal((await rows(c,'movimientos_caja')).length,0);
  });
  await test('Renovación con parcial: relaciones y composición económica correctas, sin Caja',async()=>{
    const c=await nueva();await crear(c,'ORIGEN');await pagar(c,'PREVIO','PH-ORIGEN','CH-ORIGEN-001',200);
    await historica.ejecutar(c,{...solicitudPrestamo('RENOVADO'),tipo:'renovacion',prestamoId:'PH-ORIGEN',fecha:'2020-03-01',monto:1300,montoEntregado:300,interesRecibido:0,modalidad:'refinanciacion_deuda_total'});
    const nuevo=await get(c,'prestamos','PH-RENOVADO');assert.equal(nuevo.montoCompensado,1000);assert.equal(nuevo.montoEntregado,300);assert.equal(nuevo.prestamoOrigenId,'PH-ORIGEN');assert.equal((await get(c,'prestamos','PH-ORIGEN')).prestamoRenovacionId,nuevo.id);
    const v=await historica.verificar(c);assert.equal(v.metricas.totalCobrado,200);assert.equal(v.metricas.totalCompensadoRenovaciones,1000);assert.equal(v.metricas.efectivoEntregadoRenovaciones,300);assert.equal(v.metricas.capitalPendiente,1133.33);assert.equal(v.metricas.interesPendiente,426.67);assert.equal((await rows(c,'movimientos_caja')).length,0);
  });
  await test('Interés real cobrado y capital renovado: ganancia sin ingreso de Caja',async()=>{
    const c=await nueva();await crear(c,'CAPITAL',{nCuotas:1});
    await historica.ejecutar(c,{...solicitudPrestamo('CAPITAL2',{nCuotas:1}),tipo:'renovacion',prestamoId:'PH-CAPITAL',fecha:'2020-02-01',montoEntregado:0,interesRecibido:100,medioPago:'Efectivo',modalidad:'interes_cobrado_capital_renovado'});
    const v=await historica.verificar(c);assert.equal(v.metricas.capitalRecuperado,0);assert.equal(v.metricas.interesCobrado,100);assert.equal(v.metricas.capitalPendiente,1000);assert.equal(v.metricas.interesPendiente,100);assert.equal((await rows(c,'movimientos_caja')).length,0);
  });
  await test('Reintento idempotente y referencia incompatible: sin duplicados ni sobrescritura',async()=>{
    const c=await nueva();await Promise.all([crear(c,'IDEM'),crear(c,'IDEM')]);assert.equal((await rows(c,'prestamos')).length,1);assert.equal((await historica.leer(c)).revision,1);
    await assert.rejects(crear(c,'IDEM',{monto:2000}),/referencia ya/);await pagar(c,'PAGO','PH-IDEM','CH-IDEM-001',200);await pagar(c,'PAGO','PH-IDEM','CH-IDEM-001',200);assert.equal((await rows(c,'pagos_cuota')).length,1);assert.equal((await get(c,'cuotas','CH-IDEM-001')).totalAbonado,200);
  });
  await test('Pagos simultáneos no exceden saldo ni se aplican parcialmente',async()=>{
    const c=await nueva();await crear(c,'RACEPAY');const settled=await Promise.allSettled([pagar(c,'A','PH-RACEPAY','CH-RACEPAY-001',400),pagar(c,'B','PH-RACEPAY','CH-RACEPAY-001',400)]);
    assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal((await get(c,'cuotas','CH-RACEPAY-001')).totalAbonado,400);assert.equal((await rows(c,'pagos_cuota')).length,1);await historica.verificar(c);
  });
  await test('Caja se bloquea antes de finalizar, incluso cliente antiguo y operación directa',async()=>{
    const c=await nueva();await assert.rejects(h.apertura.resolver({...c,candidato:h.candidate(20)}),/Finalizá/);
    const b=c.db.batch(),mov=h.candidate(20);b.set(doc(c,'movimientos_caja',mov.id),mov);b.set(doc(c,'control_caja','apertura_GENERAL'),{version:1,cuentaId:'GENERAL',movimientoId:mov.id,userId:c.uid,confirmadaAt:ts()});await h.assertFails(b.commit());assert.equal((await rows(c,'movimientos_caja')).length,0);
  });
  await test('Verificación desactualizada impide cerrar; cierre confirmado fija corte irreversible',async()=>{
    const c=await nueva();await crear(c,'CORTE');const v=await historica.verificar(c);await pagar(c,'POSTCHECK','PH-CORTE','CH-CORTE-001',100);
    await assert.rejects(historica.finalizar(c,v.revision),/cartera cambió/);await cerrar(c);const antes=serializarHistorico(await historica.leer(c));await historica.finalizar(c,0);assert.deepEqual(serializarHistorico(await historica.leer(c)),antes);
    await h.assertFails(doc(c,'carga_inicial','estado').update({estado:'activa',actualizadaAt:ts()}));await h.assertFails(doc(c,'carga_inicial','estado').delete());await assert.rejects(historica.activar(c,'SESSION-OTHER'));await assert.rejects(pagar(c,'NUEVO','PH-CORTE','CH-CORTE-001',100),/no está activa/);
  });
  await test('Carrera pago/cierre: no se acepta una operación después del corte',async()=>{
    const c=await nueva();await crear(c,'RACECLOSE');const v=await historica.verificar(c);
    await Promise.allSettled([historica.finalizar(c,v.revision),pagar(c,'ULTIMO','PH-RACECLOSE','CH-RACECLOSE-001',100)]);
    if((await historica.leer(c)).estado==='activa')await cerrar(c);
    const s=await historica.leer(c);for(const e of await rows(c,'carga_inicial_eventos'))assert(e.confirmadaAt.toMillis()<=s.corteOperativoAt.toMillis());await assert.rejects(crear(c,'TARDE'));
  });
  await test('Dispositivo desactualizado no modifica históricos ni publica operaciones antes de Caja',async()=>{
    const c=await nueva();await crear(c,'STALE');await cerrar(c);
    await h.assertFails(doc(c,'prestamos','PH-STALE').update({monto:999}));await h.assertFails(doc(c,'pagos_cuota','TARDE').set({id:'TARDE',tipo:'ABONO_CUOTA',monto:1}));await h.assertFails(doc(c,'carga_inicial_eventos','H-STALE').update({revision:99}));
  });
  await test('Aperturas posteriores concurrentes conservan una sola autoridad y saldo real',async()=>{
    const c=await nueva();await crear(c,'CARTERA',{monto:60000000,nCuotas:1});await cerrar(c);
    const ambos=await Promise.all([h.apertura.resolver({...c,candidato:h.candidate(20000000)}),h.apertura.resolver({...c,candidato:h.candidate(30000000)})]);
    assert.equal(ambos[0].movimiento.monto,ambos[1].movimiento.monto);assert.equal((await rows(c,'movimientos_caja')).length,1);assert.equal(h.caja.calcularSaldo(await rows(c,'movimientos_caja')),ambos[0].movimiento.monto);
  });
  await test('Primer préstamo nuevo y cobro nuevo afectan Caja; fecha antigua no implica histórico',async()=>{
    const c=await nueva();await crear(c,'HIST');await cerrar(c);await h.apertura.resolver({...c,candidato:h.candidate(20000000)});
    const p={id:'PR-NUEVO',clienteId:'CL-V70',clienteNombre:'Cliente previo v70',fecha:'2026-01-01T12:00:00Z',monto:1000,total:1200,ganancia:200,nCuotas:2,estado:'Activo'},q=prestamoService.generarCuotas({prestamoId:p.id,clienteId:p.clienteId,clienteNombre:p.clienteNombre,fechaInicio:new Date(p.fecha),tipo:'Mensual',nCuotas:2,cuotaMonto:600,primerNumeroId:1});
    const m=h.caja.crearMovimiento({id:'MC-NUEVO',tipo:'DESEMBOLSO_PRESTAMO',direccion:'egreso',monto:1000,fecha:p.fecha,prestamoId:p.id,clienteId:p.clienteId,automatico:true,sourceKey:'DESEMBOLSO_PRESTAMO:'+p.id});
    const b=c.db.batch();for(const [s,data]of[['prestamos',p],...q.map(q=>['cuotas',q]),['movimientos_caja',m]])b.set(doc(c,s,data.id),data);await b.commit();assert.equal(h.caja.calcularSaldo(await rows(c,'movimientos_caja')),19999000);
    await normal(c).registrarCobroCuotaCaja('C-001','Efectivo','2019-01-01T12:00:00Z');assert.equal(h.caja.calcularSaldo(await rows(c,'movimientos_caja')),19999600);assert.equal((await rows(c,'movimientos_caja')).filter(m=>m.tipo==='COBRO_CUOTA')[0].cargaInicial,undefined);
  });
  await test('Pago normal de deuda histórica parcial usa ingreso normal sin reclasificar el préstamo',async()=>{
    const c=await nueva();await crear(c,'DEUDA');await pagar(c,'ANTES','PH-DEUDA','CH-DEUDA-001',200);await cerrar(c);await h.apertura.resolver({...c,candidato:h.candidate(20000000)});
    await normal(c).registrarAbonoCuotaCaja('CH-DEUDA-001',400,'Efectivo','2019-01-01T12:00:00Z');assert.equal(h.caja.calcularSaldo(await rows(c,'movimientos_caja')),20000400);assert.equal((await get(c,'cuotas','CH-DEUDA-001')).estado,'Pagado');const pagos=await rows(c,'pagos_cuota');assert.equal(pagos.filter(p=>p.cargaInicial).length,1);assert.equal(pagos.filter(p=>!p.cargaInicial).length,1);
  });
  await test('Respaldo incluye estado/auditoría; respaldo anterior no reabre ni sustituye finanzas',async()=>{
    const c=await nueva();await crear(c,'BACKUP');const antiguo=await historica.respaldo(c);await cerrar(c);
    const book=await historica.snapshot(c),data={prestamos:book.prestamos,cuotas:book.cuotas,pagosCuota:book.pagos_cuota,prendas:[],movimientosCaja:[],cargaHistorica:antiguo};
    await historica.validarRespaldo(c,data);assert.equal((await historica.leer(c)).estado,'finalizada');assert.equal(antiguo.estado.estado,'activa');assert.equal(antiguo.eventos.length,1);
    await assert.rejects(historica.validarRespaldo(c,{prestamos:[],cuotas:[]}),/difiere/);
    const otra=await nueva(false);await assert.rejects(historica.validarRespaldo(otra,data),/no corresponde/);
  });
  await test('Restauración idéntica admite metadatos; restauración vieja no sobrescribe movimiento',async()=>{
    const c=await nueva();await crear(c,'RESTORE');await cerrar(c);await h.apertura.resolver({...c,candidato:h.candidate(20)});
    const p=await get(c,'prestamos','PH-RESTORE');await doc(c,'prestamos',p.id).set({...p,_restoreAuthority:{id:'REST-1'},updatedAt:ts()});
    await h.assertFails(doc(c,'prestamos',p.id).set({...p,monto:900,_restoreAuthority:{id:'REST-2'},updatedAt:ts()}));
    await h.assertFails(doc(c,'prestamos',p.id).set({id:p.id,_deleted:true,_restoreAuthority:{id:'REST-3'}}));assert.equal((await get(c,'prestamos',p.id)).monto,1000);
  });
  await test('Anulación sin cobros y rechazo de anulación con pagos reales',async()=>{
    const c=await nueva();await crear(c,'ANULADO');await historica.ejecutar(c,{tipo:'anulacion',referencia:'ANULACION',prestamoId:'PH-ANULADO',fecha:'2020-02-01'});const v=await historica.verificar(c);assert.equal(v.metricas.totalPendiente,0);assert.equal(v.metricas.capitalBase,0);assert.equal((await get(c,'prestamos','PH-ANULADO')).estado,'Cancelado');
    await crear(c,'NOANULAR');await pagar(c,'REAL','PH-NOANULAR','CH-NOANULAR-001',10);await assert.rejects(historica.ejecutar(c,{tipo:'anulacion',referencia:'MALA',prestamoId:'PH-NOANULAR',fecha:'2020-03-01'}),/No se anula/);
  });
  await test('Falla de red no crea históricos ni una cola pendiente',async()=>{
    const c=await nueva();await c.db.disableNetwork();await assert.rejects(historica.leer(c));await c.db.enableNetwork();assert.equal((await rows(c,'carga_inicial_eventos')).length,0);
  });
  await test('Verificación detecta registro financiero alterado y bloquea cierre',async()=>{
    const c=await nueva();await crear(c,'INTEGRIDAD');await env.withSecurityRulesDisabled(async x=>{await x.firestore().collection('users').doc(c.uid).collection('cuotas').doc('CH-INTEGRIDAD-001').update({monto:999});});
    await assert.rejects(historica.verificar(c),/no coincide/);await assert.rejects(historica.finalizar(c,1));assert.equal((await historica.leer(c)).estado,'activa');
  });
  await test('Plan máximo de 120 cuotas se confirma atómicamente sin diferencias de centavos',async()=>{
    const c=await nueva();await crear(c,'MAXIMO',{monto:1000,nCuotas:120,interesPorCuota:0});assert.equal((await rows(c,'cuotas')).length,120);await historica.verificar(c);
  });
  await test('Réplicas IndexedDB no encolan históricos y conservan clientes locales',async()=>{
    const c=await nueva();await crear(c,'LOCAL');const local=await h.localDb();await h.put(local,'clientes',{id:'LOCAL-CLIENT',nombre:'Conservar'});
    const window={_fbUser:{uid:c.uid},obtenerDBLocalHistorica:()=>local};
    const replica=compile('replica',{window,serializarHistorico,mismaSesion:()=>{}},read('ui/carga-historica.js'));
    await replica({...c,local},await historica.snapshot(c));assert.equal((await h.all(local,'clientes'))[0].nombre,'Conservar');assert.equal((await h.all(local,'sync_queue')).length,0);assert.equal((await h.all(local,'prestamos')).length,1);
    const before=(await h.all(local,'config'))[0].value;assert.equal(before.estado,'activa');await crear(c,'LOCAL');await replica({...c,local},await historica.snapshot(c));assert.equal((await h.all(local,'prestamos')).length,1);local.close();
  });
  await test('Renovación normal posterior de deuda histórica mantiene composición y genera solo su egreso real',async()=>{
    const c=await nueva();await crear(c,'BASE');await pagar(c,'ABONOBASE','PH-BASE','CH-BASE-001',200);await cerrar(c);await h.apertura.resolver({...c,candidato:h.candidate(20000000)});
    const scope=normal(c),p=await get(c,'prestamos','PH-BASE'),cuotas=await rows(c,'cuotas');
    scope.cuotaRemotaCoincideParaRenovacion=compile('cuotaRemotaCoincideParaRenovacion',scope,read('ui/prestamos.js'));
    const close=compile('cerrarCuotasPorRenovacion',scope,read('ui/prestamos.js'));
    const plan=prestamoService.calcularPlanPagos(1300,10,1),next={id:'PR-REN-NORMAL',clienteId:p.clienteId,clienteNombre:p.clienteNombre,fecha:'2026-01-01T12:00:00Z',monto:1300,montoNominal:1300,total:plan.total,ganancia:plan.ganancia,nCuotas:1,estado:'Activo',origen:'renovacion',renovacionTipo:'refinanciacion_deuda_total',prestamoOrigenId:p.id,montoCompensado:1000,montoEntregado:300,cuotasCompensadas:cuotas.map(q=>q.id)};
    const nextQ=prestamoService.generarCuotas({prestamoId:next.id,clienteId:p.clienteId,clienteNombre:p.clienteNombre,fechaInicio:new Date(next.fecha),tipo:'Mensual',nCuotas:1,cuotaMonto:plan.cuotaMonto,primerNumeroId:1});
    const cash=h.caja.crearMovimiento({id:'MC-REN-NORMAL',tipo:'DESEMBOLSO_RENOVACION',direccion:'egreso',monto:300,fecha:next.fecha,prestamoId:next.id,clienteId:p.clienteId,automatico:true,sourceKey:'DESEMBOLSO_RENOVACION:'+next.id});
    const records=[{store:'prestamos',data:next},{store:'prestamos',data:{...p,estado:'Pagado',cerradoPor:'renovacion',prestamoRenovacionId:next.id}},...close(cuotas,next.id,next.fecha).map(data=>({store:'cuotas',data})),...nextQ.map(data=>({store:'cuotas',data})),{store:'movimientos_caja',data:cash}];
    await compile('confirmarRenovacionParcialEnFirebase',scope,read('ui/prestamos.js'))({prestamoOrigen:p,cuotasOrigen:cuotas,registros:records});
    assert.equal(h.caja.calcularSaldo(await rows(c,'movimientos_caja')),19999700);assert.equal((await get(c,'prestamos',next.id)).cargaInicial,undefined);
    const book=await historica.snapshot(c),m=metricas.calcularMetricasGlobales({prestamos:book.prestamos,cuotas:book.cuotas});assert.equal(m.totalCobrado,200);assert.equal(m.totalCompensadoRenovaciones,1000);
  });
  await test('Comprobación interrumpida se retoma explícitamente y el estado persiste en otro dispositivo',async()=>{
    const c=await nueva(false);await doc(c,'carga_inicial','estado').set({version:1,userId:c.uid,sesionId:'INTERRUPTED-SESSION',estado:'preparando',revision:0,creadaAt:ts(),actualizadaAt:ts()});
    await h.assertFails(doc(c,'prestamos','STALE').set({id:'STALE',monto:100}));await historica.activar(c,'OTHER-SESSION');
    const other=ctx(c.uid),nuevoServicio=new CargaHistoricaService(prestamoService,metricas);assert.equal((await nuevoServicio.leer(other)).sesionId,'INTERRUPTED-SESSION');assert.equal((await nuevoServicio.leer(other)).estado,'activa');
  });
  await test('Aislamiento por cuenta y protección contra cambio de procedencia tras el corte',async()=>{
    const c=await nueva(),other=ctx(h.uid());await crear(c,'PROTEGIDO');await cerrar(c);await h.apertura.resolver({...c,candidato:h.candidate(20)});
    await h.assertFails(h.user(other.db,c.uid).collection('carga_inicial').doc('estado').get());
    await h.assertFails(h.user(other.db,c.uid).collection('carga_inicial_eventos').doc('H-PROTEGIDO').get());
    await h.assertFails(doc(c,'prestamos','PH-PROTEGIDO').update({cargaInicial:null}));
    const p=await get(c,'prestamos','PH-PROTEGIDO');await h.assertFails(doc(c,'prestamos','FALSO-HISTORICO').set({...p,id:'FALSO-HISTORICO'}));
    assert.equal((await get(c,'prestamos','PH-PROTEGIDO')).cargaInicial.version,1);
  });
  await test('Cliente histórico: sin mutación al vincular, contacto editable, borrado antiguo y cascada rechazados',async()=>{
    const c=await nueva(),antes=await get(c,'clientes','CL-V70');await crear(c,'VINCULO');assert.deepEqual(await get(c,'clientes','CL-V70'),antes);
    await doc(c,'clientes','CL-V70').update({telefono:'99999999'});assert.equal((await get(c,'clientes','CL-V70')).telefono,'99999999');
    await h.assertFails(doc(c,'clientes','CL-V70').delete());await h.assertFails(doc(c,'clientes','CL-V70').update({_deleted:true}));
    await h.assertFails(doc(c,'carga_inicial_clientes','CL-V70').delete());await cerrar(c);await h.apertura.resolver({...c,candidato:h.candidate(20)});
    await h.assertFails(doc(c,'clientes','CL-V70').update({_deleted:true}));await h.assertFails(doc(c,'cuotas','CH-VINCULO-001').update({_deleted:true}));
  });
  await test('Validaciones rechazan fechas futuras, plan inconsistente y renovación que invente dinero',async()=>{
    const c=await nueva();await assert.rejects(crear(c,'FUTURO',{fecha:'2099-01-01'}),/no futura/);await assert.rejects(crear(c,'MALPLAN',{plan:[{fechaVenc:'2020-02-01',monto:1},{fechaVenc:'2020-03-01',monto:1}]}),/no coincide/);
    await crear(c,'DEUDOR');await assert.rejects(historica.ejecutar(c,{...solicitudPrestamo('INVENTADA'),tipo:'renovacion',prestamoId:'PH-DEUDOR',fecha:'2020-03-01',monto:1300,montoEntregado:400,modalidad:'refinanciacion_deuda_total'}),/no coinciden/);
    assert.equal((await rows(c,'prestamos')).length,1);assert.equal((await rows(c,'movimientos_caja')).length,0);
  });
  await test('Riesgo conserva atrasos y fechas reales; parcial vencido mantiene préstamo Atrasado',async()=>{
    const Riesgo=load('services/RiesgoClienteService.js','RiesgoClienteService',win),riesgo=new Riesgo(),c=await nueva();
    await crear(c,'RIESGO',{nCuotas:1});await pagar(c,'TARDIO','PH-RIESGO','CH-RIESGO-001',100,'2020-03-01');assert.equal((await get(c,'prestamos','PH-RIESGO')).estado,'Atrasado');
    let book=await historica.snapshot(c),r=riesgo.calcular('CL-V70',{prestamos:book.prestamos,cuotas:book.cuotas});assert.equal(r.indicadores.saldoVencido,1000);assert(r.indicadores.maxDiasAtrasoActual>30);
    await pagar(c,'TARDIO2','PH-RIESGO','CH-RIESGO-001',1000,'2020-04-01');book=await historica.snapshot(c);r=riesgo.calcular('CL-V70',{prestamos:book.prestamos,cuotas:book.cuotas});assert.equal(r.indicadores.cuotasPagadasTarde,1);assert.equal(r.indicadores.ratioPagosTarde,100);assert.equal((await get(c,'cuotas','CH-RIESGO-001')).fechaPago.slice(0,10),'2020-04-01');
  });
  console.log(JSON.stringify({passed:results.length,project:'demo-prestcontrol-apertura',backend:'Firestore Emulator 127.0.0.1:8089',results},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(env)await env.cleanup();});
