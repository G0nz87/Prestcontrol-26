import { HISTORICA_STORES, serializarHistorico } from '../services/CargaHistoricaService.js';

let libro = null;
let verificacion = null;
let ocupada = false;
const referenciasNotas = new Map();
const esc = valor => window.esc(String(valor ?? ''));
const dinero = n => window.fmtMoney(n);
const valor = id => document.getElementById(id)?.value?.trim() || '';
const input = (id,label,type='text',extra='') => `<div class="field"><label class="lbl" for="${id}">${label}</label><input class="inp" id="${id}" type="${type}" ${extra}></div>`;
const opciones = datos => datos.map(([id,nombre])=>`<option value="${esc(id)}">${esc(nombre)}</option>`).join('');
const select = (id,label,datos,extra='') => `<div class="field"><label class="lbl" for="${id}">${label}</label><select class="inp" id="${id}" ${extra}>${opciones(datos)}</select></div>`;
const medios = ['Efectivo','Transferencia','MercadoPago','Otro'].map(m=>[m,m]);

function contexto() {
  const local=window.obtenerDBLocalHistorica();
  if (!navigator.onLine || !window._fbUser?.uid || !window._fbDb || !local) throw new Error('La carga histórica requiere sesión, conexión y almacenamiento local.');
  return {db:window._fbDb,uid:window._fbUser.uid,serverTimestamp:()=>window.firebase.firestore.FieldValue.serverTimestamp(),local};
}
function mismaSesion(c) {
  if (window._fbUser?.uid!==c.uid || window.obtenerDBLocalHistorica()!==c.local) throw new Error('Cambió la cuenta activa. No se aplicó la réplica en otra cuenta.');
}
async function pendientes(c, inicio=false) {
  if (await window.hayRestauracionLocalPendiente?.()) throw new Error('Hay una restauración pendiente. Resolvela antes de usar la carga histórica.');
  // No usar el lector tolerante de sync: un error de IDB no significa cola vacía.
  const cola=await new Promise((resolve,reject)=>{
    const tx=c.local.transaction('sync_queue','readonly'),req=tx.objectStore('sync_queue').getAll();let filas;
    req.onsuccess=()=>{filas=req.result;};
    tx.oncomplete=()=>resolve(filas.filter(op=>!['done','superseded'].includes(op.estado)));
    tx.onerror=tx.onabort=()=>reject(tx.error||new Error('No se pudo verificar la cola local. No se guardó la operación.'));
  });
  if(cola.some(op=>HISTORICA_STORES.includes(op.store))) throw new Error('Hay operaciones financieras locales pendientes. Se requiere conciliación antes de continuar.');
  if(inicio) {
    const listas=await Promise.all(HISTORICA_STORES.map(s=>window.dbAllIncludeDeleted(s)));
    if(listas.some(lista=>lista.length)) throw new Error('Este dispositivo contiene datos financieros. No se borraron ni convirtieron; revisá la cuenta antes de activar.');
  }
  mismaSesion(c);
}
async function replica(c,snapshot) {
  mismaSesion(c);
  // No borrar stores ni escribir clientes: preservar las altas v70 y cambios locales.
  const datos=['prestamos','cuotas','pagos_cuota'];
  await new Promise((resolve,reject)=>{
    const tx=c.local.transaction([...datos,'config'],'readwrite');
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('No se pudo aplicar la réplica histórica. Reintentá con la misma referencia.'));
    datos.forEach(store=>(snapshot[store]||[]).forEach(data=>tx.objectStore(store).put(serializarHistorico(data))));
    tx.objectStore('config').put({key:'cargaHistoricaRemotaV1',value:serializarHistorico(snapshot.estado)});
  });
}
async function accion(nombre,fn) {
  if(ocupada) return;
  const lock=window.iniciarOperacionProtegida?.('historica:'+nombre,document.activeElement,'Confirmando...');
  if(!lock) return;
  ocupada=true;
  try {await fn();}
  catch(e) {window.toast('⚠️ '+e.message);}
  finally {ocupada=false;lock.liberar();}
}
function planCampos(prefijo) {
  return `<div class="form-grid form-grid-2">${input(prefijo+'-fecha','Fecha original del préstamo / renovación','date')}${input(prefijo+'-monto','Capital / nominal original','number','min="0.01" step="0.01"')}${input(prefijo+'-tasa','Interés por cuota (%)','number','min="0" step="0.0001" value="0"')}${input(prefijo+'-n','Cantidad de cuotas','number','min="1" max="120" step="1" value="1"')}${select(prefijo+'-periodo','Plan',[['Mensual','Mensual'],['Semanal','Semanal']])}${input(prefijo+'-total','Total contractual original (opcional)','number','min="0.01" step="0.01"')}${input(prefijo+'-notas','Notas / fuente documental')}</div><button class="btn btn-ghost btn-full" onclick="historicaPrepararPlan('${prefijo}')">Revisar / editar vencimientos e importes</button><div id="${prefijo}-plan"></div>`;
}
function solicitudPlan(prefijo) {
  const planEl=document.getElementById(prefijo+'-plan');
  const filas=[...(planEl?.querySelectorAll('[data-cuota]')||[])];
  return {fecha:valor(prefijo+'-fecha'),monto:Number(valor(prefijo+'-monto')),interesPorCuota:Number(valor(prefijo+'-tasa')),nCuotas:Number(valor(prefijo+'-n')),periodo:valor(prefijo+'-periodo'),totalOriginal:valor(prefijo+'-total'),notas:valor(prefijo+'-notas'),...(filas.length?{plan:filas.map(fila=>({fechaVenc:new Date(fila.querySelector('[data-fecha]').value+'T12:00:00').toISOString(),monto:Number(fila.querySelector('[data-monto]').value)}))}:{})};
}
function render() {
  const box=document.querySelector('#sh-historica .sheet-box');
  const estado=libro?.estado;
  let cuerpo;
  if(!estado && HISTORICA_STORES.some(store=>(libro?.[store]||[]).length)) {
    cuerpo='<p>La cuenta ya contiene registros financieros. No se habilitó carga histórica ni se modificó ningún dato. Esta función requiere una cuenta con clientes y sin operaciones financieras previas.</p>';
  } else if(!estado || estado.estado==='preparando') {
    cuerpo=`<p>Usá esta carga exclusivamente para la cartera anterior al inicio operativo. Los clientes existentes se conservan. No se generarán ingresos ni egresos de Caja.</p><p>Se comprobará que no haya Caja iniciada ni datos financieros previos. Requiere conexión y confirmación del servidor.</p><button class="btn btn-gold btn-full" onclick="historicaActivar()">${estado?'Continuar comprobación interrumpida':'Activar carga histórica explícitamente'}</button>`;
  } else if(estado.estado==='rechazada') {
    cuerpo='<p>Se detectaron datos financieros previos. La carga histórica quedó sin habilitar; los datos se conservaron. Se requiere revisión antes de cualquier conversión.</p>';
  } else if(estado.estado==='finalizada') {
    const corte=serializarHistorico(estado.corteOperativoAt);
    cuerpo=`<p><b>Carga finalizada de forma irreversible.</b></p><p>Corte operativo: ${esc(new Date(corte).toLocaleString('es-AR'))}.</p><p>Ahora abrí Caja con el dinero real disponible. La cartera histórica no se agrega al saldo inicial. Los próximos pagos y préstamos serán operaciones normales, aunque ingreses una fecha anterior.</p><button class="btn btn-gold btn-full" onclick="closeSheet();renderPage('caja')">Ir a Caja</button>`;
  } else {
    const prestamos=libro.prestamos.filter(p=>!p._deleted && ['Activo','Atrasado'].includes(p.estado));
    const lista=prestamos.map(p=>[p.id,`${p.id} · ${p.clienteNombre}`]);
    const registros=new Map(['prestamos','cuotas','pagos_cuota'].flatMap(s=>libro[s].map(d=>[`${s}/${d.id}`,d])));
    const revertidos=new Set(libro.carga_inicial_eventos.filter(e=>e.tipo==='reversion').map(e=>e.eventoOriginalId));
    const reversibles=libro.carga_inicial_eventos.filter(e=>e.formato===2 && e.tipo!=='reversion' && !revertidos.has(e.id) && e.registros.every(item=>registros.get(`${item.store}/${item.data.id}`)?.eventoHistoricoVigente===e.id)).sort((a,b)=>b.revision-a.revision);
    cuerpo=`<div class="form-alert is-info">CARGA HISTÓRICA ACTIVA · SIN MOVIMIENTOS DE CAJA<br>Registrá cada préstamo y sus pagos en orden cronológico. Conservá una referencia única por documento/operación; repetirla recupera lo confirmado.</div><p>${libro.prestamos.filter(p=>!p._deleted).length} préstamos · ${libro.cuotas.filter(q=>!q._deleted).length} cuotas · ${libro.pagos_cuota.filter(p=>!p._deleted).length} pagos. Los clientes se agregan desde Clientes y deben estar sincronizados.</p>
    <details><summary style="padding:12px;font-weight:800">1. Registrar préstamo histórico</summary>${input('hp-ref','Referencia original única (ej. PRESTAMO-001)')}${select('hp-cliente','Cliente existente',libro.clientes.filter(c=>!c._deleted).map(c=>[c.id,c.nombre]))}${planCampos('hp')}<button class="btn btn-gold btn-full" style="margin-top:12px" onclick="historicaGuardarPrestamo()">Confirmar préstamo histórico sin egreso</button></details>
    <details><summary style="padding:12px;font-weight:800">2. Registrar pago completo o parcial</summary>${input('hpay-ref','Referencia única del pago / recibo')}${select('hpay-prestamo','Préstamo',lista,'onchange="historicaActualizarCuotas()"')}${select('hpay-cuota','Cuota',[])}${input('hpay-fecha','Fecha real del pago','date')}${input('hpay-monto','Importe realmente cobrado','number','min="0.01" step="0.01"')}${select('hpay-medio','Medio original',medios)}<p>Para un pago completo ingresá el saldo de la cuota. Un préstamo cancelado por pagos queda Pagado al completar todas las cuotas.</p><button class="btn btn-gold btn-full" onclick="historicaGuardarPago()">Confirmar pago histórico sin ingreso</button></details>
    <details><summary style="padding:12px;font-weight:800">3. Registrar renovación anterior</summary>${input('hr-ref','Referencia única de la renovación')}${select('hr-origen','Préstamo anterior',lista)}${select('hr-modalidad','Tipo de renovación',[['refinanciacion_deuda_total','Refinanciar deuda pendiente'],['interes_cobrado_capital_renovado','Cobrar interés y renovar capital']])}${planCampos('hr')}${input('hr-entregado','Dinero adicional realmente entregado','number','min="0" step="0.01" value="0"')}${input('hr-interes','Interés realmente cobrado al renovar capital','number','min="0" step="0.01" value="0"')}${select('hr-medio','Medio del cobro de interés',medios)}<p>La compensación se obtiene de la deuda real del préstamo anterior. En refinanciación, cargá antes los pagos reales; el nominal debe igualar deuda pendiente más dinero entregado. Ningún importe modifica Caja.</p><button class="btn btn-gold btn-full" onclick="historicaGuardarRenovacion()">Confirmar renovación histórica</button></details>
    <details><summary style="padding:12px;font-weight:800">Anulación original sin cobros</summary>${select('han-prestamo','Préstamo',lista)}${input('han-ref','Referencia única de la anulación')}${input('han-fecha','Fecha original de anulación','date')}${input('han-notas','Motivo documentado')}<p>Solo para operaciones anuladas sin pagos. No equivale a cancelar una deuda mediante pagos ni a condonar capital.</p><button class="btn btn-ghost btn-full" onclick="historicaAnular()">Registrar anulación sin movimiento</button></details>
    <details><summary style="padding:12px;font-weight:800">Corregir un error antes del cierre</summary><p>Deshacé el último evento de la cadena y volvé a cargarlo con otra referencia. Se conserva la auditoría y no se modifica Caja. Una renovación deshecha recupera la deuda y los parciales anteriores. Si hay operaciones posteriores, deben deshacerse primero.</p>${select('hrev-evento','Evento a deshacer',reversibles.map(e=>[e.id,`${e.id} · ${e.tipo} · revisión ${e.revision}`]))}${input('hrev-motivo','Motivo documentado de la corrección','text','maxlength="1000"')}<button class="btn btn-ghost btn-full" onclick="historicaDeshacer()">Deshacer evento con confirmación remota</button></details>
    <div style="margin-top:18px"><button class="btn btn-ghost btn-full" onclick="historicaVerificar()">4. Verificar cartera e importes</button><div id="historica-informe"></div></div>`;
  }
  box.innerHTML=`<div class="sheet-hdr"><div class="sheet-title">Carga inicial de cartera histórica</div><button class="sheet-close" onclick="closeSheet()">✕</button></div><div style="padding:4px 12px 22px;line-height:1.6">${cuerpo}<button class="btn btn-ghost btn-full" style="margin-top:16px" onclick="openCargaHistorica()">Actualizar estado confirmado</button></div>`;
  if(estado?.estado==='activa') historicaActualizarCuotas();
}

