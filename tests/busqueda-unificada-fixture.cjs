// HTML/CSS y funciones reales; sin arrancar la app, Firebase o el service worker.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
const deps=createRequire(path.join(process.env.PRESTCONTROL_TEST_RUNTIME||path.join(os.tmpdir(),'prestcontrol-caja-test-runtime'),'package.json'));
const {JSDOM}=deps('jsdom'),base=require('./buscadores-fixture.cjs');
const {read,extract}=base;
function modulo(file,modulosES){return modulosES?'':`Object.assign(window,__cargarModulo(${JSON.stringify(read(file))}));`;}
function fixtureHTML({modulosES=false}={}){
  const parsed=new JSDOM(read('index.html'));
  const formas=['sh-prestamo','sh-prenda'].map(id=>parsed.window.document.getElementById(id).outerHTML).join('');parsed.window.close();
  const script=`
window.__navegacion=[];window.__fichas=[];window.__mensajes=[];window.__recognitions=[];
window.toast=m=>__mensajes.push(m);window.openClienteDetail=async id=>__fichas.push(id);
window.goPage=async id=>__navegacion.push(id);window.openSheetCliente=()=>__navegacion.push('formulario-cliente');
window.openSheet=id=>{document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on'));document.getElementById(id).classList.add('on');};
window.closeSheet=()=>document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on'));
window.dbGet=async(store,id)=>{__lecturas++;return __datos[store]?.find(r=>r.id===id)||null;};
window.limpiarAutorizacionRiesgoPrestamo=()=>{};window.invalidarAutorizacionRiesgoSiCambiaCliente=()=>{};
window.metricasFinancierasService={calcularMetricasCliente:()=>new Proxy({},{get:()=>0})};
window.SpeechRecognition=class{constructor(){__recognitions.push(this)}start(){this.onstart?.()}abort(){this.onerror?.({error:'aborted'});this.onend?.()}};
var appDesbloqueada=true,DB=__dbLocal,dashTab='cliente',dashClienteId=null;
function __cargarModulo(source){
 const names=[...source.matchAll(/^export (?:async )?(?:function|class|const) (\\w+)/gm)].map(m=>m[1]);
 return new Function(source.replace(/^import .*;\\r?\\n/gm,'').replace(/^export /gm,'')+'\\nreturn {'+names.join(',')+'};')();
}
${modulo('core/busqueda-voz.js',modulosES)}
${modulo('ui/selectores-clientes.js',modulosES)}
${modulo('ui/busqueda-voz.js',modulosES)}
${modulo('ui/prendas.js',modulosES)}
${modulo('ui/prestamos.js',modulosES)}
var _acClientes=[];
${['renderDashboard','buildDashCliente','filtrarDashCliente','switchDashCliente','limpiarSeleccionDashCliente','filtrarClientesAC','seleccionarClienteAC','limpiarClienteAC','clienteACItemHTML',
 'normalizarTextoVoz','initComandosVoz','setVoiceListening','detenerComandosVoz','iniciarComandoVoz','buscarCoincidenciasClienteVoz','mostrarBusquedaClienteVoz','resolverClienteVoz',
 'limpiarIntencionNavegacionVoz','extraerNombreClienteVoz','comandoVozRequiereConfirmacion','procesarComandoVoz'].map(extract).join('\n')}
const SpeechRecognitionAPI=window.SpeechRecognition;let voiceRecognition=null,voiceListening=false;
window.__readyUnificada=(async()=>{await __ready;${modulosES?"await import('/ui/index.js');window.__vozES=await import('/ui/busqueda-voz.js');":''}initComandosVoz();await renderDashboard();})();
`;
  return base.fixtureHTML().replace('</main>','<div class="page on" id="pg-dashboard"></div><div class="page on" id="pg-prendas"></div></main>')
    .replace('</body>',formas+'<button id="voice-btn" aria-label="Iniciar comando por voz">Micrófono simulado</button><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body>');
}
module.exports={fixtureHTML,deps,read,extract};
