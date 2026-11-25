const assert=require('node:assert/strict');
const funcionesBusqueda=['renderClientes','filterClientes','renderPrestamos','filtrarPrestamos',
  'renderDashboard','buildDashCliente','filtrarDashCliente','filtrarClientesAC','detenerComandosVoz','iniciarComandoVoz',
  'buscarCoincidenciasClienteVoz','mostrarBusquedaClienteVoz','resolverClienteVoz','extraerNombreClienteVoz','procesarComandoVoz'];
const gancho="          if (storesDelCiclo.has('clientes')) await Promise.resolve(window.actualizarSelectoresClientesAbiertos?.()).catch(error => console.warn('[BUSQUEDA] No se pudieron actualizar los selectores', error));\n";
const normalizar=s=>s.replace(/\r\n/g,'\n');
const sinGanchoVisual=s=>normalizar(s).replace(gancho,'')
  .replaceAll('  if (opciones?.vigenteVoz && !opciones.vigenteVoz()) return;\n','')
  .replaceAll('  if (opts.vigenteVoz && !opts.vigenteVoz()) return;\n','');
function sinFunciones(source,names){let s=normalizar(source);for(const name of names){const re=new RegExp('(?:export )?(?:async )?function '+name+'\\([^]*?\\n}');assert(re.test(s),name);s=s.replace(re,'/* FUNCION DE BUSQUEDA '+name+' */');}return s;}
function assertModuloProtegido(file,actual,anterior){
  const permitidas=file==='ui/prestamos.js'?['openSheetPrestamo']:file==='ui/prendas.js'?['openSheetPrenda','renderPrendas']:[];
  const limpiar=s=>sinFunciones(s,permitidas).replace(/^import \{ crearIndicePrendas, buscarEnIndice \} from '\.\.\/core\/busqueda\.js';\n/m,'');
  assert.equal(limpiar(actual),limpiar(anterior),file+': codigo fuera de selectores/renders intacto');
}
module.exports={funcionesBusqueda,sinGanchoVisual,sinFunciones,assertModuloProtegido};
