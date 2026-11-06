const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
// Auditoría diagnóstica: reproduce el riesgo existente; no certifica una corrección.
// Solo lee código local. DOM, almacenamiento y Firestore son simulaciones en memoria.
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
// Mantener la reproducción ORIGINAL de v70; la corrección actual se valida
// por separado con tests/apertura-caja.test.cjs contra Firestore Emulator.
const v70=p=>execFileSync('git',['show','3ed27bc:'+p],{cwd:root,encoding:'utf8'});
const extract=(src,name)=>{const m=src.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}'));if(!m)throw Error('Missing function '+name);return m[0];};
const js=src=>src.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const reports=[];
async function check(name,fn){await fn();reports.push({name,result:'PASS'});console.log((name.startsWith('BLOQUEO')?'REPRODUCIDO ':'VERIFICADO ')+name);}
function base(){
 const c=vm.createContext({window:{},console,Date,Math,Set,Map,Promise,Number,String,Boolean,Array,Object,JSON,Error,parseFloat,parseInt,isNaN,navigator:{onLine:true},structuredClone});
 vm.runInContext(js(read('core/helpers.js')),c);
 for(const file of ['services/CajaService.js','services/PrestamoService.js','services/MetricasFinancierasService.js'])vm.runInContext(js(read(file)),c);
 vm.runInContext('window.cajaService=new CajaService();window.prestamoService=new PrestamoService({});window.metricasFinancierasService=new MetricasFinancierasService();',c);
 return c;
}
const fixtures=()=>({prestamos:[{id:'TEST-PR-1',clienteId:'TEST-CL-1',monto:1000,total:1200,ganancia:200,estado:'Activo'}],cuotas:[{id:'TEST-C-1',prestamoId:'TEST-PR-1',clienteId:'TEST-CL-1',nro:1,monto:600,estado:'Pendiente',totalAbonado:0,saldoPendiente:600,notas:'',fechaVenc:'2026-01-01T12:00:00.000Z'},{id:'TEST-C-2',prestamoId:'TEST-PR-1',clienteId:'TEST-CL-1',nro:2,monto:600,estado:'Pendiente',totalAbonado:0,saldoPendiente:600,notas:'',fechaVenc:'2026-02-01T12:00:00.000Z'}],movimientos_caja:[],pagos_cuota:[]});
function paymentContext(data){
 const c=base(),writes=[];
 Object.assign(c,{DB:{},_fbUser:{uid:'ISOLATED-TEST'},_fbDb:{runTransaction(){throw Error('Unexpected remote write')}},DEVICE_ID:'TEST-DEVICE',bloquearEscrituraPorRestorePending:async()=>false,
  dbGet:async(s,id)=>structuredClone((data[s]||[]).find(x=>x.id===id)),dbAll:async s=>structuredClone(data[s]||[]),dbAllIncludeDeleted:async s=>structuredClone(data[s]||[]),
  dbCommitOperacionPrestamoCajaAtomic:async records=>{writes.push(...records);for(const r of records){data[r.store]||=[];const i=data[r.store].findIndex(x=>x.id===r.data.id);if(i>=0)data[r.store][i]=structuredClone(r.data);else data[r.store].push(structuredClone(r.data));}return {registros:records};}});
 const names=['componentePagoIdDesdeMedio','normalizarComponentesPago','validarImporteContraSaldoCobrable','registrarCobroCuotaCaja','registrarAbonoCuotaCaja'];
 vm.runInContext("const MEDIOS_PAGO_PERMITIDOS=['Efectivo','Transferencia','MercadoPago','Otro'];\n"+names.map(n=>extract(html,n)).join('\n'),c);
 return {c,writes};
}
(async()=>{
 await check('Cobro completo anterior a apertura: bloqueado, cero escrituras',async()=>{const {c,writes}=paymentContext(fixtures());await assert.rejects(vm.runInContext("registrarCobroCuotaCaja('TEST-C-1','Efectivo','2025-01-05T12:00:00.000Z')",c),e=>e.code==='CAJA_NO_INICIADA');assert.equal(writes.length,0);});
 await check('Pago parcial anterior a apertura: bloqueado, cero escrituras',async()=>{const {c,writes}=paymentContext(fixtures());await assert.rejects(vm.runInContext("registrarAbonoCuotaCaja('TEST-C-1',200,'Efectivo','2025-01-05T12:00:00.000Z')",c),e=>e.code==='CAJA_NO_INICIADA');assert.equal(writes.length,0);});
 await check('Cobro con fecha antigua después de apertura: genera ingreso normal de 600 y no permite duplicarlo',async()=>{
  const data=fixtures(),{c,writes}=paymentContext(data);data.movimientos_caja.push(c.window.cajaService.crearMovimiento({id:'TEST-APERTURA',tipo:'SALDO_INICIAL',direccion:'ingreso',monto:20000000,fecha:'2026-11-05',sourceKey:'SALDO_INICIAL:GENERAL'}));
  const r=await vm.runInContext("registrarCobroCuotaCaja('TEST-C-1','Efectivo','2025-01-05T12:00:00.000Z')",c);
  assert.equal(r.movimiento.monto,600);assert.equal(r.movimiento.direccion,'ingreso');assert.equal(r.movimiento.fecha,'2025-01-05T12:00:00.000Z');assert.equal(c.window.cajaService.calcularSaldo(data.movimientos_caja),20000600);
  const count=writes.length;await assert.rejects(vm.runInContext("registrarCobroCuotaCaja('TEST-C-1','Efectivo','2025-01-05T12:00:00.000Z')",c));assert.equal(writes.length,count);
 });
 await check('Métricas separadas de Caja: un parcial de 200 deja capital 833.33 e intereses 166.67 pendientes',async()=>{
  const c=base(),data=fixtures();data.cuotas[0]={...data.cuotas[0],estado:'Parcial',totalAbonado:200,saldoPendiente:400};const m=c.window.metricasFinancierasService.calcularMetricasGlobales({...data,clientes:[],hoy:new Date('2026-11-05T12:00:00Z')});assert.equal(m.capitalPendiente,833.33);assert.equal(m.interesPendiente,166.67);assert.equal(m.capitalRecuperado,166.67);assert.equal(m.interesCobrado,33.33);assert.equal(c.window.cajaService.calcularSaldo(data.movimientos_caja),0);
 });
 const shared={remote:new Map(),readCount:0,commits:[],transactions:0};let release;const barrier=new Promise(r=>release=r);
 function openingPeer(amount,device){
  const c=base(),local=new Map(),queue=[],messages=[];
  const service=c.window.cajaService;
  Object.assign(c,{DB:{},_fbUser:{uid:'ISOLATED-ACCOUNT'},DEVICE_ID:device,currentUser:'TEST ONLY',drivePendingSync:false,operationId:null,
   valor:id=>({'caja-saldo-inicial':String(amount),'caja-fecha-inicial':'2026-11-05','caja-nota-inicial':'isolated audit'})[id]||'',nuevaOperacion:()=>device,
   document:{getElementById:()=>({})},renderCaja:async()=>{},guardarLocalYEncolar:async m=>{local.set(m.id,structuredClone(m));queue.push({opId:device,store:'movimientos_caja',recordId:m.id,payload:m,operation:'upsert',createdAt:m.createdAt});return m;},
   aplicarResetRemotoPendiente:async()=>{},bloquearSyncPorRestorePending:async()=>false,getSyncQueuePending:async()=>queue.slice(),consolidateSyncOperations:entries=>entries.map(op=>({op,opIds:[op.opId]})),
   dbGet:async(s,id)=>structuredClone(local.get(id)),dbPut:async(s,row)=>local.set(row.id,structuredClone(row)),isDeleteSyncOperation:()=>false,
   normalizarRegistroActivoParaSync:(s,row)=>row,normalizarUpdatedAtRemoto:r=>r,markSyncOpDone:async id=>{const i=queue.findIndex(x=>x.opId===id);if(i>=0)queue.splice(i,1);},markSyncOpError:async(id,msg)=>{throw Error(msg)},
   setGlobalConfig:async()=>{},detectarEstadosHibridos:async()=>{},driveSetStatus:()=>{},syncDebugLog:()=>{},firebaseErrorMessage:e=>e.message,
   firebase:{firestore:{FieldValue:{serverTimestamp:()=>new Date().toISOString()}}},
   _userDoc:(store,id)=>({id,key:store+'/'+id,get:async()=>{const existing=shared.remote.get(store+'/'+id);shared.readCount++;if(shared.readCount===2)release();await barrier;return {id,exists:!!existing,data:()=>structuredClone(existing)};}}),
   _fbDb:{runTransaction:async()=>{shared.transactions++;throw Error('Unexpected transaction')},batch:()=>{const pending=[];return {set:(ref,data)=>pending.push([ref.key,structuredClone(data)]),commit:async()=>{for(const [key,row]of pending)shared.remote.set(key,row);shared.commits.push({device,amount});}}}}
  });
  Object.assign(c.window,{cajaService:service,iniciarOperacionProtegida:()=>({liberar(){}}),bloquearEscrituraPorRestorePending:async()=>false,dbAll:async()=>Array.from(local.values()),getDataResetIdActual:async()=>'',_fbUser:c._fbUser,DEVICE_ID:device,logBitacora:async()=>{},fmtMoney:n=>String(n),closeSheet:()=>{},toast:t=>messages.push(t)});
  vm.runInContext(extract(v70('ui/caja.js'),'confirmarSaldoInicial')+'\n'+extract(v70('index.html'),'_pushToFirebaseSinLock'),c);
  return {c,local,queue,messages};
 }
 await check('BLOQUEO ORIGINAL V70 REPRODUCIDO: dos aperturas concurrentes de 20M/30M sobre el mismo ID',async()=>{
  const a=openingPeer(20000000,'DEVICE-A'),b=openingPeer(30000000,'DEVICE-B');
  await Promise.all([vm.runInContext('confirmarSaldoInicial()',a.c),vm.runInContext('confirmarSaldoInicial()',b.c)]);
  assert.equal(a.local.size,1);assert.equal(b.local.size,1);assert.equal([...a.local.keys()][0],[...b.local.keys()][0]);
  assert(a.messages.some(t=>t.includes('Caja iniciada')));assert(b.messages.some(t=>t.includes('Caja iniciada')));
  const pushed=await Promise.all([vm.runInContext('_pushToFirebaseSinLock()',a.c),vm.runInContext('_pushToFirebaseSinLock()',b.c)]);
  assert.deepEqual(pushed,[true,true]);assert.equal(shared.remote.size,1);assert.equal(shared.transactions,0);assert.equal(a.queue.length,0);assert.equal(b.queue.length,0);
  const remote=[...shared.remote.values()][0];const mismatched=[a,b].filter(peer=>[...peer.local.values()][0].monto!==remote.monto);assert.equal(mismatched.length,1);
  reports.push({raceEvidence:{localA:[...a.local.values()][0].monto,localB:[...b.local.values()][0].monto,remote:remote.monto,successfulPushes:pushed,transactions:shared.transactions,remainingQueues:[a.queue.length,b.queue.length]}});
 });
 console.log(JSON.stringify({baseline:'v70',tests:reports.filter(r=>r.name).length,scope:'Actual source functions executed in isolated VM; fake DOM/local stores/Firestore in memory; no network or production data',reports},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
