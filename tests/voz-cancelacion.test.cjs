// Regresiones deterministas del ciclo completo; nunca usa audio ni datos reales.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixtureHTML,deps,extract}=require('./busqueda-unificada-fixture.cjs');

async function regresionesCancelacion(w,fuenteDetalle) {
  const results=[],original=w.dbAll,dbGet=w.dbGet,goPage=w.goPage,detalle=w.openClienteDetail,procesar=w.procesarComandoVoz,
    filtrar=w.filtrarPrestamos,evaluar=w.evaluarCobroInteresRenovacionCapital;
  const filas=[{id:'A',nombre:'Tabo',estado:'Activo'},{id:'B',nombre:'Luciana Ficticia',estado:'Activo'}];
  const exigir=(condicion,mensaje)=>{if(!condicion)throw new Error(mensaje)};
  function preparar(){
    w.detenerComandosVoz();w.dbAll=original;w._fbUser={uid:'CUENTA-VOZ-FICTICIA'};
    w.dbGet=dbGet;w.goPage=goPage;w.openClienteDetail=detalle;w.procesarComandoVoz=procesar;
    w.filtrarPrestamos=filtrar;w.evaluarCobroInteresRenovacionCapital=evaluar;
    w.__datos.clientes=JSON.parse(JSON.stringify(filas));w.__datos.prestamos=[];w.__datos.cuotas=[];
    w.__fichas.length=0;w.__mensajes.length=0;w.__navegacion.length=0;w.__recognitions.length=0;
  }
  const diferir=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
  function capturarProcesador(){let ultima;w.procesarComandoVoz=(...args)=>(ultima=procesar(...args));return ()=>ultima;}
  function segundaLectura(){
    let lecturas=0;const llegada=diferir(),lectura=diferir();
    w.dbAll=store=>{if(store==='clientes'&&++lecturas===2){llegada.resolve();return lectura.promise;}return original(store)};
    return {llegada:llegada.promise,completar:()=>lectura.resolve(JSON.parse(JSON.stringify(filas)))};
  }
  function primeraLectura(){
    let resolver,leida=false;const pendiente=new Promise(r=>resolver=r);
    w.dbAll=store=>store==='clientes'&&!leida?(leida=true,pendiente):original(store);
    return ()=>resolver(JSON.parse(JSON.stringify(filas)));
  }
  async function caso(nombre,fn){
    preparar();let timer;
    try{
      await Promise.race([fn(),new Promise((_,reject)=>{timer=w.setTimeout(()=>reject(new Error('La promesa controlada no alcanzo la etapa esperada')),5000)})]);
      results.push({nombre,ok:true});
    }catch(error){results.push({nombre,ok:false,error:error.message});}
    finally{w.clearTimeout(timer);}
  }
  await caso('A: cancelar durante primera lectura exacta desde procesarComandoVoz',async()=>{
    const completar=primeraLectura(),comando=w.procesarComandoVoz('Tabo');w.detenerComandosVoz();completar();await comando;
    exigir(w.__fichas.length===0,'Se abrio una ficha despues de cancelar: '+JSON.stringify(w.__fichas));
  });
  await caso('B: comando antiguo no reemplaza la consulta Luc mas reciente',async()=>{
    const completar=primeraLectura(),antiguo=w.procesarComandoVoz('Tavo');await w.procesarComandoVoz('buscar Luc');
    exigir(w.document.getElementById('voz-cliente-consulta')?.value==='Luc','No se preparo la consulta nueva');
    completar();await antiguo;
    exigir(w.document.getElementById('voz-cliente-consulta')?.value==='Luc','Consulta reemplazada por: '+w.document.getElementById('voz-cliente-consulta')?.value);
  });
  await caso('C: cancelar primera lectura aproximada no reabre candidatos',async()=>{
    const completar=primeraLectura(),comando=w.procesarComandoVoz('Tavo');w.detenerComandosVoz();completar();await comando;
    exigir(!w.document.querySelector('#sh-busqueda-voz.on'),'Se reabrio la hoja cancelada');exigir(w.__fichas.length===0,'Se abrio una ficha');
  });
  await caso('Cuenta distinta durante lectura inicial descarta comando completo',async()=>{
    const completar=primeraLectura(),comando=w.procesarComandoVoz('Tabo');w._fbUser={uid:'OTRA-CUENTA-FICTICIA'};completar();
    exigir((await comando).accion==='voz-descartada','No se descarto el contexto anterior');exigir(w.__fichas.length===0,'Ficha de otra cuenta');
    exigir(!w.document.querySelector('#sh-busqueda-voz.on'),'Candidatos de otra cuenta');
  });
  await caso('Cambio de base local durante lectura inicial descarta resultados',async()=>{
    const completar=primeraLectura(),comando=w.procesarComandoVoz('Tavo');w.__dbLocal={};completar();
    exigir((await comando).accion==='voz-descartada','Se reutilizo una base anterior');exigir(!w.document.querySelector('#sh-busqueda-voz.on'),'Hoja antigua visible');
  });
  await caso('Cancelar dentro del resolvedor conserva la revision original',async()=>{
    const gate=segundaLectura(),comando=w.procesarComandoVoz('Tabo');await gate.llegada;w.detenerComandosVoz();gate.completar();
    exigir((await comando).accion==='voz-descartada','El resolvedor reactivo el comando');exigir(w.__fichas.length===0,'Apertura antigua desde resolvedor');
  });
  await caso('Resolvedor antiguo finaliza despues de Luc y no altera su seleccion',async()=>{
    const gate=segundaLectura(),antiguo=w.procesarComandoVoz('Tabo');await gate.llegada;
    await w.procesarComandoVoz('buscar Luc');const hoja=w.document.querySelector('#sh-busqueda-voz').innerHTML;
    gate.completar();await antiguo;exigir(w.document.querySelector('#sh-busqueda-voz').innerHTML===hoja,'Se altero la hoja nueva');exigir(w.__fichas.length===0,'Se abrio la ficha antigua');
  });
  await caso('Callback completo: cancelar lectura exacta despues de onend no abre ficha',async()=>{
    const ultima=capturarProcesador(),completar=primeraLectura();w.iniciarComandoVoz();const rec=w.__recognitions.at(-1);
    rec.onresult({results:[[{transcript:'Tabo'}]]});const comando=ultima();exigir(comando,'No recorrio el procesador');rec.onend();w.detenerComandosVoz();completar();await comando;
    exigir(w.__fichas.length===0,'El resultado de audio cancelado abrio ficha');
  });
  await caso('Callback completo: aproximado antiguo no reemplaza nuevo comando por voz',async()=>{
    const ultima=capturarProcesador(),completar=primeraLectura();w.iniciarComandoVoz();const viejo=w.__recognitions.at(-1);
    viejo.onresult({results:[[{transcript:'Tavo'}]]});const anterior=ultima();viejo.onend();w.iniciarComandoVoz();
    w.__recognitions.at(-1).onresult({results:[[{transcript:'buscar Luc'}]]});await ultima();
    completar();await anterior;exigir(w.document.getElementById('voz-cliente-consulta')?.value==='Luc','Un callback antiguo reemplazo Luc');exigir(w.__fichas.length===0,'Se abrio una ficha sin seleccionar');
  });
  await caso('Callbacks tardios onstart/result/error/end no alteran otro reconocimiento activo',async()=>{
    const ultima=capturarProcesador();w.iniciarComandoVoz();const viejo=w.__recognitions.at(-1);w.detenerComandosVoz();w.iniciarComandoVoz();
    const nuevo=w.__recognitions.at(-1),boton=w.document.getElementById('voice-btn'),mensajes=w.__mensajes.length;
    viejo.onstart();viejo.onresult({results:[[{transcript:'Tabo'}]]});viejo.onerror({error:'not-allowed'});viejo.onend();
    exigir(boton.getAttribute('aria-pressed')==='true','Se altero el indicador del reconocimiento nuevo');exigir(w.__mensajes.length===mensajes,'Se mostro un error viejo');exigir(!ultima(),'Se proceso un callback antiguo');
    nuevo.onresult({results:[[{transcript:'buscar Luc'}]]});await ultima();exigir(w.document.getElementById('voz-cliente-consulta')?.value==='Luc','El callback vigente no funciona');
  });
  await caso('Rechazo tardio de lectura no muestra error sobre comando posterior',async()=>{
    const ultima=capturarProcesador(),gate=diferir();let leida=false;
    w.dbAll=store=>store==='clientes'&&!leida?(leida=true,gate.promise):original(store);
    w.iniciarComandoVoz();w.__recognitions.at(-1).onresult({results:[[{transcript:'Tabo'}]]});const viejo=ultima();
    await w.procesarComandoVoz('buscar Luc');const mensajes=w.__mensajes.length;gate.reject(new Error('Fallo sintetico antiguo'));await viejo.catch(()=>{});
    exigir(w.__mensajes.length===mensajes,'El catch antiguo altero los mensajes nuevos');exigir(w.document.getElementById('voz-cliente-consulta')?.value==='Luc','Se altero la consulta');
  });
  await caso('Seleccion manual pendiente cancelada no abre ficha ni reactiva candidatos',async()=>{
    await w.procesarComandoVoz('buscar Tavo');const completar=primeraLectura(),boton=w.document.querySelector('.voz-cliente-opcion'),seleccion=boton.onclick();
    w.detenerComandosVoz();completar();await seleccion;exigir(w.__fichas.length===0,'Se completo una seleccion cancelada');exigir(!w.document.querySelector('#sh-busqueda-voz.on'),'Reapertura tras seleccion');
  });
  await caso('Seleccion antigua termina despues de otra consulta sin alterar su hoja',async()=>{
    await w.procesarComandoVoz('buscar Tavo');const completar=primeraLectura(),seleccion=w.document.querySelector('.voz-cliente-opcion').onclick();
    await w.procesarComandoVoz('buscar Luc');const contenido=w.document.querySelector('#sh-busqueda-voz').innerHTML;completar();await seleccion;
    exigir(w.document.querySelector('#sh-busqueda-voz').innerHTML===contenido,'Se alteraron las opciones actuales');exigir(w.__fichas.length===0,'Seleccion anterior abrio ficha');
  });
  await caso('Crear cliente cancelado durante navegacion no abre formulario ni toast tardio',async()=>{
    const gate=diferir();w.goPage=()=>gate.promise;const antiguo=w.procesarComandoVoz('crear cliente');w.detenerComandosVoz();w.goPage=goPage;
    await w.procesarComandoVoz('alertas');const mensajes=w.__mensajes.length;gate.resolve();await antiguo;
    exigir(!w.__navegacion.includes('formulario-cliente'),'Se abrio un formulario antiguo');exigir(w.__mensajes.length===mensajes,'Toast antiguo tras navegar');
  });
  await caso('Filtro de prestamos cancelado durante navegacion no filtra pantalla posterior',async()=>{
    const gate=diferir();let filtros=0;w.goPage=()=>gate.promise;w.filtrarPrestamos=()=>filtros++;
    const antiguo=w.procesarComandoVoz('prestamos activos');w.detenerComandosVoz();gate.resolve();await antiguo;exigir(filtros===0,'Se aplico el filtro de un comando cancelado');
  });
  function detalleReal(){
    for(const id of ['pg-cliente-detail','hdr-title'])if(!w.document.getElementById(id)){const el=w.document.createElement('div');el.id=id;w.document.body.append(el);}
    w.openClienteDetail=w.Function('return ('+fuenteDetalle+')')();w.clientePrestamoExpanded=null;
    w.goDetail=(_page,opts)=>{w.__rutaDetalle=opts.id};
  }
  await caso('Ficha real: guardia invalida impide iniciar navegacion o lecturas',async()=>{
    detalleReal();const el=w.document.getElementById('pg-cliente-detail');el.textContent='SELECCION ACTUAL';let lecturas=0;w.dbGet=async()=>{lecturas++;return filas[0]};
    await w.openClienteDetail('A',{vigenteVoz:()=>false});exigir(el.textContent==='SELECCION ACTUAL'&&lecturas===0,'Se inicio una ficha invalida');
  });
  await caso('Ficha real: cancelar durante Promise.all no sobrescribe la seleccion actual',async()=>{
    detalleReal();const lectura=diferir(),llegada=diferir();w.dbGet=()=>{llegada.resolve();return lectura.promise};
    const comando=w.procesarComandoVoz('Tabo');await llegada.promise;w.detenerComandosVoz();w.document.getElementById('pg-cliente-detail').textContent='FICHA POSTERIOR';
    lectura.resolve(filas[0]);exigir((await comando).accion==='voz-descartada','Se confirmo una apertura cancelada');exigir(w.document.getElementById('pg-cliente-detail').textContent==='FICHA POSTERIOR','Se pinto una ficha antigua');
  });
  await caso('Ficha real: cancelar durante elegibilidad impide el render final tardio',async()=>{
    detalleReal();const lectura=diferir(),llegada=diferir();w.__datos.prestamos=[{id:'P-FICTICIO',clienteId:'A',estado:'Activo',monto:100}];
    w.evaluarCobroInteresRenovacionCapital=()=>{llegada.resolve();return lectura.promise};
    const comando=w.procesarComandoVoz('Tabo');await llegada.promise;w.detenerComandosVoz();w.document.getElementById('pg-cliente-detail').textContent='FICHA POSTERIOR';
    lectura.resolve({ok:false});await comando;exigir(w.document.getElementById('pg-cliente-detail').textContent==='FICHA POSTERIOR','Se pinto despues de la segunda espera');
  });
  await caso('Comandos vigentes conservan apertura exacta, candidatos foneticos y seleccion manual',async()=>{
    exigir((await w.procesarComandoVoz('Tabo')).clienteId==='A','Fallo exacto vigente');w.__fichas.length=0;
    await w.procesarComandoVoz('Tavo');exigir(w.__fichas.length===0,'Aproximado abierto sin seleccionar');
    exigir(w.document.querySelector('.voz-cliente-opcion')?.textContent.includes('aproximada'),'Se perdio la etiqueta fonetica');
    await w.document.querySelector('.voz-cliente-opcion').onclick();exigir(w.__fichas[0]==='A','Fallo seleccion vigente');
  });
  await caso('Comandos de navegacion conservados y operaciones financieras sin ejecutar',async()=>{
    const destinos={clientes:'clientes',prestamos:'prestamos',cobros:'cobros',cuotas:'cuotas',agenda:'calendario',historial:'historial',configuracion:'config',alertas:'alertas',inicio:'dashboard'};
    for(const [comando,page]of Object.entries(destinos)){await w.procesarComandoVoz(comando);exigir(w.__navegacion.at(-1)===page,'Navegacion '+comando);}
    for(const comando of ['pagar Tabo','renovar Tabo','borrar Tabo','registrar pago Tabo'])exigir((await w.procesarComandoVoz(comando)).accion==='requiere-confirmacion','Operacion no bloqueada');
    exigir(w.__escrituras===0,'Se realizaron escrituras');
  });
  return {scope:'Procesador completo con promesas controladas y datos sinteticos; sin audio real',passed:results.filter(r=>r.ok).length,total:results.length,results};
}