export async function openCargaHistorica() {
  return accion('consultar',async()=>{
    const c=contexto();await pendientes(c);
    const snapshot=await window.cargaHistoricaService.snapshot(c);
    if(snapshot.estado) await replica(c,snapshot);
    mismaSesion(c);libro=snapshot;verificacion=null;
    let sheet=document.getElementById('sh-historica');
    if(!sheet) {sheet=document.createElement('div');sheet.id='sh-historica';sheet.className='sheet';sheet.innerHTML='<div class="sheet-box"></div>';document.body.appendChild(sheet);}
    render();window.openSheet('sh-historica');
  });
}
async function actualizar(c) {
  libro=await window.cargaHistoricaService.snapshot(c);await replica(c,libro);verificacion=null;render();
  await window.updateBadges?.();
}
export async function historicaActivar() {
  return accion('activar',async()=>{
    const c=contexto();await pendientes(c,!libro?.estado);
    if(!confirm('¿Activar la carga inicial histórica en esta cuenta? Los clientes se conservarán. Caja permanecerá bloqueada hasta verificar y finalizar la carga.')) return;
    await window.cargaHistoricaService.activar(c,globalThis.crypto.randomUUID());
    await actualizar(c);window.toast('Carga histórica confirmada por el servidor');
  });
}
export function historicaPrepararPlan(prefijo) {
  try {
    const datos=solicitudPlan(prefijo);delete datos.plan;
    const cliente=libro.clientes.find(c=>c.id===(prefijo==='hp'?valor('hp-cliente'):libro.prestamos.find(p=>p.id===valor('hr-origen'))?.clienteId));
    if(!cliente) throw new Error('Seleccioná un cliente o préstamo válido.');
    const plan=window.cargaHistoricaService.plan(datos,cliente,'PREVIEW',new Date().toISOString());
    document.getElementById(prefijo+'-plan').innerHTML=`<p>Total: ${dinero(plan.prestamo.total)}. Ajustá cada vencimiento e importe al documento original.</p>`+plan.cuotas.map(q=>`<div class="form-grid form-grid-2" data-cuota><label class="lbl">Cuota ${q.nro}<input class="inp" data-fecha type="date" value="${q.fechaVenc.slice(0,10)}"></label><label class="lbl">Importe<input class="inp" data-monto type="number" min="0.01" step="0.01" value="${q.monto}"></label></div>`).join('');
  } catch(e) {window.toast('⚠️ '+e.message);}
}
async function registrar(solicitud) {
  const c=contexto();await pendientes(c);
  await window.cargaHistoricaService.ejecutar(c,solicitud);
  await actualizar(c);window.toast('Operación histórica confirmada · Caja sin movimientos');
}
export async function historicaGuardarPrestamo() {return accion('prestamo',()=>registrar({tipo:'prestamo',referencia:valor('hp-ref'),clienteId:valor('hp-cliente'),...solicitudPlan('hp')}));}
export async function historicaGuardarPago() {return accion('pago',()=>registrar({tipo:'pago',referencia:valor('hpay-ref'),prestamoId:valor('hpay-prestamo'),cuotaId:valor('hpay-cuota'),fecha:valor('hpay-fecha'),monto:Number(valor('hpay-monto')),medioPago:valor('hpay-medio')}));}
export async function historicaGuardarRenovacion() {return accion('renovacion',()=>registrar({tipo:'renovacion',referencia:valor('hr-ref'),prestamoId:valor('hr-origen'),modalidad:valor('hr-modalidad'),...solicitudPlan('hr'),montoEntregado:Number(valor('hr-entregado')),interesRecibido:Number(valor('hr-interes')),medioPago:valor('hr-medio')}));}
export async function historicaAnular() {return accion('anulacion',async()=>{if(confirm('¿Registrar la anulación original sin cobros? No se permite si hubo pagos.'))await registrar({tipo:'anulacion',referencia:valor('han-ref'),prestamoId:valor('han-prestamo'),fecha:valor('han-fecha'),notas:valor('han-notas')});});}
export async function historicaDeshacer() {
  return accion('deshacer',async()=>{
    const eventoId=valor('hrev-evento'),motivo=valor('hrev-motivo');
    if(!eventoId||!motivo)throw new Error('Seleccioná el evento e indicá el motivo documentado.');
    if(!confirm(`¿Deshacer ${eventoId}? Se recuperará su estado anterior y se conservará el evento original. No se modificará Caja.`))return;
    const c=contexto();await pendientes(c);
    await window.cargaHistoricaService.deshacer(c,eventoId,motivo);
    await actualizar(c);window.toast('Corrección histórica confirmada por el servidor · Caja sin movimientos');
  });
}
export async function guardarNotasPrestamoHistorico(prestamo,notas) {
  const c=contexto();await pendientes(c);
  const key=JSON.stringify([c.uid,prestamo.id,notas]);
  if(!referenciasNotas.has(key))referenciasNotas.set(key,'NOTA-'+globalThis.crypto.randomUUID());
  await window.cargaHistoricaService.guardarNotas(c,prestamo.id,notas,referenciasNotas.get(key));
  try {
    const snapshot=await window.cargaHistoricaService.snapshot(c);await replica(c,snapshot);
  } catch(e) {
    throw new Error('Notas confirmadas en el servidor, pero no se pudo recuperar la réplica local. Conservá los datos y volvé a consultar con conexión. '+e.message);
  }
  referenciasNotas.delete(key);
}
export function historicaActualizarCuotas() {
  const selectEl=document.getElementById('hpay-cuota');if(!selectEl)return;
  selectEl.innerHTML=opciones((libro?.cuotas||[]).filter(q=>!q._deleted&&q.prestamoId===valor('hpay-prestamo')&&!['Pagado','Cancelada'].includes(q.estado)).map(q=>[q.id,`Cuota ${q.nro} · saldo ${dinero(q.saldoPendiente)}`]));
}
export async function historicaVerificar() {
  return accion('verificar',async()=>{
    const c=contexto();await pendientes(c);
    const informe=await window.cargaHistoricaService.verificar(c);mismaSesion(c);verificacion=informe;
    const m=informe.metricas;
    document.getElementById('historica-informe').innerHTML=`<div class="card" style="margin-top:12px"><b>Verificación correcta · revisión ${informe.revision}</b><p>${informe.prestamos} préstamos · ${informe.cuotas} cuotas · ${informe.pagos} pagos</p><p>Capital pendiente: ${dinero(m.capitalPendiente)}<br>Interés pendiente: ${dinero(m.interesPendiente)}<br>Capital recuperado histórico: ${dinero(m.capitalRecuperado)}<br>Interés cobrado histórico: ${dinero(m.interesCobrado)}<br>Deuda compensada en renovaciones: ${dinero(m.totalCompensadoRenovaciones)}</p><p>Revisá además la documentación original, clientes y fechas. El cierre es irreversible y fija fecha y hora del servidor. Después abrí Caja con el dinero real disponible.</p>${input('historica-confirmacion','Escribí FINALIZAR para confirmar')}<button class="btn btn-gold btn-full" onclick="historicaFinalizar()">5. Finalizar carga y establecer corte</button></div>`;
  });
}
export async function historicaFinalizar() {
  return accion('finalizar',async()=>{
    if(!verificacion || valor('historica-confirmacion')!=='FINALIZAR')throw new Error('Verificá la cartera y escribí FINALIZAR.');
    const c=contexto();await pendientes(c);
    await window.cargaHistoricaService.finalizar(c,verificacion.revision);
    await actualizar(c);window.toast('Carga finalizada. Corte confirmado por el servidor.');
  });
}

