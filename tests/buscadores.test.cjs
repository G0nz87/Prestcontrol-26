const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const deps=createRequire(path.join(process.env.PRESTCONTROL_TEST_RUNTIME||path.join(os.tmpdir(),'prestcontrol-caja-test-runtime'),'package.json'));
const {JSDOM,VirtualConsole}=deps('jsdom');
const {root,read,extract,datos,fixtureHTML}=require('./buscadores-fixture.cjs');
const BASE='3be34e8b67591b2a5ecc231b4b900ab1c6e4c2c7';
const model=new Function(read('core/busqueda.js').replace(/^export /gm,'')+'\nreturn {crearIndiceClientes,crearIndicePrestamos,buscarEnIndice,normalizarBusqueda};')();
const ids=rows=>Array.from(rows,r=>r.id),passed=[],doms=[];
async function test(name,fn){await fn();passed.push(name);console.log('OK '+name);}
const buscar=(q,rows=datos.clientes)=>model.buscarEnIndice(model.crearIndiceClientes(rows),q);
async function harness(){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fixtureHTML(),{url:'http://localhost/aislado',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});doms.push(dom);
  assert.equal(errors.length,0,errors[0]?.stack);await dom.window.__ready;
  const w=dom.window,d=w.document;
  return {w,d,errors,query(tipo,q){const i=d.getElementById(tipo+'-busqueda');i.value=q;i.dispatchEvent(new w.Event('input',{bubbles:true}));},
    resultados:tipo=>ids(d.getElementById('pg-'+tipo)._busqueda.resultados),
    resumen:tipo=>d.getElementById(tipo+'-resultados').textContent,
    general:()=>d.querySelector('.clientes-contador').textContent.replace(/\s+/g,' ').trim()};
}
(async()=>{
  await test('Una letra, nombre completo, apellido y fragmentos desde el primer carácter',()=>{
    for(const q of ['Y','Yol','Mor','Moreno','Yolanda Moreno Ficticia'])assert(ids(buscar(q)).includes('CL-001'),q);
    assert(ids(buscar('A')).length>0);assert(ids(buscar('Luisina')).includes('CL-002'));
  });
  await test('Todos los términos sin orden, mayúsculas, tildes y espacios habituales',()=>{
    for(const q of ['Mor Yol','  moR   yOL  ','alvaro','ÁLVARO','FICTI ÁLV'])assert(ids(buscar(q)).includes(q.toLowerCase().includes('mor')?'CL-001':'CL-004'),q);
    assert.equal(buscar('Yol inexistente').length,0);
  });
  await test('Alias existentes, apodos en el nombre, DNI/teléfono normalizados y dirección conservada',()=>{
    for(const [q,id]of [['LuceroFicticio','CL-001'],['LuliFicticia','CL-002'],['aguila','CL-004'],['Hermano','CL-003'],['11111111','CL-001'],['01155550101','CL-001'],['011 5555 0101','CL-001'],['Prueba 123','CL-001']])assert(ids(buscar(q)).includes(id),q);
    assert.equal(buscar('AliasInventado').length,0);
    assert.equal(buscar('TextoFinanciero',[{id:'C',nombre:'Ficticio',notas:'TextoFinanciero'}]).length,0);
  });
  await test('Relevancia exacta, prefijo, palabra, parcial y otros campos; empates estables',()=>{
    const rows=[{id:'OTRO',nombre:'Independiente',alias:'Ana'},{id:'INTERNO',nombre:'Mariana'},{id:'PALABRA',nombre:'Otra Ana'},{id:'PREFIJO',nombre:'Anabel'},{id:'EXACTO',nombre:'Ana'},{id:'PREFIJO2',nombre:'Anabel Dos'}];
    assert.deepEqual(ids(buscar('ana',rows)),['EXACTO','PREFIJO','PREFIJO2','PALABRA','INTERNO','OTRO']);
    assert.deepEqual(ids(buscar('PALABRA',rows)),['PALABRA']);
  });
  await test('Nombres similares y familiares permanecen separados; solo se deduplica el mismo ID',()=>{
    const rows=[...datos.clientes,datos.clientes[0],{id:'DISTINTO',nombre:datos.clientes[0].nombre}];
    const list=ids(buscar('Mor Yol',rows));assert(list.includes('CL-001')&&list.includes('CL-003')&&list.includes('DISTINTO'));assert.equal(list.filter(id=>id==='CL-001').length,1);
    assert(!ids(buscar('',rows)).includes('CL-999'));
  });
  await test('Vacío conserva orden y registros; filtros y búsquedas no mutan los objetos originales',()=>{
    const before=JSON.stringify(datos),rows=structuredClone(datos.clientes).reverse();
    assert.deepEqual(ids(buscar('',rows)),rows.filter(r=>!r._deleted).map(r=>r.id));
    buscar('mor yol',datos.clientes);assert.equal(JSON.stringify(datos),before);
  });
  await test('Préstamos por código completo/parcial, nombre invertido, alias y datos históricos',()=>{
    const index=model.crearIndicePrestamos(datos.prestamos,datos.clientes),b=q=>ids(model.buscarEnIndice(index,q));
    assert.deepEqual(b('PR-025'),['PR-025']);assert.deepEqual(b('025'),['PR-025']);assert.deepEqual(b('PR025'),['PR-025']);
    assert(b('Mor Yol').includes('PH-001'));assert(b('Lucero').includes('PR-025'));assert(b('luli').includes('PR-029'));assert(!b('').includes('PR-999'));
    assert(b('Mor Yol').length>1);
  });
  await test('Contador general independiente del resultado y mensaje de ausencia claro',async()=>{
    const h=await harness(),general=h.general();h.query('clientes','NadaCoincide');assert.equal(h.general(),general);
    assert.match(h.resumen('clientes'),/Resultados encontrados: 0/);assert.match(h.d.getElementById('cli-list').textContent,/No se encontraron clientes con esa búsqueda/);
    h.query('clientes','Luisina');assert.deepEqual(h.resultados('clientes'),['CL-002']);assert.equal(h.general(),general);
    h.query('clientes','');assert.equal(h.resultados('clientes').length,5);
  });
  await test('Préstamos: buscador y todos los filtros previos conservan su significado',async()=>{
    const h=await harness();h.query('prestamos','Mor Yol');
    assert.deepEqual(new Set(h.resultados('prestamos')),new Set(['PR-025','PR-026']));assert.match(h.resumen('prestamos'),/incluye atrasados/);
    const expected={Activo:['PR-025'],Atrasado:['PR-026'],Pagado:['PH-001'],Renovado:['PR-028'],Ejecutado:['PR-031'],Cancelado:['PR-030'],Semanal:['PR-025'],Mensual:['PR-026']};
    for(const [filtro,wanted]of Object.entries(expected)){h.w.filtrarPrestamos(filtro);assert.deepEqual(h.resultados('prestamos'),wanted,filtro);assert.match(h.resumen('prestamos'),/Filtro:/);}
    h.w.filtrarPrestamos('todos');assert(h.resultados('prestamos').includes('PR-030'));assert(h.resultados('prestamos').includes('PH-001'));
    h.query('prestamos','PR-025');assert.deepEqual(h.resultados('prestamos'),['PR-025']);h.w.filtrarPrestamos('Pagado');assert.equal(h.resultados('prestamos').length,0);assert.match(h.resumen('prestamos'),/Pagados/);
  });
  await test('Búsqueda vacía restaura el orden anterior de clientes y préstamos por filtro',async()=>{
    const h=await harness(),c=h.resultados('clientes'),p=h.resultados('prestamos');
    h.query('clientes','Mor');h.query('clientes','');assert.deepEqual(h.resultados('clientes'),c);
    h.query('prestamos','Yol');h.query('prestamos','');assert.deepEqual(h.resultados('prestamos'),p);
    h.w.filtrarPrestamos('todos');const all=h.resultados('prestamos');h.query('prestamos','025');h.query('prestamos','');assert.deepEqual(h.resultados('prestamos'),all);
  });
  await test('Sin consultas locales/remotas por tecla y ninguna escritura al buscar',async()=>{
    const h=await harness(),before=JSON.stringify(h.w.__datos),reads=h.w.__lecturas;
    for(const q of ['M','Mor','Mor Yol','','025','']){h.query('clientes',q);h.query('prestamos',q);h.w.filtrarPrestamos('todos');}
    assert.equal(h.w.__lecturas,reads);assert.equal(h.w.__escrituras,0);assert.equal(JSON.stringify(h.w.__datos),before);
  });
  await test('Cambios sincronizados conservan consulta, filtro, foco y selección; actualizan nombres/alias',async()=>{
    const h=await harness();h.query('clientes','NUEVAFICTICIA');const input=h.d.getElementById('clientes-busqueda');input.focus();input.setSelectionRange(3,5);
    h.w.__datos.clientes.push({id:'CL-NUEVA',nombre:'NuevaFicticia'});await h.w.renderClientes();
    const nuevo=h.d.getElementById('clientes-busqueda');assert.equal(nuevo.value,'NUEVAFICTICIA');assert.equal(h.d.activeElement,nuevo);assert.equal(nuevo.selectionStart,3);assert.deepEqual(h.resultados('clientes'),['CL-NUEVA']);
    h.w.filtrarPrestamos('todos');h.query('prestamos','OtroAliasNuevo');assert.equal(h.resultados('prestamos').length,0);
    h.w.__datos.clientes[0].alias='OtroAliasNuevo';await h.w.renderPrestamos();assert.match(h.resumen('prestamos'),/Todos/);assert(h.resultados('prestamos').includes('PH-001'));
    h.w.__datos.prestamos.find(p=>p.id==='PR-025')._deleted=true;await h.w.renderPrestamos();assert(!h.resultados('prestamos').includes('PR-025'));
  });
  await test('Cuentas y bases locales distintas nunca reutilizan el índice ni el texto anterior',async()=>{
    const h=await harness();h.query('clientes','Yol');h.w._fbUser={uid:'UID-FICTICIO-B'};h.query('clientes','Yol');assert.equal(h.d.getElementById('cli-list').children.length,0);
    h.w.__dbLocal={};h.w.__datos={clientes:[{id:'B',nombre:'SoloOtraCuenta'}],prestamos:[],cuotas:[],prendas:[]};await h.w.renderClientes();assert.equal(h.d.getElementById('clientes-busqueda').value,'');assert.deepEqual(h.resultados('clientes'),['B']);
    h.w._fbUser=null;h.query('clientes','Solo');assert.equal(h.d.getElementById('cli-list').children.length,0);
  });
  await test('Una lectura pendiente de la cuenta anterior no sobrescribe la pantalla de otra cuenta',async()=>{
    const h=await harness(),original=h.w.dbAll,pendientes=[];
    h.w.dbAll=store=>new Promise(resolve=>pendientes.push({resolve,datos:JSON.parse(JSON.stringify(h.w.__datos[store]||[]))}));
    const anterior=h.w.renderClientes();h.w.dbAll=original;
    h.w._fbUser={uid:'CUENTA-FICTICIA-NUEVA'};h.w.__dbLocal={};h.w.__datos={clientes:[{id:'N',nombre:'NuevaCuentaFicticia'}],prestamos:[],cuotas:[],prendas:[]};
    await h.w.renderClientes();pendientes.forEach(p=>p.resolve(p.datos));await anterior;
    assert.deepEqual(h.resultados('clientes'),['N']);assert(!h.d.getElementById('cli-list').textContent.includes('Yolanda'));
  });
  await test('Listas vacías y eliminación recibida no dejan resultados ni contadores anteriores',async()=>{
    const h=await harness();h.w.__datos={clientes:[],prestamos:[],cuotas:[],prendas:[]};await h.w.renderClientes();await h.w.renderPrestamos();
    assert.match(h.general(),/registrados: 0/);assert.match(h.resumen('clientes'),/encontrados: 0/);assert.match(h.d.getElementById('cli-list').textContent,/Sin clientes/);
    assert.match(h.d.getElementById('prest-list').textContent,/Sin préstamos/);h.query('clientes','Yol');assert.match(h.d.getElementById('cli-list').textContent,/No se encontraron clientes/);
    h.query('prestamos','025');assert.equal(h.resultados('prestamos').length,0);
  });
  await test('Miles de registros: índice reutilizado y pintado en lotes cancelable al cambiar la consulta',async()=>{
    const rows=Array.from({length:5000},(_,i)=>({id:'CL-'+i,nombre:'Ficticio'+i+' ApellidoPrueba',telefono:'555'+i}));
    const start=performance.now(),index=model.crearIndiceClientes(rows),matches=model.buscarEnIndice(index,'ApellidoPrueba ficticio');
    assert.equal(matches.length,5000);assert(performance.now()-start<1500,'Índice/filtro demasiado lentos');
    const h=await harness();h.w.__datos.clientes=rows.slice(0,240);await h.w.renderClientes();assert.equal(h.d.querySelectorAll('#cli-list .op-client').length,60);
    h.query('clientes','Ficticio239');await new Promise(r=>setTimeout(r,80));assert.equal(h.d.querySelectorAll('#cli-list .op-client').length,1);assert.equal(h.resultados('clientes')[0],'CL-239');
  });
  await test('Consultas especiales no inyectan HTML ni ejecutan expresiones regulares',async()=>{
    const h=await harness();for(const q of ['<img src=x onerror=alert(1)>','[.*','\\','   '])h.query('clientes',q);
    assert.equal(h.d.querySelector('#cli-list img'),null);assert.equal(h.errors.length,0);assert.equal(h.w.__escrituras,0);
  });
  await test('Importación, contadores, finanzas, reglas y sincronización no cambian',()=>{
    const unchanged=['ui/importacion-clientes.js','services/ImportacionClientesService.js','ui/clientes.js','ui/prestamos.js','ui/caja.js','ui/carga-historica.js','core/helpers.js','firestore.rules',...fs.readdirSync(path.join(root,'services')).filter(f=>f.endsWith('.js')).map(f=>'services/'+f)];
    for(const file of new Set(unchanged))assert.equal(read(file).replace(/\r\n/g,'\n'),execFileSync('git',['show',BASE+':'+file],{cwd:root,encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n'),file);
    const old=execFileSync('git',['show',BASE+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:5e6});
    const allowed=['renderClientes','filterClientes','renderPrestamos','filtrarPrestamos'];
    for(const m of old.matchAll(/^(?:async )?function (\w+)\(/gm))if(!allowed.includes(m[1])){
      const re=new RegExp('(?:async )?function '+m[1]+'\\([^]*?\\n}');assert.equal(read('index.html').match(re)?.[0]?.replace(/\r\n/g,'\n'),old.match(re)?.[0]?.replace(/\r\n/g,'\n'),m[1]);
    }
    assert(read('index.html').includes("'prestamos':       ['prestamos','cuotas','prendas','clientes']"));
  });
  console.log(JSON.stringify({passed:passed.length,scope:'Datos ficticios + índices puros + JSDOM; sin Firebase ni escrituras',results:passed},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(()=>doms.forEach(d=>d.window.close()));
