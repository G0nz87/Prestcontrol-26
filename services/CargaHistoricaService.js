import { saldoCobrableCuota } from '../core/helpers.js';

export const HISTORICA_STORES = ['prestamos', 'cuotas', 'pagos_cuota', 'prendas', 'movimientos_caja'];
const CLAVES_BACKUP = { prestamos:'prestamos', cuotas:'cuotas', pagos_cuota:'pagosCuota', prendas:'prendas', movimientos_caja:'movimientosCaja' };
const medios = ['Efectivo', 'Transferencia', 'MercadoPago', 'Otro'];
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const error = mensaje => { throw new Error(mensaje); };
const referencia = valor => {
  const ref = String(valor || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,47}$/.test(ref)) error('Ingresá una referencia única de 1 a 48 letras, números, guiones o guiones bajos.');
  return ref;
};
const fechaISO = valor => {
  const texto = String(valor || '');
  const fecha = new Date(/^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto + 'T12:00:00' : texto);
  if (!texto || !Number.isFinite(fecha.getTime()) || fecha.getTime() > Date.now()) error('La fecha histórica debe ser válida y no futura.');
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto) && `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}` !== texto) error('La fecha histórica no existe.');
  return fecha.toISOString();
};
export function serializarHistorico(valor) {
  if (valor?.toDate instanceof Function) return valor.toDate().toISOString();
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map(serializarHistorico);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map(k => [k, serializarHistorico(valor[k])]));
  if (typeof valor === 'number' && !Number.isFinite(valor)) error('No se admiten importes no finitos.');
  if (valor === undefined) error('La operación contiene un campo sin valor.');
  return valor;
}
const firma = valor => JSON.stringify(serializarHistorico(valor));
const economico = dato => Object.fromEntries(Object.entries(dato).filter(([k]) => !['updatedAt','_restoreAuthority','userId'].includes(k)));
const clave = (store,id) => `${store}__${id}`;

// Todas las decisiones económicas son remotas; IndexedDB es solamente réplica.
export class CargaHistoricaService {
  constructor(prestamos, metricas) { this.prestamos = prestamos; this.metricas = metricas; }

  contexto({ db, uid, serverTimestamp }) {
    if (!uid || !db?.runTransaction || !serverTimestamp) error('Se requiere sesión y conexión para la carga histórica.');
    const user = db.collection('users').doc(uid);
    return { db, uid, serverTimestamp, user, estado:user.collection('carga_inicial').doc('estado'), apertura:user.collection('control_caja').doc('apertura_GENERAL') };
  }

  async leer(contexto) {
    const c = this.contexto(contexto), snap = await c.estado.get({ source:'server' });
    return snap.exists ? snap.data() : null;
  }

  async transaccion(c, ejecutar) {
    // Las reglas pueden rechazar una revisión obsoleta antes de que el SDK
    // reciba ABORTED. Reintentar solo si el servidor prueba un cambio de estado;
    // nunca transformar un rechazo de permisos estable en una escritura libre.
    for (let intento=0;intento<4;intento++) {
      let observado;
      try {
        return await c.db.runTransaction(async tx=>{
          const snap=await tx.get(c.estado);
          observado=snap.exists?snap.data():null;
          return ejecutar(tx);
        });
      } catch(e) {
        if(e.code!=='permission-denied'||intento===3)throw e;
        const actual=await this.leer(c);
        if(firma(actual)===firma(observado))throw e;
      }
    }
  }

  async coleccion(c, store) {
    const snap = await c.user.collection(store).get({ source:'server' });
    return snap.docs.map(doc => {
      const data = doc.data();
      if (data.id && data.id !== doc.id) error(`Identificador inconsistente en ${store}/${doc.id}.`);
      return { ...data, id:doc.id };
    });
  }