export async function validarOperacionFinancieraNormal() {
  let estado=await window.getConfig('cargaHistoricaRemotaV1');
  if(navigator.onLine && window._fbUser?.uid && window._fbDb) {
    const c=contexto();estado=await window.cargaHistoricaService.leer(c);mismaSesion(c);
    await window.setConfig('cargaHistoricaRemotaV1',serializarHistorico(estado));
  }
  if(['preparando','activa'].includes(estado?.estado))throw new Error('Usá Carga histórica para las operaciones anteriores. Primero verificá y finalizá la carga para operar normalmente.');
  if(estado?.estado==='finalizada' && !window.cajaService.esCajaIniciada(await window.dbAll('movimientos_caja')))throw new Error('La carga finalizó. Abrí Caja con el saldo real disponible antes de registrar operaciones normales.');
}
export async function validarRespaldoHistorico(data) {const c=contexto();await window.cargaHistoricaService.validarRespaldo(c,data);mismaSesion(c);}
export async function validarMantenimientoHistorico() {
  const c=contexto(),estado=await window.cargaHistoricaService.leer(c);mismaSesion(c);
  if(estado && estado.estado!=='rechazada')throw new Error('Esta cuenta conserva una carga histórica auditada. No se permite borrarla ni reiniciarla mediante mantenimiento general.');
}
export async function bloquearFinanzasDuranteCargaHistorica() {
  try {await validarOperacionFinancieraNormal();return false;}
  catch(e) {window.toast('⚠️ '+e.message);return true;}
}
export async function validarEliminacionClienteHistorico(id) {
  if(navigator.onLine) {
    const c=contexto(),vinculo=await c.db.collection('users').doc(c.uid).collection('carga_inicial_clientes').doc(id).get({source:'server'});mismaSesion(c);
    if(vinculo.exists)throw new Error('El cliente está vinculado a una carga histórica auditada y no puede eliminarse.');
  } else {
    const estado=await window.getConfig('cargaHistoricaRemotaV1');
    if(estado && estado.estado!=='rechazada')throw new Error('Conectate para verificar los vínculos históricos antes de eliminar un cliente.');
  }
}
export async function prepararBackupHistorico(data) {
  if(!navigator.onLine) {
    const estado=await window.getConfig('cargaHistoricaRemotaV1');
    if(estado || (data.prestamos||[]).some(p=>p.cargaInicial))throw new Error('Conectate para incluir la autoridad y auditoría históricas confirmadas en el respaldo.');
    return data;
  }
  const c=contexto(),snapshot=await window.cargaHistoricaService.snapshot(c);mismaSesion(c);
  if(!snapshot.estado || snapshot.estado.estado==='rechazada')return data;
  return {...data,v:7,usuario:{...data.usuario,uid:c.uid},prestamos:snapshot.prestamos,cuotas:snapshot.cuotas,pagosCuota:snapshot.pagos_cuota,prendas:snapshot.prendas,movimientosCaja:snapshot.movimientos_caja,cargaHistorica:serializarHistorico({estado:snapshot.estado,eventos:snapshot.carga_inicial_eventos})};
}
