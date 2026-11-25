// Chrome con perfil temporal, HTML aislado y red bloqueada. Nunca abre producción.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const deps=createRequire(path.join(process.env.PRESTCONTROL_TEST_RUNTIME||path.join(os.tmpdir(),'prestcontrol-caja-test-runtime'),'package.json'));
const {chromium}=deps('playwright-core');
const {fixtureHTML}=require('./buscadores-fixture.cjs');
const browserPath=process.env.PRESTCONTROL_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const results=[],screenshots=[];let browser;
async function test(name,fn){await fn();results.push(name);console.log('OK '+name);}
(async()=>{
  assert(fs.existsSync(browserPath),'Falta Chrome: establecer PRESTCONTROL_TEST_BROWSER');
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.setContent(fixtureHTML());await page.evaluate(()=>window.__ready);
  for(const width of [1440,768,390,320])await test('Interfaz real a '+width+' px: búsqueda, filtros y controles dentro de pantalla',async()=>{
    await page.setViewportSize({width,height:900});
    await page.locator('#clientes-busqueda').fill('Mor Yol');
    await page.locator('#prestamos-busqueda').fill('Mor Yol');
    assert.equal(await page.locator('#cli-list .op-client').count(),2);
    await page.locator('[data-prest-filtro="todos"]').click();
    assert.match(await page.locator('#prestamos-resultados').textContent(),/Todos: cartera completa/);
    for(const selector of ['#clientes-busqueda','#clientes-resultados','#prestamos-busqueda','#prestamos-resultados','#prest-filtros .pf-btn']){
      const boxes=await page.locator(selector).evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};}));
      for(const b of boxes)assert(b.left>=-1&&b.right<=width+1&&b.width>0,selector+' fuera de pantalla: '+JSON.stringify(b));
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if([1440,390,320].includes(width)){
      for(const tipo of ['clientes','prestamos']){
        const file=path.join(os.tmpdir(),'prestcontrol-buscadores-'+tipo+'-'+width+'.png');
        await page.locator('#pg-'+tipo).screenshot({path:file});screenshots.push(file);
      }
    }
  });
  await test('Teclado real: una letra, código parcial, contador independiente y cero lecturas por tecla',async()=>{
    const before=await page.evaluate(()=>({reads:__lecturas,writes:__escrituras,general:document.querySelector('.clientes-contador').textContent,datos:JSON.stringify(__datos)}));
    await page.locator('#clientes-busqueda').fill('');await page.locator('#clientes-busqueda').pressSequentially('A');
    assert((await page.locator('#cli-list .op-client').count())>0);
    await page.locator('#prestamos-busqueda').fill('025');assert.equal(await page.locator('#prest-list .op-loan').count(),1);
    await page.locator('[data-prest-filtro="Pagado"]').click();assert.equal(await page.locator('#prest-list .op-loan').count(),0);
    assert.match(await page.locator('#prestamos-resultados').textContent(),/Resultados encontrados: 0.*Pagados/);
    const after=await page.evaluate(()=>({reads:__lecturas,writes:__escrituras,general:document.querySelector('.clientes-contador').textContent,datos:JSON.stringify(__datos)}));
    assert.deepEqual(after,before);
  });
  await test('Cambio sincronizado simulado conserva consulta, foco, cursor y filtro',async()=>{
    await page.locator('#clientes-busqueda').fill('NuevaFicticia');
    await page.evaluate(async()=>{
      const input=document.getElementById('clientes-busqueda');input.focus();input.setSelectionRange(2,4);
      __datos.clientes.push({id:'CL-NUEVA',nombre:'NuevaFicticia'});await renderClientes();
    });
    assert.equal(await page.locator('#cli-list .op-client').count(),1);
    const focus=await page.evaluate(()=>({id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,value:document.activeElement.value}));
    assert.deepEqual(focus,{id:'clientes-busqueda',start:2,end:4,value:'NuevaFicticia'});
    await page.locator('[data-prest-filtro="todos"]').click();await page.locator('#prestamos-busqueda').fill('Luli');
    await page.evaluate(async()=>{__datos.clientes.find(c=>c.id==='CL-002').apodo='OtroApodoFicticio';await renderPrestamos();});
    assert.equal(await page.locator('#prestamos-busqueda').inputValue(),'Luli');
    assert.match(await page.locator('#prestamos-resultados').textContent(),/Resultados encontrados: 0.*Todos/);
  });
  await test('5000 clientes: la entrada sigue respondiendo y una consulta nueva cancela resultados anteriores',async()=>{
    await page.evaluate(async()=>{
      __datos.clientes=Array.from({length:5000},(_,i)=>({id:'F-'+i,nombre:'Ficticio'+i+' ApellidoPrueba',estado:'Activo'}));
      document.getElementById('clientes-busqueda').value='';await renderClientes();
    });
    const start=performance.now();await page.locator('#clientes-busqueda').fill('Ficticio4999');
    await page.waitForFunction(()=>document.querySelectorAll('#cli-list .op-client').length===1);
    const elapsed=performance.now()-start;assert(elapsed<1500,'Entrada demorada: '+elapsed);
    await page.waitForTimeout(100);assert.equal(await page.locator('#cli-list .op-client').count(),1);
    assert.match(await page.locator('#clientes-resultados').textContent(),/Resultados encontrados: 1/);
    console.log('LATENCIA consulta 5000: '+Math.round(elapsed)+' ms');
  });
  await test('5000 préstamos: código exacto dentro del filtro sin bloquear la entrada ni leer datos',async()=>{
    await page.evaluate(async()=>{
      __datos.prestamos=Array.from({length:5000},(_,i)=>({id:'PR-'+String(i).padStart(5,'0'),clienteId:'F-0',clienteNombre:'Ficticio0 ApellidoPrueba',
        estado:'Activo',tipo:'Mensual',fecha:'2020-01-01',monto:100,total:110,cuota:110,nCuotas:1}));
      document.getElementById('prestamos-busqueda').value='';await renderPrestamos();
    });
    const reads=await page.evaluate(()=>__lecturas),start=performance.now();await page.locator('#prestamos-busqueda').fill('PR-04999');
    await page.waitForFunction(()=>document.querySelectorAll('#prest-list .op-loan').length===1);
    assert(performance.now()-start<1500);await page.waitForTimeout(100);assert.equal(await page.locator('#prest-list .op-loan').count(),1);
    assert.equal(await page.evaluate(()=>__lecturas),reads);assert.match(await page.locator('#prestamos-resultados').textContent(),/Resultados encontrados: 1.*Todos/);
  });
  await test('Cambio de cuenta elimina índice previo; no hay errores, red ni escrituras',async()=>{
    await page.evaluate(()=>{_fbUser={uid:'OTRA-CUENTA-FICTICIA'};filterClientes('Ficticio');});
    assert.equal(await page.locator('#cli-list .op-client').count(),0);
    assert.equal(await page.evaluate(()=>__escrituras),0);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify({passed:results.length,browser:await browser.version(),scope:'Chrome headless aislado; red bloqueada; datos ficticios',results,screenshots},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
