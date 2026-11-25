const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {fixtureHTML,deps}=require('./busqueda-unificada-fixture.cjs'),{chromium}=deps('playwright-core');
const results=[],screenshots=[];let browser;
async function test(name,fn){await fn();results.push(name);console.log('OK '+name);}
(async()=>{
  const executablePath=process.env.PRESTCONTROL_TEST_BROWSER||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';assert(fs.existsSync(executablePath));
  browser=await chromium.launch({executablePath,headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
  context.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  for(const width of [1440,768,390,320])await test('Inicio, nuevo préstamo, Prendas y voz a '+width+' px con datos sintéticos',async()=>{
    await page.goto('about:blank');await page.setViewportSize({width,height:900});await page.setContent(fixtureHTML());await page.evaluate(()=>__readyUnificada);
    await page.locator('#dash-cli-search').fill('Mor Yol');assert(await page.locator('#dash-cli-drop [data-cliente-id="CL-001"]').isVisible());
    await page.locator('#dash-cli-search').fill('Aguila');await page.locator('#dash-cli-drop [data-cliente-id="CL-004"]').click();
    await page.waitForFunction(()=>document.querySelector('#dash-cli-search')?.value==='Álvaro Ficticio');
    await page.evaluate(()=>openSheetPrestamo());await page.waitForFunction(()=>_acClientes.length>0);
    await page.locator('#pre-cliente-search').fill('Lucero');assert.equal(await page.locator('#pre-cliente-drop button').count(),1);
    await page.locator('#pre-cliente-drop button').click();assert.equal(await page.locator('#pre-cliente').inputValue(),'CL-001');
    await page.evaluate(()=>openSheetPrenda());await page.locator('#pda-cliente-busqueda').fill('Mor Yol');
    assert.equal(await page.locator('#pda-cliente').inputValue(),'');assert((await page.locator('#pda-cliente option').count())>=2);
    await page.evaluate(async()=>{__datos.clientes=[{id:'A',nombre:'Tabo'},{id:'B',nombre:'Tavo'}];await procesarComandoVoz('Buscá Tabo')});
    assert.equal(await page.locator('#sh-busqueda-voz .voz-cliente-opcion').count(),2);assert.equal(await page.evaluate(()=>__fichas.length),0);
    assert.match(await page.locator('[data-voz-transcripcion]').textContent(),/Buscá Tabo/);
    assert.match(await page.locator('#sh-busqueda-voz [data-cliente-id="B"]').textContent(),/aproximada/);
    for(const selector of ['#voz-cliente-consulta','.voz-cliente-opcion','[data-voz-resumen]']){
      const boxes=await page.locator(selector).evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}));
      for(const b of boxes)assert(b.left>=-1&&b.right<=width+1&&b.width>0,selector+' fuera de pantalla');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(width===1440||width===320){const file=path.join(os.tmpdir(),'prestcontrol-unificada-voz-'+width+'.png');await page.locator('#sh-busqueda-voz .sheet-box').screenshot({path:file});screenshots.push(file);}
    await page.locator('#sh-busqueda-voz [data-cliente-id="B"]').click();await page.waitForFunction(()=>__fichas.length===1);assert.equal(await page.evaluate(()=>__fichas[0]),'B');
  });
  await test('Corregir la transcripción con teclado mantiene la selección manual y no consulta por tecla',async()=>{
    await page.evaluate(async()=>{__fichas.length=0;await resolverClienteVoz('NadaFicticia')});
    const reads=await page.evaluate(()=>__lecturas);await page.locator('#voz-cliente-consulta').fill('Ta');
    assert.equal(await page.locator('.voz-cliente-opcion').count(),2);assert.equal(await page.evaluate(()=>__lecturas),reads);assert.equal(await page.evaluate(()=>__fichas.length),0);
    await page.locator('#voz-cliente-consulta').press('Tab');assert(await page.locator('.voz-cliente-opcion').first().evaluate(el=>document.activeElement===el));
    await page.keyboard.press('Enter');await page.waitForFunction(()=>__fichas.length===1);
  });
  await test('5000 identidades: búsqueda fonética acotada en memoria sin red ni escrituras',async()=>{
    await page.evaluate(()=>{__datos.clientes=Array.from({length:5000},(_,i)=>({id:'S-'+i,nombre:'PersonaFicticia '+i,estado:'Activo'}));__datos.clientes[4999].alias='Bichi'});
    const start=performance.now();await page.evaluate(()=>resolverClienteVoz('Vichi'));assert(performance.now()-start<3000);
    assert.equal(await page.locator('.voz-cliente-opcion').count(),1);assert.match(await page.locator('.voz-cliente-opcion').textContent(),/S-4999/);
    assert.equal(await page.evaluate(()=>__escrituras),0);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify({passed:results.length,browser:await browser.version(),scope:'Chrome headless, datos sintéticos, transcripciones simuladas; sin audio real ni Firebase',results,screenshots},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(async()=>{await browser?.close()});