  async activar(contexto, sesionId) {
    const c = this.contexto(contexto);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(sesionId || '')) error('Identificador de sesión inválido.');
    const previo = await this.leer(contexto);
    if (!previo) {
      // Preflight informativo. La barrera seguida de la segunda consulta cierra la carrera.
      const snapshots = await Promise.all(HISTORICA_STORES.map(s => c.user.collection(s).limit(1).get({source:'server'})));
      if (snapshots.some(s => !s.empty)) error('La cuenta ya contiene datos financieros. No se habilitó ni convirtió la carga histórica.');
    }
    await this.transaccion(c, async tx => {
      const [estado, apertura, cuenta] = await Promise.all([tx.get(c.estado),tx.get(c.apertura),tx.get(c.user)]);
      if (apertura.exists) error('Caja ya tiene una apertura confirmada. No se habilita carga histórica.');
      if (cuenta.data()?.prestcontrolDataReset?.status && cuenta.data().prestcontrolDataReset.status !== 'completed') error('Hay un reset incompleto. Se requiere revisión.');
      if (estado.exists) {
        if (!['preparando','activa'].includes(estado.data().estado)) error('La carga no puede activarse ni reabrirse en esta cuenta.');
        return;
      }
      tx.set(c.estado, { version:1, userId:c.uid, sesionId, estado:'preparando', revision:0, creadaAt:c.serverTimestamp(), actualizadaAt:c.serverTimestamp() });
    });
    const actual = await this.leer(contexto);
    if (actual.estado === 'activa') return actual;
    const snapshots = await Promise.all(HISTORICA_STORES.map(s => c.user.collection(s).limit(1).get({source:'server'})));
    const ocupada = snapshots.some(s => !s.empty);
    await this.transaccion(c, async tx => {
      const s = await tx.get(c.estado);
      if (s.data()?.estado !== 'preparando') return;
      tx.update(c.estado, { estado:ocupada ? 'rechazada' : 'activa', actualizadaAt:c.serverTimestamp() });
    });
    const confirmada = await this.leer(contexto);
    if (confirmada.estado !== 'activa') error('Se detectaron datos financieros previos al activar. Se conservaron íntegros; la carga no se habilitó.');
    return confirmada;
  }

  plan(datos, cliente, ref, now) {
    const monto = r2(datos.monto), tasa = Number(datos.interesPorCuota), n = Number(datos.nCuotas);
    if (!Number.isFinite(monto) || !Number.isFinite(tasa) || !Number.isInteger(n) || n < 1 || n > 120 || !['Semanal','Mensual'].includes(datos.periodo)) error('Revisá capital, interés, período y cuotas (entre 1 y 120).');
    const fecha = fechaISO(datos.fecha);
    this.prestamos.validarDatosPrestamo({ clienteId:cliente.id, monto, tasaPorCuota:tasa, nCuotas:n, fecha });
    const calculado = this.prestamos.calcularPlanPagos(monto,tasa,n);
    const total = datos.totalOriginal == null || datos.totalOriginal === '' ? calculado.total : r2(datos.totalOriginal);
    if (!Number.isFinite(total) || total < monto || total > 1e12) error('El total contractual debe ser finito, no menor que el capital y no superar el límite de precisión.');
    const id = `PH-${ref}`, ids = Array.from({length:n},(_,i)=>`CH-${ref}-${String(i+1).padStart(3,'0')}`);
    const cuotasBase = this.prestamos.generarCuotas({ prestamoId:id, clienteId:cliente.id, clienteNombre:cliente.nombre, fechaInicio:new Date(fecha), tipo:datos.periodo, nCuotas:n, cuotaMonto:r2(total/n), primerNumeroId:1, nowISO:now });
    if (datos.plan && (!Array.isArray(datos.plan) || datos.plan.length !== n)) error('El plan original debe contener exactamente todas las cuotas.');
    const cuotas = cuotasBase.map((q,i) => {
      const original = datos.plan?.[i];
      const venc = original ? new Date(original.fechaVenc) : new Date(q.fechaVenc);
      const importe = original ? r2(original.monto) : (i === n-1 ? r2(total-r2(total/n)*(n-1)) : r2(total/n));
      if (!Number.isFinite(venc.getTime()) || venc < new Date(fecha) || !Number.isFinite(importe) || importe <= 0) error('Cuota original inválida: verificá importe y vencimiento posterior al préstamo.');
      return {...q,id:ids[i],fechaVenc:venc.toISOString(),monto:importe,saldoPendiente:importe,estado:venc.getTime()<new Date(now).setHours(0,0,0,0)?'Atrasado':'Pendiente'};
    });
    if (Math.abs(r2(cuotas.reduce((s,q)=>s+q.monto,0))-total)>0.009) error('La suma del plan original no coincide con el total contractual.');
    const totalManual=datos.totalOriginal != null && datos.totalOriginal !== '';
    const prestamo = { id, clienteId:cliente.id, clienteNombre:cliente.nombre, fecha, monto, total, ganancia:r2(total-monto), interes:totalManual?(total-monto)/monto:calculado.interesTotal, interesPorCuota:totalManual?((total-monto)/monto)*100/n:tasa, tipo:datos.periodo, nCuotas:n, cuota:r2(total/n), cuotasIds:ids, estado:cuotas.some(q=>q.estado==='Atrasado')?'Atrasado':'Activo', notas:String(datos.notas||''), prenda:'', creadoEn:now, updatedAt:now };
    return { prestamo, cuotas };
  }

  async ejecutar(contexto, solicitud) {
    const reversion = solicitud.tipo === 'reversion';
    if(reversion && !/^H-[A-Z0-9][A-Z0-9_-]{0,47}$/.test(solicitud.eventoId||'')) error('Seleccioná un evento histórico original válido. No se deshace una corrección.');
    if(reversion && (!String(solicitud.motivo||'').trim() || String(solicitud.motivo).length>1000)) error('Indicá el motivo documentado de la corrección (hasta 1000 caracteres).');
    const c = this.contexto(contexto), ref = reversion?solicitud.eventoId:referencia(solicitud.referencia), opId = reversion?`R-${ref}`:`H-${ref}`;
    const request = reversion?{tipo:'reversion',eventoId:ref,motivo:String(solicitud.motivo).trim()}:{...solicitud,referencia:ref};
    const solicitudJson = firma(request);
    if (solicitudJson.length > 150000) error('La operación excede el tamaño permitido.');
    const eventoRef = c.user.collection('carga_inicial_eventos').doc(opId);
    await this.transaccion(c, async tx => {
      const [s,e,a,u] = await Promise.all([tx.get(c.estado),tx.get(eventoRef),tx.get(c.apertura),tx.get(c.user)]);
      if (e.exists) {
        if (e.data().solicitudJson !== solicitudJson) error('La referencia ya fue utilizada con otros datos. No se duplicó ni sobrescribió la operación.');
        return;
      }
      const estado = s.data();
      if (estado?.estado !== 'activa' || a.exists) error('La carga histórica no está activa o ya fue finalizada.');
      if (u.data()?.prestcontrolDataReset?.status && u.data().prestcontrolDataReset.status !== 'completed') error('Hay un reset incompleto.');
      const cache = new Map();
      const leer = async (store,id) => {
        if (!id || String(id).includes('/')) error('Referencia de registro inválida.');
        const key = `${store}/${id}`;
        if (!cache.has(key)) {
          const snap = await tx.get(c.user.collection(store).doc(id));
          cache.set(key,snap.exists?{...snap.data(),id:snap.id}:null);
        }
        return cache.get(key);
      };
      const now = new Date().toISOString();
      const original = reversion?(await tx.get(c.user.collection('carga_inicial_eventos').doc(ref))).data():null;
      const fecha = reversion?fechaISO(serializarHistorico(original?.fechaEconomica)):fechaISO(request.fecha);
      const registros = reversion?await this.construirReversion(original,opId,leer,estado):await this.construir(request,ref,fecha,now,leer,estado);
      const marcados = registros.map(({store,data}) => ({store,data:{...data,cargaInicial:data.cargaInicial||{version:1,sesionId:estado.sesionId,userId:c.uid,fechaRegistro:now,referencia:ref},eventoHistoricoVigente:reversion?(data.eventoHistoricoVigente??null):opId,ultimaOperacionHistorica:opId,userId:c.uid,updatedAt:now}}));
      const anterioresPorClave={},registrosPorClave={};
      for (const item of marcados) {
        if (!['prestamos','cuotas','pagos_cuota'].includes(item.store)) error('No se permite crear movimientos de Caja históricos.');
        anterioresPorClave[clave(item.store,item.data.id)]=await leer(item.store,item.data.id); // Todos los reads preceden a cualquier write.
        registrosPorClave[clave(item.store,item.data.id)]=item.data;
      }
      const vinculos=[];
      for(const clienteId of new Set(marcados.map(item=>item.data.clienteId))) {
        const vinculoRef=c.user.collection('carga_inicial_clientes').doc(clienteId);
        const vinculo=await tx.get(vinculoRef);
        if(vinculo.exists && vinculo.data().sesionId!==estado.sesionId)error('El cliente está vinculado a otra carga. Se requiere revisión.');
        if(!vinculo.exists)vinculos.push({ref:vinculoRef,data:{clienteId,userId:c.uid,sesionId:estado.sesionId,eventoId:opId,creadoAt:c.serverTimestamp()}});
      }
      const revision = estado.revision+1;
      const evento = {id:opId,version:1,formato:2,userId:c.uid,sesionId:estado.sesionId,revision,tipo:request.tipo,solicitudJson,fechaEconomica:new Date(fecha),confirmadaAt:c.serverTimestamp(),registros:marcados,anterioresPorClave,registrosPorClave,...(reversion?{eventoOriginalId:ref,motivo:request.motivo}:{})};
      if(new TextEncoder().encode(firma(evento)).byteLength>850000)error('El evento excede el tamaño seguro de auditoría. No se guardó parcialmente; se requiere revisar el plan.');
      for (const item of marcados) tx.set(c.user.collection(item.store).doc(item.data.id),item.data);
      for (const vinculo of vinculos) tx.set(vinculo.ref,vinculo.data);
      tx.set(eventoRef,evento);
      tx.update(c.estado,{revision,ultimaOperacion:opId,actualizadaAt:c.serverTimestamp()});
    });
    // Recuperar también el caso commit remoto exitoso + respuesta/local fallidos.
    const evento = (await eventoRef.get({source:'server'})).data();
    const registros = await Promise.all(evento.registros.map(async item => {
      const doc = await c.user.collection(item.store).doc(item.data.id).get({source:'server'});
      if (!doc.exists) error('Falta un registro confirmado. Se requiere revisión.');
      return {store:item.store,data:{...doc.data(),id:doc.id}};
    }));
    return {estado:await this.leer(contexto),evento,registros};
  }

  async construirReversion(original,opId,leer,estado) {
    if(!original || original.sesionId!==estado.sesionId || original.formato!==2 || !original.anterioresPorClave || !original.registrosPorClave || original.tipo==='reversion') error('El evento no admite reversión automática. Se requiere auditoría de su formato original.');
    const registros=[];
    await Promise.all(original.registros.map(item=>leer(item.store,item.data.id)));
    for(const item of original.registros) {
      const key=clave(item.store,item.data.id),actual=await leer(item.store,item.data.id),anterior=original.anterioresPorClave[key];
      if(!actual || actual.eventoHistoricoVigente!==original.id || actual._deleted || anterior===undefined)error('Hay operaciones posteriores incompatibles en esta cadena. Deshacelas primero en orden inverso; no se modificó ningún registro.');
      // La proyección debe seguir siendo la original, aun tras deshacer eventos posteriores.
      const sinMarca=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!['updatedAt','ultimaOperacionHistorica'].includes(k)));
      if(firma(sinMarca(actual))!==firma(sinMarca(item.data)))error('La proyección del evento cambió. Se requiere revisión antes de corregir.');
      registros.push({store:item.store,data:anterior?{...anterior}:{...actual,_deleted:true,revertidoPor:opId,eventoHistoricoVigente:null}});
    }
    return registros;
  }

  async deshacer(contexto,eventoId,motivo) {
    return this.ejecutar(contexto,{tipo:'reversion',eventoId,motivo});
  }

  async guardarNotas(contexto,id,notas,ref) {
    const c=this.contexto(contexto),estado=await this.leer(contexto);
    if(typeof notas!=='string'||notas.length>10000)error('Notas inválidas (hasta 10000 caracteres).');
    if(estado?.estado==='activa') {
      const p=(await c.user.collection('prestamos').doc(id).get({source:'server'})).data();
      return this.ejecutar(contexto,{tipo:'notas',referencia:ref,prestamoId:id,notas,fecha:p?.fecha});
    }
    await c.db.runTransaction(async tx=>{
      const [s,p,a]=await Promise.all([tx.get(c.estado),tx.get(c.user.collection('prestamos').doc(id)),tx.get(c.apertura)]);
      if(s.data()?.estado!=='finalizada'||!a.exists||!p.exists||p.data()._deleted||!p.data().cargaInicial)error('Las notas requieren carga activa o carga finalizada con Caja confirmada.');
      // Actualizar solo notas sobre el documento remoto: nunca publicar una copia local vieja.
      tx.update(p.ref,{notas,updatedAt:new Date().toISOString()});
    });
    return {estado:await this.leer(contexto)};
  }

  async construir(d,ref,fecha,now,leer,estado) {
    const registros = [], agregar = (store,data) => registros.push({store,data});
    const validarOrigen = p => {
      if (!p || p._deleted || p.cargaInicial?.sesionId !== estado.sesionId || !['Activo','Atrasado'].includes(p.estado)) error('El préstamo histórico no está disponible para esta operación.');
      if (new Date(fecha)<new Date(p.fecha)) error('La operación no puede ser anterior al préstamo.');
    };
    if (d.tipo === 'prestamo') {
      const cliente = await leer('clientes',d.clienteId);
      if (!cliente || cliente._deleted) error('El cliente debe existir y estar sincronizado.');
      const plan = this.plan(d,cliente,ref,now);
      const items=[{store:'prestamos',data:plan.prestamo},...plan.cuotas.map(data=>({store:'cuotas',data}))];
      if((await Promise.all(items.map(item=>leer(item.store,item.data.id)))).some(Boolean))error('El identificador histórico ya está ocupado.');
      registros.push(...items);
      return registros;
    }
    const p = await leer('prestamos',d.prestamoId);
    if(d.tipo==='notas') {
      if(!p || p._deleted || p.cargaInicial?.sesionId!==estado.sesionId)error('El préstamo histórico no está disponible.');
      if(String(d.notas||'').length>10000)error('Las notas exceden el tamaño permitido.');
      agregar('prestamos',{...p,notas:String(d.notas||'')});return registros;
    }
    validarOrigen(p);
    if (!Array.isArray(p.cuotasIds) || p.cuotasIds.length !== p.nCuotas) error('El plan histórico es inconsistente.');
    const cuotas = await Promise.all(p.cuotasIds.map(id=>leer('cuotas',id)));
    if (cuotas.some(q=>!q||q._deleted||q.prestamoId!==p.id)) error('Faltan cuotas del préstamo.');
    if (cuotas.some(q=>q.ultimaFechaPagoHistorico && new Date(q.ultimaFechaPagoHistorico)>new Date(fecha))) error('Registrá las operaciones de cada préstamo en orden cronológico.');
    if (d.tipo === 'pago') {
      const q = cuotas.find(q=>q.id===d.cuotaId), monto=r2(d.monto);
      if (!q || !this.prestamos.validarPagoCobrable(p,q).ok || !Number.isFinite(monto) || monto<=0 || monto-saldoCobrableCuota(q)>0.009 || !medios.includes(d.medioPago)) error('Pago inválido: revisá cuota, importe, saldo y medio.');
      const total=r2(Number(q.totalAbonado||0)+monto),saldo=r2(q.monto-total),numero=Number(q.cantidadAbonos||0)+1,id=`HH-${ref}`;
      if (await leer('pagos_cuota',id)) error('El pago histórico ya existe.');
      const nueva={...q,estado:saldo<=0.009?'Pagado':'Parcial',totalAbonado:total,saldoPendiente:Math.max(0,saldo),cantidadAbonos:numero,ultimoPagoId:id,ultimaFechaPagoHistorico:fecha,fechaPago:saldo<=0.009?fecha:null,metodo:d.medioPago,origenPago:'abono_cuota',montoEfectivo:total,montoCompensado:0};
      agregar('cuotas',nueva);
      agregar('pagos_cuota',{id,pagoId:id,cuotaId:q.id,prestamoId:p.id,clienteId:p.clienteId,tipo:'ABONO_CUOTA',numeroAbono:numero,monto,fechaPago:fecha,medioPago:d.medioPago,saldoAntes:r2(saldoCobrableCuota(q)),saldoDespues:Math.max(0,saldo),totalAbonadoAntes:Number(q.totalAbonado||0),totalAbonadoDespues:total,esPagoFinal:saldo<=0.009,createdAt:now,_deleted:false});
      const proyectadas=cuotas.map(item=>item.id===q.id?nueva:item);
      let estadoPrestamo=this.prestamos.calcularEstado(proyectadas);
      if(estadoPrestamo!=='Pagado' && proyectadas.some(item=>saldoCobrableCuota(item)>0 && new Date(item.fechaVenc).getTime()<new Date(now).setHours(0,0,0,0)))estadoPrestamo='Atrasado';
      agregar('prestamos',{...p,estado:estadoPrestamo});
      return registros;
    }
    const pendientes = cuotas.filter(q=>this.prestamos.validarPagoCobrable(p,q).ok && saldoCobrableCuota(q)>0);
    if (!pendientes.length) error('El préstamo no tiene deuda pendiente.');
    if (d.tipo === 'anulacion') {
      if(p.origen==='renovacion' || p.prestamoOrigenId || p.prestamoRenovacionId || p.cerradoPor)error('No se puede anular una parte de una cadena de renovación. Usá Deshacer último evento para recuperar la deuda original, antes del cierre.');
      if (cuotas.some(q=>Number(q.totalAbonado||0)>0)) error('No se anula un préstamo con cobros. Para cancelación por pago, registrá los pagos reales.');
      agregar('prestamos',{...p,estado:'Cancelado',fechaCancelacion:fecha,motivoCancelacion:String(d.notas||'Anulación histórica sin cobros')});
      pendientes.forEach(q=>agregar('cuotas',{...q,estado:'Cancelada',saldoPendiente:0}));
      return registros;
    }
    if (d.tipo !== 'renovacion') error('Tipo de operación histórica no reconocido.');
    const deuda=r2(pendientes.reduce((s,q)=>s+saldoCobrableCuota(q),0));
    const capitalSolo=d.modalidad==='interes_cobrado_capital_renovado';
    if (!capitalSolo && d.modalidad!=='refinanciacion_deuda_total') error('Seleccioná el tipo de renovación.');
    const nominal=r2(d.monto), entregado=r2(d.montoEntregado||0),interesRecibido=r2(d.interesRecibido||0);
    const compensado=capitalSolo?r2(p.montoNominal??p.monto):deuda;
    if (!Number.isFinite(entregado)||entregado<0||Math.abs(nominal-compensado-entregado)>0.009) error('Nominal, deuda compensada y dinero realmente entregado no coinciden.');
    if (!capitalSolo && interesRecibido!==0) error('En refinanciación de deuda, registrá primero los cobros anteriores como pagos históricos.');
    if (capitalSolo && (pendientes.length!==1 || Number(pendientes[0].totalAbonado||0)>0 || entregado!==0 || !(interesRecibido>0) || Math.abs(deuda-compensado-interesRecibido)>0.009 || !medios.includes(d.medioPago))) error('La renovación de capital requiere una cuota sin parciales e interés real exactamente separado del capital.');
    const cliente=await leer('clientes',p.clienteId);
    if (!cliente || cliente._deleted) error('El cliente no está disponible.');
    const plan=this.plan(d,cliente,ref,now),id=plan.prestamo.id;
    if((await Promise.all([{store:'prestamos',data:plan.prestamo},...plan.cuotas.map(data=>({store:'cuotas',data}))].map(item=>leer(item.store,item.data.id)))).some(Boolean))error('El préstamo de renovación ya existe.');
    agregar('prestamos',{...plan.prestamo,origen:'renovacion',renovacionTipo:d.modalidad,prestamoOrigenId:p.id,montoNominal:nominal,montoCompensado:compensado,montoEntregado:entregado,montoInteresCobradoRenovacion:interesRecibido,montoAbonadoPrevioRenovacion:r2(pendientes.reduce((s,q)=>s+Number(q.totalAbonado||0),0)),cuotasCompensadas:pendientes.map(q=>q.id)});
    plan.cuotas.forEach(q=>agregar('cuotas',q));
    agregar('prestamos',{...p,estado:'Pagado',cerradoPor:capitalSolo?'renovacion_capital':'renovacion',prestamoRenovacionId:id,renovadoEn:fecha});
    pendientes.forEach(q=>agregar('cuotas',{...q,estado:'Pagado',fechaPago:fecha,metodo:capitalSolo?d.medioPago:'Renovación',origenPago:capitalSolo?'interes_cobrado_renovacion_capital':'renovacion_descuento',montoEfectivo:capitalSolo?interesRecibido:Number(q.totalAbonado||0),montoCompensado:capitalSolo?compensado:r2(saldoCobrableCuota(q)),montoCompensadoRenovacion:capitalSolo?compensado:r2(saldoCobrableCuota(q)),saldoPendienteAlRenovar:r2(saldoCobrableCuota(q)),totalAbonadoAlRenovar:Number(q.totalAbonado||0),totalAbonado:capitalSolo?interesRecibido:Number(q.totalAbonado||0),saldoPendiente:0,cerradoPor:capitalSolo?'renovacion_capital':'renovacion',prestamoRenovacionId:id,ultimaFechaPagoHistorico:fecha,...(capitalSolo?{capitalCobradoReal:0,interesCobradoReal:interesRecibido}:{})}));
    return registros;
  }

  async snapshot(contexto) {
    const c=this.contexto(contexto);
    for(let i=0;i<3;i++) {
      const antes=await this.leer(contexto);
      const stores=['clientes',...HISTORICA_STORES,'carga_inicial_eventos'];
      const arrays=await Promise.all(stores.map(s=>this.coleccion(c,s)));
      const despues=await this.leer(contexto);
      if (firma(antes)===firma(despues)) {
        // Después del corte las operaciones normales no incrementan la revisión
        // histórica: detectar actividad financiera entre lecturas del respaldo.
        if(despues?.estado==='finalizada') {
          const segunda=await Promise.all(HISTORICA_STORES.map(s=>this.coleccion(c,s)));
          if(HISTORICA_STORES.some((s,i)=>firma(arrays[stores.indexOf(s)])!==firma(segunda[i])))continue;
        }
        return {estado:despues,...Object.fromEntries(stores.map((s,i)=>[s,arrays[i]]))};
      }
    }
    error('La cartera cambió durante la lectura. Reintentá cuando terminen las otras operaciones.');
  }

  verificarLibro(libro) {
    const {estado}=libro;
    if (estado?.estado!=='activa') error('La verificación de cierre requiere una carga activa.');
    if (libro.movimientos_caja.length || libro.prendas.length) error('Hay movimientos de Caja o garantías ajenos a esta carga. Se requiere revisión.');
    const eventos=[...libro.carga_inicial_eventos].sort((a,b)=>a.revision-b.revision),esperados=new Map();
    if (eventos.length!==estado.revision) error('La auditoría histórica está incompleta.');
    const porEvento=new Map(),revertidos=new Set();
    eventos.forEach((e,i)=>{
      if(e.revision!==i+1 || e.sesionId!==estado.sesionId) error('La secuencia histórica es inconsistente.');
      if(e.formato===2) {
        if(!e.registros.length || Object.keys(e.registrosPorClave||{}).length!==e.registros.length || Object.keys(e.anterioresPorClave||{}).length!==e.registros.length)error('Las imágenes de auditoría están incompletas.');
        const original=e.tipo==='reversion'?porEvento.get(e.eventoOriginalId):null;
        if(e.tipo==='reversion' && (!original || original.tipo==='reversion' || revertidos.has(original.id) || e.id!==`R-${original.id}` || e.registros.length!==original.registros.length))error('La corrección histórica es inconsistente o duplicada.');
        e.registros.forEach(item=>{
          const key=clave(item.store,item.data.id),anterior=esperados.get(`${item.store}/${item.data.id}`)||null;
          if(firma(anterior)!==firma(e.anterioresPorClave[key]) || firma(item.data)!==firma(e.registrosPorClave[key]))error('Las imágenes históricas no coinciden con su secuencia.');
          if(original) {
            const previo=original.anterioresPorClave[key];
            if(!anterior || anterior.eventoHistoricoVigente!==original.id || previo===undefined)error('Se revirtió un evento con operaciones posteriores.');
            const esperado=previo?{...previo,ultimaOperacionHistorica:e.id,updatedAt:item.data.updatedAt}:{...anterior,_deleted:true,revertidoPor:e.id,eventoHistoricoVigente:null,ultimaOperacionHistorica:e.id,updatedAt:item.data.updatedAt};
            if(firma(esperado)!==firma(item.data))error('La corrección no recupera la proyección anterior.');
          }
        });
        if(original)revertidos.add(original.id);
      }
      e.registros.forEach(item=>esperados.set(`${item.store}/${item.data.id}`,item.data));
      porEvento.set(e.id,e);
    });
    const existentes=new Map(['prestamos','cuotas','pagos_cuota'].flatMap(s=>libro[s].map(d=>[`${s}/${d.id}`,d])));
    if (esperados.size!==existentes.size) error('Hay registros financieros sin auditar o faltantes.');
    for(const [key,data] of esperados) if(firma(economico(data))!==firma(economico(existentes.get(key)||{}))) error(`El registro ${key} no coincide con su auditoría.`);
    const clientes=new Map(libro.clientes.filter(c=>!c._deleted).map(c=>[c.id,c]));
    const prestamos=libro.prestamos.filter(p=>!p._deleted),cuotasVivas=libro.cuotas.filter(q=>!q._deleted),pagosVivos=libro.pagos_cuota.filter(p=>!p._deleted);
    const porId=new Map(prestamos.map(p=>[p.id,p]));
    for(const p of prestamos) {
      if(p.prestamoOrigenId) {
        const origen=porId.get(p.prestamoOrigenId);
        if(!origen || origen.prestamoRenovacionId!==p.id || origen.estado!=='Pagado' || p.estado==='Cancelado')error(`Cadena de renovación inconsistente en ${p.id}. No se permite finalizar con deuda sin representar.`);
      }
      if(p.prestamoRenovacionId && (!porId.has(p.prestamoRenovacionId) || porId.get(p.prestamoRenovacionId).prestamoOrigenId!==p.id))error(`Falta la renovación de ${p.id}.`);
      if (!clientes.has(p.clienteId)) error(`Falta el cliente de ${p.id}.`);
      const cuotas=cuotasVivas.filter(q=>q.prestamoId===p.id);
      if(cuotas.length!==p.nCuotas || Math.abs(r2(cuotas.reduce((s,q)=>s+q.monto,0))-p.total)>0.009) error(`El plan de ${p.id} no reconcilia.`);
      for(const q of cuotas) {
        const pagos=pagosVivos.filter(pago=>pago.cuotaId===q.id);
        const cobrado=r2(pagos.reduce((s,pago)=>s+pago.monto,0));
        const interesRenovado=q.origenPago==='interes_cobrado_renovacion_capital'?Number(q.interesCobradoReal):0;
        if(Math.abs(cobrado+interesRenovado-Number(q.totalAbonado||0))>0.009) error(`Los pagos de ${q.id} no reconcilian.`);
        if(q.estado!=='Cancelada' && Math.abs(r2(Number(q.totalAbonado||0)+Number(q.montoCompensado||0)+saldoCobrableCuota(q))-q.monto)>0.009) error(`El saldo de ${q.id} no reconcilia.`);
      }
    }
    if(cuotasVivas.some(q=>!porId.has(q.prestamoId)) || pagosVivos.some(p=>!cuotasVivas.some(q=>q.id===p.cuotaId)))error('Hay cuotas o pagos sin un préstamo vigente. No se permite finalizar.');
    const metricas=this.metricas.calcularMetricasGlobales({prestamos,cuotas:cuotasVivas,clientes:libro.clientes});
    return {sesionId:estado.sesionId,revision:estado.revision,prestamos:prestamos.length,cuotas:cuotasVivas.length,pagos:pagosVivos.length,metricas};
  }

  async verificar(contexto) { return this.verificarLibro(await this.snapshot(contexto)); }

  async finalizar(contexto, revisionEsperada) {
    const c=this.contexto(contexto),previo=await this.leer(contexto);
    if(previo?.estado==='finalizada') return previo;
    const informe=await this.verificar(contexto);
    if(informe.revision!==revisionEsperada) error('La cartera cambió. Verificá y confirmá nuevamente antes de finalizar.');
    await this.transaccion(c, async tx=>{
      const [s,a]=await Promise.all([tx.get(c.estado),tx.get(c.apertura)]);
      if(s.data()?.estado==='finalizada') return;
      if(s.data()?.estado!=='activa'||s.data().revision!==informe.revision||a.exists) error('Cambió el estado de carga. No se finalizó; volvé a verificar.');
      tx.update(c.estado,{estado:'finalizada',corteOperativoAt:c.serverTimestamp(),actualizadaAt:c.serverTimestamp(),verificacion:informe});
    });
    return this.leer(contexto);
  }

  async respaldo(contexto) {
    const libro=await this.snapshot(contexto);
    return libro.estado?serializarHistorico({estado:libro.estado,eventos:libro.carga_inicial_eventos}):null;
  }

  async validarRespaldo(contexto, data) {
    const libro=await this.snapshot(contexto),estado=libro.estado;
    const contieneHistoricos=Object.values(CLAVES_BACKUP).some(k=>(data[k]||[]).some(d=>d.cargaInicial));
    if(!estado) {
      if(data.cargaHistorica || contieneHistoricos) error('Este respaldo histórico no corresponde a una carga confirmada de esta cuenta. No se importó.');
      return;
    }
    if(['preparando','activa'].includes(estado.estado)) error('Finalizá o resolvé la carga histórica antes de restaurar datos. Podés exportar respaldos durante la carga.');
    if(estado.estado==='rechazada') return;
    if(data.cargaHistorica && (data.cargaHistorica.estado?.userId!==estado.userId || data.cargaHistorica.estado?.sesionId!==estado.sesionId)) error('El respaldo pertenece a otra cuenta o sesión histórica.');
    // La autoridad siempre se recupera del servidor. Un respaldo viejo no es una migración.
    for(const store of HISTORICA_STORES) {
      const remoto=libro[store],backup=data[CLAVES_BACKUP[store]]||[];
      const ordenar=lista=>lista.map(economico).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      if(firma(ordenar(remoto))!==firma(ordenar(backup))) error('El respaldo difiere del libro financiero confirmado. No se restauró ni reabrió la carga; recuperá la réplica desde Firebase.');
    }
  }
}
