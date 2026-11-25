# PrestControl V1 — Buscadores de Clientes y Préstamos

Fecha: 24/11/2026. Base: `3be34e8b67591b2a5ecc231b4b900ab1c6e4c2c7`, repositorio `G0nz87/Prestcontrol-26`, rama `main`.

Estado: **IMPLEMENTACIÓN Y AUDITORÍA CERRADAS — APTO CON OBSERVACIONES NO BLOQUEANTES**. Publicación exclusivamente de Buscadores V1 autorizada por el usuario el 24/11/2026. La validación en producción queda **PENDIENTE** hasta que el operador compruebe sus PC y celulares reales; la comprobación del despliegue y sus archivos no sustituye esa aceptación. No se consultaron ni modificaron datos reales; los 254 clientes indicados por el usuario no se utilizaron para pruebas.

## A. Auditoría del comportamiento anterior

- Clientes: `renderClientes` y `filterClientes` activos en `index.html`. Admitía una letra y fragmentos de nombre/dirección ignorando mayúsculas y tildes mediante el normalizador de voz; también DNI y teléfono mediante coincidencia literal. No combinaba palabras en diferente orden, no ordenaba por relevancia y no buscaba campos explícitos de alias/apodo. El listado se ordenaba por situación crediticia y nombre; se conservan esos criterios al vaciar la consulta.
- Préstamos: `renderPrestamos` y `filtrarPrestamos` activos en `index.html`. No había entrada de búsqueda. Los botones alternaban filtros de cartera vigente, estado o modalidad. Existía una rama interna `todos`, sin botón visible. El orden previo era prioridad de estado y recencia, con las reglas contractuales ya existentes para atrasados.
- Selector al crear un préstamo: `filtrarClientesAC`, coincidencia por frase de nombre/teléfono, ocho sugerencias y protección de clientes bloqueados. Se conserva íntegro.
- Dashboard/entrada a un cliente: `filtrarDashCliente` sobre elementos ya cargados y buscador por voz con su normalización propia. Se conservan íntegros.
- Cobranza: navegación mediante clientes, dashboard, listas de cuotas y filtros ya existentes. No se introduce otro buscador ni se modifica el flujo de cobro.

El helper nuevo se comparte únicamente entre los dos listados pedidos. Mantiene su normalización fuera del analizador de comandos de voz para no cambiar la interpretación de instrucciones ni acoplar el índice de préstamos a ese módulo. Unificar todos los selectores, navegación y voz queda fuera de esta mejora y puede evaluarse en V2.

## B. Nuevo buscador de Clientes

Permite nombre completo, apellido, fragmentos desde una letra, todas las palabras en cualquier orden, teléfono, DNI, dirección y alias/apodo ya registrados. Se conservan búsquedas por dirección que admitía el listado anterior. También admite código de cliente sin cambiar el identificador.

Los términos se normalizan en memoria: mayúsculas, tildes, espacios repetidos y separadores. Para teléfono/DNI se incluye una representación numérica compacta, permitiendo escribir una secuencia sin sus espacios o guiones. Alias provienen de `alias`, `apodo`, `aliases` o `apodos`, además de los que estén literalmente en `nombre`. No se inventan alias, ni se utilizan notas/observaciones como nombres.

Todas las palabras de la consulta deben encontrarse entre los campos admitidos; no se exige una longitud mínima. Ejemplo ficticio: `Mor Yol` encuentra `Yolanda Moreno Ficticia`.

Junto a la entrada se muestra **Resultados encontrados: X**. La búsqueda no cambia el total de clientes, con teléfono y sin teléfono; esos contadores siguen usando exactamente la implementación publicada. Si no hay coincidencias se muestra **No se encontraron clientes con esa búsqueda**. Con consulta vacía se restaura el orden anterior; con cero clientes se conserva el aviso para agregar el primero.

## C. Nuevo buscador de Préstamos y filtros

Busca por nombre del cliente guardado en el préstamo, nombre actual del cliente vinculado, alias registrados de ese cliente y código del préstamo. Ejemplos ficticios: `Mor Yol`, `PR-025`, `PR025`, `025`. Reconoce también códigos históricos como `PH-001` sin modificarlos. No busca observaciones financieras, no fusiona préstamos y conserva por separado todos los préstamos de una persona.

Se agrega el botón visible **Todos** que utiliza la rama `todos` ya existente. Todos los botones anteriores permanecen. El resumen muestra cantidad y significado del filtro aplicado:

| Filtro | Alcance conservado |
| --- | --- |
| Activos, predeterminado | Cartera vigente; incluye atrasados y otros estados no terminales. Excluye Pagado, Cancelado y Ejecutado. |
| Al día | Estado `Activo`. |
| Atrasados | Estado `Atrasado`. |
| Pagados | Estado `Pagado`, excluyendo cierres por renovación/renovación de capital. |
| Renovados | Estado `Pagado` con cierre por renovación/renovación de capital. |
| Ejecutados | Estado `Ejecutado`. |
| Semanales / Mensuales | Modalidad correspondiente y cartera vigente, según la función previa `esPrestamoTipoVisible`. |
| Todos | Toda la cartera disponible localmente, incluidos históricos, pagados, renovados, cancelados y ejecutados, excluyendo tombstones. |

Los filtros continúan siendo alternativas entre sí, como antes; se combinan con el texto de búsqueda. No se implementa una matriz nueva de estado por modalidad. Por ejemplo, un código pagado no aparece bajo Activos, y el resumen indica ese alcance; se puede elegir Todos o Pagados sin perder lo escrito. Se conserva también la rama interna de Cancelados.

## D. Relevancia, estabilidad y rendimiento

Prioridades de búsqueda:

1. Nombre o código exacto normalizado.
2. Nombre/código que comienza con la consulta completa.
3. Todos los términos al comienzo de palabras de nombre/código, sin depender del orden.
4. Todos los términos en otras posiciones de nombre/código.
5. Coincidencia en otros campos admitidos, o combinación de estos con nombre/código.

Entre resultados de igual relevancia se conserva la posición del listado original. Una consulta vacía no reordena por relevancia. Se excluyen tombstones y duplicaciones del mismo ID; dos IDs diferentes nunca se fusionan por tener el mismo nombre.

Se crea un índice normalizado al cargar o actualizar el listado. Cada tecla filtra ese índice: no vuelve a consultar IndexedDB ni Firebase, no escribe registros ni agrega operaciones de sincronización. Las fichas usan los renderizadores existentes y se pintan en bloques de 60 por frame para dejar responder a la entrada mientras se muestran muchos resultados. Una consulta nueva cancela los bloques pendientes de la anterior; el contador informa siempre el total completo, sin truncar resultados.

El estado de búsqueda vive en el elemento de la página y se valida contra UID y referencia de la base local. Cambiar de cuenta/base invalida el índice y la consulta anteriores. Una lectura pendiente de otra cuenta no puede sustituir los resultados actuales.

## E. Actualizaciones recibidas

El render conserva consulta, filtro activo, foco y selección del texto cuando continúa la misma cuenta/base. Reindexa los registros recibidos, recalcula coincidencias y mantiene la búsqueda activa. También elimina resultados que hayan pasado a tombstone.

La única ampliación relacionada con sincronización es **de interfaz**: la dependencia de la página Préstamos incluye ahora `clientes`, para que un cambio de nombre/alias del cliente vuelva a renderizar la búsqueda. El cuerpo de `iniciarSyncRealtime`, el envío de cola, las reglas, autenticación y sincronización financiera mantienen su código previo.

## F. Archivos

| Archivo | Cambio |
| --- | --- |
| `core/busqueda.js` | Normalización, índices de lectura y relevancia compartidos. |
| `ui/buscadores.js` | Estado por cuenta/base, resultados, alcance, foco y pintado por bloques. |
| `index.html` | Entradas y contadores de coincidencias; integración de cuatro funciones de listado/búsqueda; botón Todos; dependencia visual de Clientes para Préstamos y estilo acotado del resumen. |
| `ui/index.js` | Registro de los handlers de búsqueda. |
| `sw.js` | Caché nueva y precache de los dos módulos. |
| `tests/buscadores-fixture.cjs` | Fixture ficticio compartido: HTML/CSS y renderizadores reales, sin iniciar la aplicación ni Firebase. |
| `tests/buscadores.test.cjs` | Pruebas de índice, DOM, filtros, aislamiento, sincronización simulada e invariantes. |
| `tests/buscadores-browser.test.cjs` | Pruebas en Chrome headless, responsive y teclado real, con red bloqueada. |
| `tests/clientes-importacion.test.cjs` | Adaptación del harness para cargar el nuevo listado y excluir sus cuatro funciones de comparación histórica; las invariantes financieras y de importación se conservan. |
| `tests/clientes-verificacion-final.test.cjs` | Expectativas de la nueva caché y comprobación offline de sus nuevas dependencias. |
| `docs/BUSCADORES_CLIENTES_PRESTAMOS_V1.md` | Diagnóstico, alcance, resultados y límites de esta mejora. |
| `docs/ROADMAP_MAESTRO.md` | Cierre de implementación y auditoría; validación en producción pendiente, sin avanzar V2. |