(async()=>{
  if(process.argv.includes('--chrome')){
    const {chromium}=deps('playwright-core'),crypto=require('node:crypto');
    const browser=await chromium.launch({executablePath:process.env.PRESTCONTROL_TEST_BROWSER||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
    try{
      const context=await browser.newContext(),page=await context.newPage(),errors=[],external=[],modules=[];
      context.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
      const root=path.resolve(__dirname,'..'),origin='https://prestcontrol-voz.invalid';
      const shell=fs.readFileSync(path.join(root,'sw.js'),'utf8').match(/const APP_SHELL = \[([^]*?)\];/)[1];
      const permitidos=new Set([...shell.matchAll(/'\.\/([^']+\.js)'/g)].map(m=>'/'+m[1]));
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==origin){external.push(url.href);return route.abort();}
        if(url.pathname==='/__fixture')return route.fulfill({status:200,contentType:'text/html',body:fixtureHTML({modulosES:true})});
        if(!permitidos.has(url.pathname)){external.push(url.href);return route.abort();}
        const body=fs.readFileSync(path.join(root,url.pathname.slice(1)));
        modules.push({path:url.pathname,sha256:crypto.createHash('sha256').update(body).digest('hex')});
        return route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body});
      });
      await page.goto(origin+'/__fixture');await page.evaluate(()=>__readyUnificada);
      const esReal=await page.evaluate(()=>window.resolverBusquedaClienteVoz===window.__vozES.resolverBusquedaClienteVoz&&window.iniciarCicloVoz===window.__vozES.iniciarCicloVoz);
      if(!esReal)throw Error('No se esta usando la instancia real de los modulos ES');
      const report=await page.evaluate(async({suite,detalle})=>await (0,eval)('('+suite+')')(window,detalle),{suite:regresionesCancelacion.toString(),detalle:extract('openClienteDetail')});
      Object.assign(report,{browser:await browser.version(),esReal,modules,external,errors,audioReal:false});
      fs.writeFileSync(path.join(os.tmpdir(),'prestcontrol-voz-cancelacion-despues-chrome-es.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify(report,null,2));if(report.passed!==report.total||external.length||errors.length)process.exitCode=1;
    }finally{await browser.close();}
    return;
  }
  const {JSDOM,VirtualConsole}=deps('jsdom'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fixtureHTML(),{url:'https://prestcontrol.invalid/aislado',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
  try{
    await dom.window.__readyUnificada;const report=await regresionesCancelacion(dom.window,extract('openClienteDetail'));report.errors=errors;
    console.log(JSON.stringify(report,null,2));
    if(process.argv.includes('--guardar-antes'))fs.writeFileSync(path.join(os.tmpdir(),'prestcontrol-voz-cancelacion-reproduccion-antes.json'),JSON.stringify(report,null,2));
    else fs.writeFileSync(path.join(os.tmpdir(),'prestcontrol-voz-cancelacion-despues-node.json'),JSON.stringify(report,null,2));
    if(report.passed!==report.total||errors.length)process.exitCode=1;
  }finally{dom.window.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
