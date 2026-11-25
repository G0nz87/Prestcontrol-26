// Fixture aislado compartido por JSDOM y Chrome. Solo datos inventados.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
function extract(name){const m=html.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}'));if(!m)throw Error(name);return m[0];}
const clientes=[
  {id:'CL-001',nombre:'Yolanda Moreno Ficticia',alias:'LuceroFicticio',telefono:'011 5555-0101',dni:'11111111',direccion:'Calle de Prueba 123',estado:'Activo'},
  {id:'CL-002',nombre:'Luisina Ficticia',apodo:'LuliFicticia',telefono:'',estado:'Activo'},
  {id:'CL-003',nombre:'Hermano de Yolanda Moreno Ficticia',telefono:'',estado:'Activo'},
  {id:'CL-004',nombre:'Álvaro Ficticio',aliases:['ÁguilaFicticia'],telefono:'55550104',estado:'Activo'},
  {id:'CL-005',nombre:'Morena Diferente Ficticia',estado:'Bloqueado'},
  {id:'CL-999',nombre:'Tombstone Ficticio',telefono:'55550999',_deleted:true}
];
const p=(id,estado,tipo,clienteId='CL-001',extra={})=>({id,estado,tipo,clienteId,
  clienteNombre:clientes.find(c=>c.id===clienteId)?.nombre || 'Nombre histórico ficticio',
  monto:100,total:110,cuota:55,nCuotas:2,interes:0.1,fecha:'2020-01-01',createdAt:'2020-01-01',...extra});
const prestamos=[p('PR-025','Activo','Semanal'),p('PR-026','Atrasado','Mensual'),
  p('PH-001','Pagado','Mensual','CL-001',{cargaInicial:true}),p('PR-027','Pagado','Semanal','CL-002'),
  p('PR-028','Pagado','Mensual','CL-001',{cerradoPor:'renovacion',prestamoRenovacionId:'PR-029'}),
  p('PR-029','Activo','Mensual','CL-002'),p('PR-030','Cancelado','Semanal'),p('PR-031','Ejecutado','Mensual'),
  p('PR-999','Activo','Semanal','CL-001',{_deleted:true})];
const datos={clientes,prestamos,cuotas:[],prendas:[]};
function fixtureScript(){
  const normal=read('core/busqueda.js').replace(/^export /gm,'');
  const ui=read('ui/buscadores.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  return `
window.__datos=${JSON.stringify(datos)};
window.__lecturas=0;window.__escrituras=0;window.__dbLocal={};window._fbUser={uid:'UID-FICTICIO-A'};
window.obtenerDBLocalHistorica=()=>window.__dbLocal;
window._fbDb={collection(){throw Error('Firebase prohibido en pruebas de búsqueda');}};
window.dbAll=async store=>{window.__lecturas++;return JSON.parse(JSON.stringify(window.__datos[store]||[])).filter(r=>!r._deleted);};
window.dbAllIncludeDeleted=async store=>{window.__lecturas++;return JSON.parse(JSON.stringify(window.__datos[store]||[]));};
for(const nombre of ['dbPut','dbDel','dbSoftDelete','addToSyncQueue','pushInmediato'])window[nombre]=()=>{window.__escrituras++;throw Error('Escritura prohibida');};
window.prestamosMap=lista=>new Map(lista.map(p=>[p.id,p]));
window.situacionCrediticiaCliente=()=>({prioridad:0,label:'Sin deuda',badgeClass:'badge-success',lineClass:'line-success'});
window.riesgoClienteService={calcular:()=>({nivelAuto:'SIN HISTORIAL',score:0}),efectivo:()=>({nivel:'SIN HISTORIAL'})};
window.esCuotaCobrable=()=>false;window.prendasActivasDePrestamo=()=>[];
window.emptyHTML=(icono,titulo,detalle='')=>'<div class="empty"><div class="empty-t">'+titulo+'</div>'+detalle+'</div>';
${read('core/helpers.js').replace(/^export /gm,'')}
${read('services/ImportacionClientesService.js').replace(/^export /gm,'')}
${extractFrom('ui/importacion-clientes.js','contadorClientesHTML')}
${normal}
${ui}
Object.assign(window,{contextoBuscadores,mismoContextoBuscadores,capturarBusqueda,prepararBuscador,aplicarBusquedaClientes,aplicarBusquedaPrestamos,buscarPrestamos});
let loanExpanded=null;
${html.match(/const PRIORIDAD_ESTADO_PRESTAMO = \{[^]*?\n};/)[0]}
${['ordenarPrestamosPorPrioridad','esPrestamoTipoVisible','cliItemHTML','loanItemHTML','renderClientes','filterClientes','renderPrestamos','filtrarPrestamos'].map(extract).join('\n')}
window.__ready=(async()=>{await renderClientes();await renderPrestamos();})();
`;}
function extractFrom(file,name){const s=read(file).replace(/^export /gm,'');const m=s.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}'));if(!m)throw Error(name);return m[0];}
function fixtureHTML(){return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrestControl: buscadores aislados</title>'+
  [...html.matchAll(/<style\b[^>]*>([^]*?)<\/style>/g)].map(m=>m[0]).join('')+
  '</head><body><main><div class="page on" id="pg-clientes"></div><div class="page on" id="pg-prestamos"></div></main><script>'+fixtureScript().replace(/<\/script/gi,'<\\/script')+'</script></body></html>';}
module.exports={root,read,extract,datos,fixtureScript,fixtureHTML};