Los archivos funcionales de importación y contadores, handlers de altas/eliminación, servicios financieros, Carga histórica, reglas y generador de IDs permanecen idénticos a la base publicada.

## G. Pruebas y resultados

Datos exclusivamente ficticios; no se abrió el Excel privado ni la aplicación productiva. Dependencias de prueba en la carpeta temporal, sin instalar paquetes de producción en el repositorio.

| Ejecución | Resultado |
| --- | --- |
| `node tests/buscadores.test.cjs` | 18/18: índices, relevancia, DOM, filtros, campos, históricos, múltiples préstamos, cuentas, lecturas pendientes, listas vacías, sin escrituras y conservación de funciones. |
| `node tests/buscadores-browser.test.cjs` | 9/9: Chrome headless, PC/tablet/celular a 1440, 768, 390 y 320 px; teclado, filtros, foco/cursor, 5000 clientes, 5000 préstamos y cambio de cuenta. |
| `node tests/clientes-importacion.test.cjs` | 23/23 regresiones locales de importación/contadores, JSDOM e IndexedDB ficticio; sin volver a ejecutar el escenario remoto aprobado. |
| `node tests/clientes-verificacion-final.test.cjs` | 8/8: conservación de exportaciones/respaldos/cola y ciclo de actualización/offline del shell. |

Total: **58 verificaciones**. No se repiten auditorías financieras aprobadas. Se compara contra la base publicada el contenido completo de servicios y módulos protegidos; todas las funciones inline anteriores se conservan salvo `renderClientes`, `filterClientes`, `renderPrestamos` y `filtrarPrestamos`. No se cambian cálculos en los renderizadores de fichas.

El navegador utilizó Chrome instalado, perfil temporal nuevo y todos los intentos de red bloqueados; registró cero solicitudes de red, errores de página y escrituras. La consulta específica sobre 5000 clientes ficticios respondió aproximadamente en 80 ms en la primera ejecución: es una medición del fixture, no una garantía de tiempo para toda cuenta/equipo. Se guardaron capturas de ambos listados a 1440, 390 y 320 px en la carpeta temporal, fuera del repositorio.

Se comprueban también sintaxis de los módulos/scripts, script inline completo y `git diff --check`.

Para reproducir: reutilizar el runtime temporal de pruebas de Clientes con `jsdom@26.1.0`, `fake-indexeddb@6.2.4` y `xlsx@0.18.5`. La prueba de navegador añade `playwright-core@1.56.1` al mismo runtime y utiliza Chrome instalado; `PRESTCONTROL_TEST_BROWSER` permite indicar otra ruta de Chromium. No descarga un navegador ni utiliza perfiles reales. Los fixtures no cargan Firebase, service worker, login ni inicialización de la aplicación.

## H. Shell PWA

Versión preparada: **`prestcontrol-shell-v71-buscadores-v1`**. Anterior: `prestcontrol-shell-v71-clientes-v1`. Se agregan `core/busqueda.js` y `ui/buscadores.js` al precache. El cambio separa la caché de esta entrega y distribuye sus dependencias sin módulos faltantes cuando se autorice publicar.

Se conserva el mecanismo publicado de instalación, activación, registro sin caché y recarga diferida mientras existan formularios u operaciones abiertas. No se borra IndexedDB, registros ni colas; no se cambia la versión de base, sesión ni identificadores.

## I. Límites y uso

- La publicación fue autorizada exclusivamente mediante commit y push a `origin/main` y despliegue automático de Netlify. No incluye reglas Firebase ni otras funcionalidades. El commit y despliegue efectivos deben comprobarse después del push y se informan al operador al finalizar.
- Falta la comprobación del operador en PC/celulares físicos y con su cuenta real después de publicar; las capturas y pruebas automáticas usan datos ficticios.
- La búsqueda es por fragmentos y términos, no por similitud fonética ni corrección de errores de escritura. No puede reconocer un alias que no esté registrado.
- La búsqueda utiliza lo sincronizado localmente. Si el equipo está offline, no puede mostrar cambios todavía no recibidos, aunque puede buscar en lo ya disponible.
- Con consulta vacía o muchos resultados, se muestran todos en orden mediante bloques. La carga original del listado y su evaluación crediticia/renovación conservan sus costes previos; no se refactorizan servicios financieros como parte de esta mejora.
- Selectores de préstamo, voz, dashboard, cobros y navegación permanecen con su funcionamiento anterior. Su eventual unificación se reserva para otra tarea/V2.

