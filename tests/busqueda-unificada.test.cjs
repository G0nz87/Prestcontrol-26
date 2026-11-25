const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {fixtureHTML,deps,read,extract}=require('./busqueda-unificada-fixture.cjs');
const {JSDOM,VirtualConsole}=deps('jsdom');
const model=new Function(read('core/busqueda.js').replace(/^export /gm,'')+'\n'+read('core/busqueda-voz.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nreturn {buscarClientesVoz,claveFonetica};')();
const {buscarClientesVoz,claveFonetica}=model,passed=[],doms=[];
const ids=rows=>Array.from(rows,r=>r.cliente.id),tick=()=>new Promise(r=>setTimeout(r,15));
async function test(name,fn){await fn();passed.push(name);console.log('OK '+name);}
async function harness(){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fixtureHTML(),{url:'https://prestcontrol.invalid/aislado',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});doms.push(dom);
  await dom.window.__readyUnificada;assert.equal(errors.length,0,errors[0]?.stack);
  const w=dom.window,d=w.document;
  return {w,d,errors,fill(id,value){const input=d.getElementById(id);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));},
    opciones:id=>Array.from(d.querySelectorAll('#'+id+' [data-cliente-id]'),n=>n.dataset.clienteId)};
}
(async()=>{
  await test('Siete escenarios pedidos con transcripciones sintéticas; tildes son normalización',()=>{
    for(const [consulta,nombre]of [['Tabo','Tavo'],['Giyo','Gillo'],['Karo','Caro'],['Joni','Yoni'],['Vichi','Bichi'],['Yesica','Jesica'],['Chuschin','Chuschín']]){
      const r=buscarClientesVoz([{id:'F',nombre}],consulta);assert.equal(r.length,1,consulta);assert.equal(r[0].prioridad,consulta==='Chuschin'?2:4,consulta);
    }
  });
  await test('Fonética contextual conserva CH, Ñ, vocales y G fuerte; no sustituye letras indiscriminadamente',()=>{
    for(const [a,b]of [['Cesar','Sesar'],['Quela','Kela'],['Gema','Jema'],['Hugo','Ugo'],['Llana','Yana']])assert.equal(buscarClientesVoz([{id:'F',nombre:b}],a)[0]?.prioridad,4,a);
    for(const [a,b]of [['Rosa','Roca'],['Guido','Gido'],['Lola','Loli'],['Jose','Jorge'],['Ana','Hanae'],['Chico','Sico'],['Ñato','Neto']])assert.notEqual(buscarClientesVoz([{id:'F',nombre:b}],a)[0]?.prioridad,4,a);
    assert.notEqual(claveFonetica('Guido'),claveFonetica('Gido'));assert.notEqual(claveFonetica('Chico'),claveFonetica('Sico'));
  });
  await test('Prioridad exacto, alias, normalizado, parcial, fonético y una edición controlada',()=>{
    const rows=[{id:'O',nombre:'Marceol'},{id:'F',nombre:'Marselo'},{id:'P',nombre:'Marcelo Ficticio'},
      {id:'N',nombre:'Márcelo'},{id:'A',nombre:'Alias Ficticio',apodo:'Marcelo'},{id:'E',nombre:'Marcelo'}];
    const r=buscarClientesVoz(rows,'Marcelo');assert.deepEqual(ids(r),['E','A','N','P','F','O']);assert.deepEqual(r.map(x=>x.prioridad),[0,1,2,3,4,5]);
    assert.deepEqual(r.map(x=>x.aproximada),[false,false,false,false,true,true]);
  });
  await test('Una letra, términos invertidos, alias cortos, sin inventar apodos ni usar notas',()=>{
    const rows=[{id:'A',nombre:'Yolanda Moreno Ficticia',alias:'Lu'},{id:'B',nombre:'José Ficticio',notas:'Pepe',direccion:'Tabo'}];
    assert.deepEqual(ids(buscarClientesVoz(rows,'Mor Yol')),['A']);assert.equal(buscarClientesVoz(rows,'Lu')[0].prioridad,1);
    assert(buscarClientesVoz(rows,'Y').length);assert.equal(buscarClientesVoz(rows,'Pepe').length,0);assert.equal(buscarClientesVoz(rows,'Tabo').length,0);
  });
  await test('Ortografía limitada: una edición larga, sin dos errores ni aproximación de nombres muy cortos',()=>{
    assert.equal(buscarClientesVoz([{id:'A',nombre:'Marcelo'}],'Marcleo')[0]?.prioridad,5);
    assert.equal(buscarClientesVoz([{id:'A',nombre:'Marcelo'}],'Mxxcelo').length,0);
    assert.equal(buscarClientesVoz([{id:'A',nombre:'Lola'}],'Loli').length,0);
    assert.equal(buscarClientesVoz([{id:'A',nombre:'Tavo'}],'Tabo Tabo').length,0);
  });
  await test('Resultados ambiguos separados, tombstones excluidos, sin mutar nombres ni alias',()=>{
    const rows=[{id:'A',nombre:'Tabo'},{id:'B',nombre:'Tavo'},{id:'C',nombre:'Tabo',_deleted:true}],before=JSON.stringify(rows);
    assert.deepEqual(ids(buscarClientesVoz(rows,'Tabo')),['A','B']);assert.equal(JSON.stringify(rows),before);
  });
  await test('Inicio → Cliente: fragmentos, alias, DNI/teléfono y sin mostrar toda la cartera vacía',async()=>{
    const h=await harness();h.w.filtrarDashCliente('');assert.equal(h.opciones('dash-cli-drop').length,0);
    for(const q of ['M','Mor Yol','Lucero','11111111','01155550101']){h.w.filtrarDashCliente(q);assert(h.opciones('dash-cli-drop').includes('CL-001'),q);}
    h.w.filtrarDashCliente('Luli');assert.deepEqual(h.opciones('dash-cli-drop'),['CL-002']);
    h.w.filtrarDashCliente('Morena');assert.equal(h.opciones('dash-cli-drop').length,0,'Inicio conserva clientes Activo');
  });
  await test('Inicio encuentra clientes sin préstamos y conserva dashboard individual',async()=>{
    const h=await harness();h.w.filtrarDashCliente('Aguila');assert.deepEqual(h.opciones('dash-cli-drop'),['CL-004']);
    h.d.querySelector('#dash-cli-drop button').click();await tick();
    assert.match(h.d.querySelector('#pg-dashboard').textContent,/Álvaro Ficticio/);assert(h.d.querySelector('.dash-client-kpi'));
    assert.equal(h.w.dashClienteId,'CL-004');assert.equal(h.w.__escrituras,0);
  });
  await test('Inicio reindexa al sincronizar conservando consulta/foco; una cuenta distinta invalida opciones',async()=>{
    const h=await harness(),input=h.d.getElementById('dash-cli-search');input.value='AliasNuevo';input.focus();input.setSelectionRange(2,4);h.w.filtrarDashCliente(input.value);
    h.w.__datos.clientes[0].alias='AliasNuevo';await h.w.renderDashboard();
    assert.deepEqual(h.opciones('dash-cli-drop'),['CL-001']);assert.equal(h.d.activeElement.id,'dash-cli-search');assert.equal(h.d.activeElement.selectionStart,2);
    const item=h.d.querySelector('#dash-cli-drop button');h.w._fbUser={uid:'OTRA-CUENTA-FICTICIA'};item.click();assert.equal(h.w.dashClienteId,null);
  });
  await test('Nuevo préstamo: mismo motor, ocho sugerencias y bloqueo previo conservado',async()=>{
    const h=await harness();h.w.openSheetPrestamo();await tick();
    for(const q of ['Mor Yol','Lucero','11111111','01155550101','Y']){h.w.filtrarClientesAC(q);assert(h.opciones('pre-cliente-drop').includes('CL-001'),q);}
    h.w.filtrarClientesAC('Morena');h.d.querySelector('#pre-cliente-drop button').click();assert.equal(h.d.getElementById('pre-cliente').value,'');assert.match(h.w.__mensajes.at(-1),/bloqueado/);
    h.w.filtrarClientesAC('Luli');h.d.querySelector('#pre-cliente-drop button').click();assert.equal(h.d.getElementById('pre-cliente').value,'CL-002');assert.equal(h.w.__escrituras,0);
  });
  await test('Nuevo préstamo actualiza alias recibidos sin lecturas por tecla y descarta lecturas de otra cuenta',async()=>{
    const h=await harness();h.w.openSheetPrestamo();await tick();
    const input=h.d.getElementById('pre-cliente-search');input.focus();input.value='CambioAlias';h.w.filtrarClientesAC(input.value);const reads=h.w.__lecturas;
    h.w.filtrarClientesAC('M');h.w.filtrarClientesAC(input.value);assert.equal(h.w.__lecturas,reads);
    h.w.__datos.clientes[0].alias='CambioAlias';await h.w.actualizarSelectoresClientesAbiertos();assert.deepEqual(h.opciones('pre-cliente-drop'),['CL-001']);
    const original=h.w.dbAll;let resolver;h.w.dbAll=()=>new Promise(r=>resolver=r);h.w.openSheetPrestamo();h.w._fbUser={uid:'NUEVA-FICTICIA'};resolver([{id:'VIEJO',nombre:'Anterior',estado:'Activo'}]);await tick();assert.equal(h.w._acClientes.length,0);h.w.dbAll=original;
  });
  await test('Prendas: filtrar selector no cambia cliente, préstamo ni dispara onchange',async()=>{
    const h=await harness();await h.w.openSheetPrenda();const select=h.d.getElementById('pda-cliente');select.value='CL-001';let cambios=0;select.onchange=()=>cambios++;
    h.fill('pda-cliente-busqueda','Luli');assert.equal(select.value,'CL-001');assert([...select.options].some(o=>o.value==='CL-002'));assert.equal(cambios,0);
    assert.match(h.d.getElementById('pda-cliente-resultados').textContent,/Se conserva el cliente/);
    h.fill('pda-cliente-busqueda','zzzzzz');assert.equal(select.value,'CL-001');assert.equal(cambios,0);assert.equal(h.w.__escrituras,0);
  });
  await test('Prendas: inventario usa alias/términos y conserva filtros de estado/cliente y búsqueda por serie',async()=>{
    const h=await harness();h.w.__datos.prendas=[{id:'PD-A',clienteId:'CL-001',prestamoId:'PR-025',descripcion:'Prueba Televisor',estado:'En garantía',numeroSerie:'SERIE-FICTICIA',valorEstimado:10},
      {id:'PD-B',clienteId:'CL-002',prestamoId:'PR-029',descripcion:'Otra garantía',estado:'Ejecutada',valorEstimado:20}];
    await h.w.renderPrendas();let input=h.d.getElementById('pda-filtro-texto');input.value='Mor Yol';input.focus();input.setSelectionRange(1,3);await h.w.renderPrendas();
    assert.match(h.d.getElementById('pg-prendas').textContent,/PD-A/);assert(!h.d.getElementById('pg-prendas').textContent.includes('PD-B'));assert.equal(h.d.activeElement.id,'pda-filtro-texto');
    for(const q of ['Lucero','SERIE-FICTICIA','11111111']){h.d.getElementById('pda-filtro-texto').value=q;await h.w.renderPrendas();assert.match(h.d.getElementById('pg-prendas').textContent,/PD-A/);}
    h.d.getElementById('pda-filtro-estado').value='Ejecutada';await h.w.renderPrendas();assert(!h.d.getElementById('pg-prendas').textContent.includes('PD-A'));assert.equal(h.w.__escrituras,0);
  });
  await test('Voz exacta única abre ficha; parcial único y fonética requieren selección explícita',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'E',nombre:'Tabo'}];
    assert.equal((await h.w.resolverClienteVoz('Tabo')).accion,'abrir-cliente');assert.deepEqual(Array.from(h.w.__fichas),['E']);
    h.w.__fichas.length=0;assert.equal((await h.w.resolverClienteVoz('Tavo')).accion,'cliente-seleccion-requerida');assert.equal(h.w.__fichas.length,0);
    assert.match(h.d.querySelector('[data-voz-resumen]').textContent,/aproximadas/);h.d.querySelector('.voz-cliente-opcion').click();await tick();assert.deepEqual(Array.from(h.w.__fichas),['E']);
    h.w.__fichas.length=0;await h.w.resolverClienteVoz('Tab');assert.equal(h.w.__fichas.length,0);
  });
  await test('Voz ambigua presenta candidatos y transcripción, sin elegir al primero',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'A',nombre:'Tabo'},{id:'B',nombre:'Tavo'}];
    assert.equal((await h.w.resolverClienteVoz('Tabo','Buscá al cliente Tabo')).accion,'cliente-ambiguo');assert.equal(h.w.__fichas.length,0);
    assert.match(h.d.querySelector('[data-voz-transcripcion]').textContent,/Buscá al cliente Tabo/);assert.deepEqual(h.opciones('sh-busqueda-voz'),['A','B']);
    h.d.querySelector('[data-cliente-id="B"]').click();await tick();assert.deepEqual(Array.from(h.w.__fichas),['B']);
  });
  await test('Voz sin coincidencias permite corregir manualmente el nombre; texto especial no inyecta HTML',async()=>{
    const h=await harness();await h.w.resolverClienteVoz('zzzzzz','<img src=x onerror=alert(1)>');
    assert.match(h.d.querySelector('[data-voz-resumen]').textContent,/No se encontró/);assert.equal(h.d.querySelector('#sh-busqueda-voz img'),null);
    h.fill('voz-cliente-consulta','Mor Yol');assert(h.opciones('sh-busqueda-voz').includes('CL-001'));assert.equal(h.w.__fichas.length,0);
  });
  await test('Voz revalida cambios/eliminación y no abre una identidad distinta bajo el mismo ID',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'A',nombre:'Tabo'}];await h.w.resolverClienteVoz('Tavo');
    h.w.__datos.clientes[0].nombre='Tavo';h.d.querySelector('.voz-cliente-opcion').click();await tick();assert.equal(h.w.__fichas.length,0);assert.match(h.d.querySelector('[data-voz-resumen]').textContent,/cambiaron/);
    h.w.__datos.clientes[0]._deleted=true;h.d.querySelector('.voz-cliente-opcion').click();await tick();assert.equal(h.w.__fichas.length,0);assert.equal(h.opciones('sh-busqueda-voz').length,0);
  });
  await test('Voz descarta selección pendiente al cambiar consulta, cuenta o iniciar otra búsqueda',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'A',nombre:'Tabo'}];await h.w.resolverClienteVoz('Tavo');
    const original=h.w.dbAll;let resolver;h.w.dbAll=()=>new Promise(r=>resolver=r);h.d.querySelector('.voz-cliente-opcion').click();h.fill('voz-cliente-consulta','Nada');resolver([{id:'A',nombre:'Tabo'}]);await tick();assert.equal(h.w.__fichas.length,0);
    h.w.dbAll=original;await h.w.resolverClienteVoz('Tavo');h.w._fbUser={uid:'OTRA-CUENTA'};h.d.querySelector('.voz-cliente-opcion').click();await tick();assert.equal(h.w.__fichas.length,0);
  });
  await test('Respuesta de voz antigua no reemplaza una nueva; cancelar descarta la lectura pendiente',async()=>{
    const h=await harness(),original=h.w.dbAll;let resolver;h.w.dbAll=()=>new Promise(r=>resolver=r);
    const antigua=h.w.resolverClienteVoz('Tavo');h.w.dbAll=original;await h.w.resolverClienteVoz('Nada');resolver([{id:'A',nombre:'Tabo'}]);assert.equal((await antigua).accion,'voz-descartada');assert.equal(h.d.getElementById('voz-cliente-consulta').value,'Nada');
    h.w.dbAll=()=>new Promise(r=>resolver=r);const cancelada=h.w.resolverClienteVoz('Tavo');h.w.cancelarBusquedaVoz();resolver([{id:'A',nombre:'Tavo'}]);assert.equal((await cancelada).accion,'voz-descartada');assert.equal(h.w.__fichas.length,0);
  });
  await test('Parser conserva navegación anterior y bloquea operaciones financieras antes de buscar nombres',async()=>{
    const h=await harness(),before=JSON.stringify(h.w.__datos);
    const destinos={'clientes':'clientes','préstamos':'prestamos','cobros':'cobros','cuotas':'cuotas','agenda':'calendario','historial':'historial','configuración':'config','alertas':'alertas','inicio':'dashboard','gráficos':'dashboard','cobros de hoy':'cobros','cuotas atrasadas':'atrasadas','cuotas vencen hoy':'hoy'};
    for(const [comando,page]of Object.entries(destinos)){await h.w.procesarComandoVoz(comando);assert.equal(h.w.__navegacion.at(-1),page,comando);}
    await h.w.procesarComandoVoz('préstamos activos');assert.equal(h.w.__navegacion.at(-1),'prestamos');
    for(const comando of ['pagar Tavo','renovar Tavo','eliminar Tavo','borrar Tavo','registrar pago Tavo','cobrar cuota Tavo','nuevo préstamo','guardar Tavo'])assert.equal((await h.w.procesarComandoVoz(comando)).accion,'requiere-confirmacion',comando);
    assert.equal(JSON.stringify(h.w.__datos),before);assert.equal(h.w.__escrituras,0);assert.equal(h.w.__fichas.length,0);
  });
  await test('Parser conserva tildes/nombre original y aliases; API de audio simulada usa es-AR y rechaza resultados de otra cuenta',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'A',nombre:'Chuschín',apodo:'Tabo'}];
    assert.equal((await h.w.procesarComandoVoz('Buscá al cliente Chuschín por favor')).clienteId,'A');
    h.w.iniciarComandoVoz();const recognition=h.w.__recognitions.at(-1);assert.equal(recognition.lang,'es-AR');assert.equal(recognition.maxAlternatives,1);
    recognition.onresult({results:[[{transcript:'Buscá Tavo'}]]});await tick();assert(h.d.getElementById('sh-busqueda-voz').classList.contains('on'));assert.equal(h.w.__fichas.length,1,'solo la búsqueda exacta anterior abrió ficha');
    h.w.detenerComandosVoz();h.w.iniciarComandoVoz();const vieja=h.w.__recognitions.at(-1);
    vieja.onerror({error:'not-allowed'});assert.match(h.w.__mensajes.at(-1),/Permiso/);
    h.w._fbUser={uid:'OTRA'};vieja.onresult({results:[[{transcript:'Chuschín'}]]});await tick();assert.equal(h.w.__fichas.length,1);
  });
  await test('Nombres directos con Ñ y tildes conservan identidad; desactivar un selector desactiva su filtro',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'A',nombre:'Ñato',estado:'Activo'},{id:'B',nombre:'Chuschín',estado:'Activo'}];
    assert.equal((await h.w.procesarComandoVoz('Ñato')).clienteId,'A');assert.equal((await h.w.procesarComandoVoz('Chuschín')).clienteId,'B');
    await h.w.openSheetPrenda();h.d.getElementById('pda-cliente').disabled=true;await tick();assert.equal(h.d.getElementById('pda-cliente-busqueda').disabled,true);
    h.d.getElementById('pda-cliente').disabled=false;await tick();assert.equal(h.d.getElementById('pda-cliente-busqueda').disabled,false);
  });
  await test('Actualización visual por sincronización refresca candidatos de voz, sin abrirlos',async()=>{
    const h=await harness();h.w.__datos.clientes=[{id:'A',nombre:'Tabo'}];await h.w.resolverClienteVoz('Tavo');
    h.w.__datos.clientes.push({id:'B',nombre:'Tavo'});await h.w.actualizarSelectoresClientesAbiertos();assert.deepEqual(h.opciones('sh-busqueda-voz'),['B','A']);assert.equal(h.w.__fichas.length,0);
  });
  await test('Alcance: finanzas, importación, contadores, IDs, módulos anteriores y carrera V2 intactos',()=>{
    const BASE='49821abe2d62d4cb24a3ce81a9b6b31f11e7de5d',old=file=>execFileSync('git',['show',BASE+':'+file],{encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n');
    const {funcionesBusqueda,sinGanchoVisual,sinFunciones,assertModuloProtegido}=require('./busqueda-alcance.cjs');
    const nuevas=funcionesBusqueda.filter(n=>!['renderClientes','filterClientes','renderPrestamos','filtrarPrestamos'].includes(n));
    const limpiar=s=>sinFunciones(sinGanchoVisual(s),nuevas).replace(/^\.(?:ac-opcion|voz-busqueda-cuerpo|voz-cliente-opcion|voz-cliente-tipo)\{[^\n]*\}\n/gm,'');
    assert.equal(limpiar(read('index.html')),limpiar(old('index.html')),'solo funciones de búsqueda, estilos y gancho visual');
    for(const file of ['ui/prestamos.js','ui/prendas.js'])assertModuloProtegido(file,read(file),old(file));
    const protegidos=['ui/clientes.js','ui/caja.js','ui/carga-historica.js','ui/importacion-clientes.js','ui/buscadores.js','core/helpers.js','core/firebase.js','firestore.rules',
      ...fs.readdirSync('services').filter(f=>f.endsWith('.js')).map(f=>'services/'+f),...fs.readdirSync('repositories').filter(f=>f.endsWith('.js')).map(f=>'repositories/'+f)];
    for(const file of protegidos)assert.equal(read(file).replace(/\r\n/g,'\n'),old(file),file);
    const anterior=old('index.html').match(/function buildDashCliente\([^]*?\n}/)[0];
    assert.equal(extract('buildDashCliente').replace(/\r\n/g,'\n').split('  return `<div class="fadeIn dash-client">')[0],anterior.split('  // Build autocomplete')[0]);
    const sw=read('sw.js');assert(sw.includes('shell-v71-busqueda-unificada-voz-v1'));
    for(const file of ['core/busqueda-voz.js','ui/selectores-clientes.js','ui/busqueda-voz.js'])assert(sw.includes("'./"+file+"'"));
  });
  console.log(JSON.stringify({passed:passed.length,scope:'Transcripciones y sincronización simuladas, datos sintéticos; audio real NO validado',results:passed},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(()=>doms.forEach(d=>d.window.close()));