Después de publicar: abrir Clientes o Préstamos, escribir desde una letra y revisar **Resultados encontrados**. En Préstamos, elegir el filtro apropiado o **Todos** para ampliar el alcance. Borrar la consulta restaura el orden previo; escribir no cambia ningún dato. Hacer estas comprobaciones en PC y en cada celular/PWA; volver a abrir online después de terminar operaciones y cerrar formularios, conservando el almacenamiento y las colas. No reinstalar ni borrar los datos del sitio.

## J. Git y estado

Base conservada `3be34e8b67591b2a5ecc231b4b900ab1c6e4c2c7`; rama `main`. Se autorizan únicamente los doce archivos detallados, con mensaje `feat(busqueda): mejora buscadores de clientes y prestamos V1`, push normal y publicación automática de Netlify. Sin planillas ni datos personales reales agregados. El cierre documental modifica únicamente este informe y el roadmap; el código y las pruebas auditados se conservan.

**APTO CON OBSERVACIONES NO BLOQUEANTES para la publicación autorizada. Validación en producción pendiente del operador.**

## K. Auditoría independiente y cierre autorizado (24/11/2026)

Resultado comunicado por el usuario: **APTO CON OBSERVACIONES NO BLOQUEANTES**. El auditor volvió a superar **58/58 verificaciones**, realizó pruebas independientes adicionales satisfactorias y no encontró defectos nuevos críticos ni importantes. Confirmó búsqueda vacía equivalente, compatibilidad con filtros, ausencia de modificaciones financieras e integridad del shell PWA. Informó **115 archivos verificados por SHA-256 sin modificaciones durante su auditoría**.

Observación aceptada: existe una condición de carrera **preexistente** en `renderClientes` y `renderPrestamos`. Una lectura antigua de la misma cuenta puede terminar después de otra más reciente y mostrar temporalmente resultados obsoletos. El auditor la reprodujo también en el HEAD base `3be34e8`; no fue introducida por los buscadores. Queda como **pendiente técnico de V2**, o para revisión específica anticipada si se manifiesta en el uso normal de V1. Por decisión expresa del usuario, **no se corrige ahora ni se amplía el alcance**. La protección contra lecturas de otra cuenta no equivale a ordenar lecturas concurrentes de la misma cuenta.

Límites de evidencia y cobertura: el dictamen se registra como resultado de la auditoría independiente comunicado por el usuario; no se adjuntó su manifiesto con los 115 valores SHA-256 ni el detalle de las pruebas adicionales. El cierre verifica el estado entregado, el diff frente a la base y una nueva instantánea local de 115 archivos para detectar modificaciones durante la publicación; no atribuye a esos hashes una comparación numérica con el manifiesto independiente no disponible. Las pruebas automatizadas usan fixtures ficticios, sincronización simulada y Chrome headless aislado; no validan cuentas productivas, redes reales, todos los órdenes de finalización concurrente ni dispositivos físicos. Las verificaciones de archivos publicados no inician la aplicación ni prueban sesiones o datos reales.

Controles finales previos al commit: ubicación/repositorio/rama y base esperados; `origin/main` y producción Netlify todavía en `3be34e8`; solo los doce archivos del alcance; shell exacto `prestcontrol-shell-v71-buscadores-v1` y ambos módulos nuevos en precache; verificación acotada de buscadores, compatibilidad y PWA, sintaxis e integridad, revisión de privacidad y `git diff --check`. Se mantiene el código auditado, sin repetir auditorías financieras ni probar con datos reales. La publicación efectiva se confirma contra el nuevo commit y los bytes servidos; la aceptación funcional en PC/celulares permanece pendiente incluso si Netlify está `ready`.

Resultado de esos controles de cierre: **35/35 verificaciones pertinentes aprobadas** (18 de buscadores, 9 de Chrome aislado y 8 de compatibilidad/PWA), sintaxis y `git diff --check` satisfactorios; 33 entradas del shell disponibles localmente. No se repitió la suite completa de 58 ni auditorías financieras. La instantánea SHA-256 de los 115 archivos confirma que solo este informe y el roadmap cambiaron durante el cierre; código y pruebas intactos. Preparación limitada a los doce archivos indicados, sin Excel, datos privados, respaldos, credenciales ni temporales.
