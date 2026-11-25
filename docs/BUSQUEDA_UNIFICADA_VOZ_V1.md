# PrestControl V1 — Búsqueda unificada y coincidencias de voz

Fecha: 25/11/2026. Base publicada: `49821abe2d62d4cb24a3ce81a9b6b31f11e7de5d`, `G0nz87/Prestcontrol-26`, rama `main`.

Estado: **APTO PARA PUBLICACIÓN — IMPLEMENTACIÓN Y AUDITORÍA CERRADAS**. La reauditoría independiente comunicada por el usuario aprobó la corrección de cancelación y cerró el hallazgo bloqueante de la primera auditoría. Commit, push normal a `main` y publicación automática por Netlify expresamente autorizados para estos 19 archivos; controles y condiciones en la sección 10. **Aceptación funcional en dispositivos reales y micrófono pendientes**. El usuario informó que verificó previamente en producción el buscador de Clientes, el contador de 254 clientes y el estado Sincronizado. Ese dato se registra como comprobación del usuario, sin acceder a su cuenta ni usar sus clientes en pruebas; no equivale a validar esta actualización, Préstamos o todos los dispositivos.

## 1. Diagnóstico

- Clientes y Préstamos ya utilizaban `core/busqueda.js` y `ui/buscadores.js`. Se mantienen sus filtros, contadores y comportamiento publicado; la fonética no se incorpora a búsquedas escritas.
- Inicio → Cliente filtraba los nombres visibles por una sola frase, sin normalización de tildes, alias ni palabras invertidas. Su alcance ya incluía clientes activos sin préstamos; no se agrega una restricción de historial ni se cambian sus métricas. Ahora también se comprueba la cuenta/base que originó la lectura y se conserva consulta/foco al actualizar esa vista.
- Nuevo préstamo tenía otra comparación de nombre/teléfono, con un máximo de ocho sugerencias y bloqueo administrativo. Se reemplaza exclusivamente la búsqueda y carga de esas sugerencias, conservando la selección, validación de riesgo y operación financiera.
- Prendas tenía búsqueda literal sobre ID, descripción, nombre, serie, IMEI y otros metadatos, más selectores nativos de clientes. Se reutiliza el motor común sin cambiar relaciones, estados, ventas ni importes.
- Voz usa la API de reconocimiento del navegador, `es-AR`, una frase y una alternativa. Después normaliza el comando y aplica su parser de navegación. La comparación de clientes anterior solo buscaba una frase dentro de `nombre`; ignoraba alias, palabras invertidas y transcripciones parecidas. Abría automáticamente el único resultado, incluso parcial. Se sustituye esa comparación y resolución, conservando destinos y barreras de comandos existentes.

Se comprobó el defecto de comparación usando transcripciones sintéticas. **No se puede atribuir a audio/micrófono un error observado solo en texto ni asegurar que el navegador transcriba correctamente un apodo.** No se cambió el proveedor de reconocimiento ni se añadieron servicios externos o dependencias.

## 2. Inventario y alcance

| Campo o módulo | Resolución |
| --- | --- |
| Inicio → Cliente | Motor compartido sobre clientes `Activo` no eliminados, incluidos los que no tienen historial. Nombre, alias, fragmentos, términos invertidos, DNI/teléfono y demás campos del índice publicado. Consulta vacía muestra una indicación, sin desplegar toda la cartera. Máximo de 12 sugerencias, con aviso para precisar. El dashboard individual conserva exactamente su cuerpo de métricas e historial. |
| Clientes | Se conserva el buscador publicado y sus contadores generales. |
| Préstamos | Se conserva la búsqueda por cliente/alias/código, históricos, múltiples préstamos y filtros publicados. |
| Nuevo préstamo | Índice compartido; ocho sugerencias. Conserva clientes Activo/Bloqueado visibles y la prohibición de seleccionar bloqueados. No selecciona automáticamente al escribir ni cambia validación/guardado. |
| Prendas: inventario | Índice común con identidad del cliente y metadatos anteriores de la prenda. Conserva los filtros de estado/cliente y la agrupación por préstamo. La relevancia se aplica antes de agrupar y, sin consulta, permanece el orden seleccionado. |
| Prendas: selectores de cliente | Campo de búsqueda junto al selector nativo de alta/edición y al filtro de inventario. Ordena opciones por relevancia sin disparar `change` ni cambiar el cliente seleccionado. Si este queda fuera de la búsqueda, lo conserva y lo informa. Un cliente fijado por otro flujo continúa fijado y su filtro se desactiva junto con el selector. |
| Cobros, Hoy, Atrasadas y pagos | No existe un buscador de clientes independiente: se llega mediante las fichas, listas de cuotas y navegación anteriores. No se agrega otro ni se cambian cobros/cuotas. La navegación por voz hacia estas pantallas sigue disponible. |
| Carga histórica y Caja | Revisadas para delimitar alcance. Sus selectores, módulos y operaciones permanecen intactos por restricción expresa, incluidos los selectores nativos de Carga histórica. |
| Otros campos | Formularios de nombre/DNI/teléfono editan datos y no son buscadores. Selecciones de préstamo/cuota mantienen su relación y alcance; no se convierten en búsquedas globales. |

Se reutilizan normalización, índices y relevancia de `core/busqueda.js`. Solo se exporta su lector de alias y se agrega un constructor de índice de Prendas; no se duplica el algoritmo de búsqueda escrita ni se modifica el motor de Clientes/Préstamos. Los botones de sugerencias se construyen con DOM y `textContent`, sin interpolar nombres/IDs en handlers HTML.

## 3. Motor de comparación de voz

`core/busqueda-voz.js` recibe clientes disponibles y una transcripción; devuelve candidatos con prioridad, tipo y marca de aproximación. No reconoce audio, no consulta Firebase, no escribe datos y no ejecuta acciones.

Orden de prioridad:

1. Nombre completo exacto, ignorando únicamente mayúsculas y espacios repetidos.
2. Alias/apodo exacto **ya registrado** en `alias`, `apodo`, `aliases` o `apodos`.
3. Nombre/alias/código normalizado, sin diferencias de tildes o puntuación. En voz se conserva la Ñ como letra distinta.
4. Coincidencia parcial por texto, usando el índice común y todos los términos en cualquier orden.
5. Coincidencia fonética por palabras completas.
6. Similitud ortográfica controlada: como máximo una palabra con una edición (inserción, eliminación, sustitución o intercambio de letras adyacentes), con al menos cinco letras en ambas palabras. No se corrigen números.

Equivalencias fonéticas limitadas: B/V; LL/Y; C delante de E/I con S/Z; C en los demás contextos con K; QU delante de E/I con K; G delante de E/I con J; GU delante de E/I conserva G fuerte; H muda salvo CH. Se conservan vocales, CH y Ñ. Se incluyen variantes iniciales J/Y ante vocal en nombres de cuatro letras o más, para sugerir transcripciones como Joni/Yoni y Yesica/Jesica, sin reemplazar J/Y indiscriminadamente en el interior de palabras. Son una heurística de candidatos, no una afirmación de pronunciación universal ni una identidad entre personas.

Las aproximaciones requieren palabras completas; términos menores de tres letras solo coinciden por texto. Los términos aproximados se asignan a palabras diferentes; no se reutiliza una palabra para justificar varios términos. Se limita la consulta aproximada a 160 caracteres y ocho términos. No se elimina toda consonante ni se equiparan todas las vocales. No hay tabla que convierta Pepe en José, ni se inventan apodos. Dirección, observaciones y notas no participan en la identidad de voz.

Ejemplos sintéticos comprobados: Tabo/Tavo, Giyo/Gillo, Karo/Caro, Joni/Yoni, Vichi/Bichi y Yesica/Jesica proponen coincidencias aproximadas. Chuschin/Chuschín se resuelve por normalización de tildes. Ninguna de las primeras seis equivalencias autoriza por sí sola abrir una ficha.

## 4. Selección y seguridad

- Solo una coincidencia exacta, de alias exacto o normalizada, **sin otros candidatos razonables**, permite abrir directamente la ficha existente. Se informa la transcripción mediante el aviso de voz.
- Si hay varios candidatos, se muestran las opciones ordenadas; no se elige el primero. Esto se mantiene aunque uno sea exacto y otro fonético.
- Una coincidencia única parcial, fonética u ortográfica exige selección manual. Las aproximadas se rotulan como tales.
- La hoja muestra la frase original, el nombre interpretado, tipos de coincidencia y ausencia de resultados. Permite corregir el texto sin volver a consultar por tecla. Presenta hasta 30 opciones y pide precisar cuando hay más.
- Al seleccionar se vuelven a leer los clientes locales, se comprueba cuenta/base y se revalida ID, nombre y alias. Si cambiaron o el cliente fue eliminado, se actualizan las opciones y se exige seleccionar nuevamente. Cambiar consulta, cancelar o iniciar otra búsqueda invalida una selección/lectura anterior pendiente.
- Los comandos financieros siguen deteniéndose antes de buscar clientes. Los candidatos solo pueden conducir a `openClienteDetail`; no pueden pagar, renovar, eliminar, guardar ni autorizar riesgos. La búsqueda escrita tampoco altera selecciones financieras al filtrar.
- Una respuesta de reconocimiento de una cuenta anterior o cancelada se descarta. Nombres/transcripciones se muestran como texto y se mantienen solo en memoria; se retiró el log de consola de la transcripción.

## 5. Actualizaciones recibidas y límites de concurrencia

Inicio reindexa al renderizar con los datos recibidos y conserva consulta/foco dentro de la misma cuenta/base. Los buscadores de Clientes y Préstamos conservan su comportamiento publicado.

Se agrega **un aviso visual** en el ciclo ya existente de actualización de interfaz de `iniciarSyncRealtime`, únicamente cuando cambia `clientes`. Llama a `actualizarSelectoresClientesAbiertos` para actualizar sugerencias de Nuevo préstamo, el selector de una Prenda abierta y los candidatos de voz. Realiza una lectura local compartida, conserva selecciones y no escribe. Su fallo se captura y no impide continuar el ciclo previo. No cambia listeners, conciliación, colas, permisos ni transacciones de sincronización.

Se conserva el pendiente técnico V2 documentado: lecturas concurrentes de **la misma cuenta** en `renderClientes`/`renderPrestamos` pueden finalizar en distinto orden y mostrar temporalmente una lectura antigua. Sus funciones permanecen idénticas a `49821ab`; no se intenta corregir ahora ni se declara resuelto. Los descartes de búsquedas de voz pertenecen a la interacción nueva y no solucionan esa carrera general.

Los índices de los autocompletados, voz y listados publicados se consultan en memoria. El inventario de Prendas mantiene su render y lecturas locales por cambio de texto existentes; no se refactoriza su ciclo de datos. La carga inicial del dashboard conserva el coste de sus métricas. Estar offline permite buscar solo la información recibida localmente; no garantiza que el reconocimiento de audio del navegador funcione sin conexión.

## 6. Archivos y shell

| Archivos | Cambio |
| --- | --- |
| `core/busqueda.js` | Exportar alias registrados y constructor de índice de Prendas. |
| `core/busqueda-voz.js` | Clasificación y candidatos fonéticos/ortográficos puros. |
| `ui/selectores-clientes.js` | Sugerencias compartidas, filtro de selectores nativos y refresco visual. |
| `ui/busqueda-voz.js` | Transcripción, opciones, corrección manual, revalidación e invalidación de respuestas pendientes. |
| `ui/index.js` | Registro de ambos módulos UI. |
| `index.html` | Integración de Inicio/Nuevo préstamo/voz, estilos acotados y aviso visual de clientes recibidos. |
| `ui/prestamos.js` | Solo carga de opciones/contexto del formulario `openSheetPrestamo`; guardado y finanzas intactos. |
| `ui/prendas.js` | Solo `openSheetPrenda`, `renderPrendas` e importación del índice común; operaciones financieras intactas. |
| `sw.js` | Shell local `prestcontrol-shell-v71-busqueda-unificada-voz-v1` y precache de los tres módulos nuevos. |
| `tests/busqueda-alcance.cjs` | Comparaciones de código protegido, con exclusiones exactas de interfaz. |
| `tests/busqueda-unificada-fixture.cjs` | Formularios/CSS/funciones reales con datos sintéticos y servicios interceptados. |
| `tests/busqueda-unificada.test.cjs` | Casos de motor, DOM, parser, contexto y seguridad. |
| `tests/busqueda-unificada-browser.test.cjs` | Chrome responsive y teclado sobre el fixture aislado. |
| `tests/buscadores.test.cjs`, `tests/clientes-importacion.test.cjs`, `tests/clientes-verificacion-final.test.cjs` | Adaptar invariantes al alcance exacto de interfaz y al nuevo shell, conservando comprobaciones financieras y de importación. |
| Este informe y `docs/ROADMAP_MAESTRO.md` | Alcance, evidencia, límites, reauditoría aprobada y autorización de publicación. |

No hay cambios a datos reales, archivos privados, importador, contadores generales, IDs, servicios financieros, Caja, Carga histórica, reglas ni repositorios. El ciclo de instalación/activación y recarga protegida del worker se conserva. No se borra IndexedDB ni se reinician colas.

## 7. Pruebas y evidencia

| Ejecución aislada | Resultado |
| --- | --- |
| `node tests/busqueda-unificada.test.cjs` | 24 casos: ejemplos, relevancia, negativos contextuales, alias, selectores, sin historial, parser, cuentas, lecturas pendientes, cambios recibidos y preservación de código. |
| `node tests/busqueda-unificada-browser.test.cjs` | 6 casos: 1440/768/390/320 px, Inicio, Nuevo préstamo, Prendas, candidatos de voz, teclado y 5000 identidades sintéticas. |
| `node tests/buscadores.test.cjs` | 18 regresiones de los buscadores publicados. |
| `node tests/buscadores-browser.test.cjs` | 9 regresiones de Chrome y listas de 5000 clientes/préstamos sintéticos. |
| `node tests/clientes-importacion.test.cjs` | 23 regresiones locales del importador/contador, Excel ficticio y base en memoria; sin `--emulator`. |
| `node tests/clientes-verificacion-final.test.cjs` | 8 comprobaciones de compatibilidad y PWA simuladas. |

Resultado del cierre: **88/88 verificaciones aprobadas**. Sintaxis del script inline y módulos, 36 entradas del shell, 31 importaciones locales cubiertas y `git diff --check` satisfactorios. Las comparaciones contra `49821ab` verifican código financiero fuera de las funciones de búsqueda; el cuerpo financiero del dashboard individual se compara de forma adicional. No se repiten auditorías financieras completas.

Fixtures exclusivamente inventados. Los módulos UI se cargan sin iniciar la aplicación real; Firebase y escrituras están interceptados. Las métricas del dashboard se simulan y la apertura de ficha se intercepta para registrar el ID seleccionado. Las pruebas no validan cálculos financieros ni acceden a una cuenta. Chrome usa perfil temporal y toda red bloqueada; capturas sintéticas guardadas fuera del repositorio, en la carpeta temporal.

Se reutiliza el runtime temporal `prestcontrol-caja-test-runtime` con JSDOM, fake-indexeddb, XLSX y Playwright Core ya instalados, y Chrome del equipo. No se agrega ninguna dependencia al proyecto.

La entrega inicial al auditor quedó registrada, fuera del repositorio, en `%TEMP%\prestcontrol-busqueda-unificada-auditoria-hashes.json`, con HEAD base, estado de Git y SHA-256 de los archivos versionados y nuevos no ignorados. No contiene registros de clientes ni credenciales. Aquella entrega comprendía 18 archivos sin preparar para commit; la corrección agregó la suite de cancelación, para un total autorizado de 19. El manifiesto vigente y su comprobación se describen en las secciones 9 y 10; capturas y evidencias temporales no se incluyen en Git.

## 8. Limitaciones y aceptación funcional pendiente

- **Reconocimiento de audio real NO validado.** Se probaron cadenas/transcripciones y callbacks de una API de reconocimiento simulada, no grabaciones ni micrófono físico. Ruido, acento, permisos, disponibilidad de la API, conexión y vocabulario del navegador pueden producir otra frase o impedir reconocer audio. No se asegura reconocer cualquier apodo.
- Reauditoría independiente aprobada: **APTO PARA PUBLICACIÓN**. Tras publicar, el usuario debe comprobar búsquedas, navegación y selección por voz con micrófono en PC y cada celular, incluyendo nombres parecidos, cancelación y casos sin resultados. La verificación técnica del deploy no cierra esa aceptación funcional.
- Alias solo se reconocen si están registrados o si el texto coincide con un fragmento real del nombre; no se crean relaciones de identidad ni se modifica lo almacenado.
- La aproximación puede omitir nombres difíciles o proponer personas distintas. Las opciones están rotuladas y necesitan selección; no constituyen una autorización financiera.
- Carrera preexistente de Clientes/Préstamos pendiente de V2. Persisten también los costes previos de carga inicial e inventario de Prendas descritos arriba.
- Publicación autorizada desde `main`, base `49821ab`, mediante commit de los 19 archivos y push sin fuerza. Debe verificarse que Netlify publique exactamente ese commit en estado `ready`, con el nuevo shell y archivos estáticos idénticos; el resultado externo se informa después del push.

## 9. Hallazgo bloqueante y corrección acotada de cancelación (25/11/2026)

### Reproducción y causa raíz

Antes de modificar el código se comprobó la carpeta/repositorio/rama/HEAD esperados, 18 archivos pendientes y ausencia de staging. Los 123 archivos de la entrega anterior coincidían con su manifiesto SHA-256. Se conservó esa instantánea fuera del repositorio como `%TEMP%\prestcontrol-voz-cancelacion-antes-hashes.json`.

Se agregaron primero tres reproducciones con promesas controladas que atraviesan **`procesarComandoVoz` completo**, no solo el resolvedor:

| Caso antes de corregir | Resultado observado |
| --- | --- |
| Tabo exacto, primera lectura pendiente, cancelar y completar lectura | Abrió la ficha A después de cancelar. |
| Tavo pendiente, ejecutar `buscar Luc` y completar la lectura antigua | La consulta visible cambió de Luc a Tavo. |
| Tavo aproximado, primera lectura pendiente, cancelar y completar | Reabrió la hoja de candidatos cancelada. |

Resultado inicial: **0/3 controles de cancelación aprobados**, con los tres defectos reproducidos. Evidencia: `%TEMP%\prestcontrol-voz-cancelacion-reproduccion-antes.json`. El auditor informó que también reprodujo la apertura exacta cancelada en el HEAD base; no se repitió esa auditoría de base en esta corrección.

El procesador esperaba la primera lectura de un nombre directo sin guardar una revisión del comando. Tras cancelar o comenzar otro comando, esa continuación llamaba al resolvedor y este creaba una revisión nueva: legitimaba otra vez una respuesta antigua. La protección existente cubría el interior del resolvedor, pero no su preámbulo asíncrono. Las 88 pruebas anteriores no cubrían esa combinación del procesador y callbacks completos; que pasaran no bastaba para declarar apta la publicación.

### Solución y alcance

- Se reutiliza `revisionVoz` en `ui/busqueda-voz.js`: `iniciarCicloVoz` invalida el ciclo previo y crea un único contexto de revisión/cuenta/base. `comandoVozVigente` comprueba ese mismo contexto. El inicio del reconocimiento o una invocación nueva del procesador establecen el ciclo; las llamadas interiores lo reciben y no crean una revisión nueva.
- El ciclo se propaga por el parser, primera lectura, resolvedor, candidatos, corrección manual y selección. Se verifica antes y después de las esperas relevantes. Cancelar también detiene el reconocimiento, incluso si todavía no emitió `onstart`; los callbacks y errores antiguos no alteran el micrófono, mensajes o consultas de otro ciclo.
- Ocultar los candidatos para abrir una ficha se separa de cancelar el comando. Así la apertura conserva su revisión y puede descartarse si se cancela durante su carga. `openClienteDetail` recibe únicamente desde voz una guardia opcional: verifica antes de comenzar, al terminar la lectura conjunta y después de la evaluación asíncrona previa al render. No cambian sus cálculos, relaciones, botones ni el comportamiento de llamadas que no provienen de voz.
- Las continuaciones de navegación comprueban vigencia después de `goPage`, antes de abrir formularios, aplicar filtros o mostrar mensajes. Cancelar no revierte una navegación ya iniciada cuando el comando era vigente, ni aborta promesas de lectura en curso: descarta sus continuaciones. No modifica los renderizadores generales de otras pantallas.
- No cambia el motor fonético, el motor de texto, el diseño, los selectores ni el shell **`prestcontrol-shell-v71-busqueda-unificada-voz-v1`**. No se aborda la carrera de `renderClientes`/`renderPrestamos` pendiente de V2.

Archivos intervenidos respecto de la entrega auditada:

| Archivo | Corrección |
| --- | --- |
| `index.html` | Propagación de ciclo, control de callbacks/continuaciones y tres guardias opcionales en la carga de ficha de cliente. |
| `ui/busqueda-voz.js` | Ciclo único compartido y conservación de vigencia al presentar/seleccionar/abrir. |
| `tests/voz-cancelacion.test.cjs` (nuevo) | Promesas controladas, procesador, callbacks, apertura de ficha real e integración ES en Chrome. |
| `tests/busqueda-unificada-fixture.cjs` | Modo adicional que importa `ui/index.js` original como ES module; modo anterior conservado. |
| `tests/busqueda-alcance.cjs` | Excluir únicamente las líneas exactas de guardia opcional al comparar la ficha; el cuerpo financiero restante se sigue comparando íntegro. |
| Este informe y `docs/ROADMAP_MAESTRO.md` | Dictamen, reproducciones, solución, resultados y límites actualizados. |

Al entregar la corrección para reauditoría, el total de Git pasó de 18 a **19 archivos pendientes** por la nueva suite. Solo siete archivos de esa corrección diferían de la entrega previa o eran nuevos; los restantes mantenían sus hashes de aquella entrega. En esa etapa no se realizó staging, commit, push ni deploy.

### Regresiones y resultados

`node tests/voz-cancelacion.test.cjs`: **20/20**. Se cubren los tres casos iniciales; cambio de cuenta/base; cancelación durante el resolvedor; callbacks tardíos `onstart`, `onresult`, `onerror`, `onend`; errores de lecturas antiguas; selección manual pendiente; continuaciones de navegación; las dos esperas de la ficha real; comandos vigentes y ausencia de escrituras financieras. La secuencia se controla con promesas, con un timeout de fallo para evitar una aprobación silenciosa si una etapa nunca se alcanza.

`node tests/voz-cancelacion.test.cjs --chrome`: **20/20 de los mismos casos**, ejecutados con la composición `ui/index.js` y sus dependencias ES originales en Chrome headless 157. Se comprueba que las funciones expuestas pertenecen a la instancia importada de `ui/busqueda-voz.js`. Se sirven 15 módulos locales con SHA-256 registrado, bajo un origen ficticio interceptado; no se transforma su sintaxis `import`/`export`. Cero solicitudes externas y errores de página. Se conserva el fixture de datos/servicios aislados, sin arrancar Firebase ni una sesión productiva.

Las **88/88 verificaciones anteriores** se reejecutaron satisfactoriamente (24 + 6 + 18 + 9 + 23 + 8), incluidas equivalencias fonéticas y Chrome responsive. Son 108 casos distintos en total; los 20 nuevos se ejecutan además en Chrome con ES modules. No se cuentan como 40 casos distintos.

Evidencias fuera de Git: `%TEMP%\prestcontrol-voz-cancelacion-despues-node.json`, `%TEMP%\prestcontrol-voz-cancelacion-despues-chrome-es.json` y `%TEMP%\prestcontrol-voz-cancelacion-auditoria-hashes.json` para el nuevo estado. El manifiesto de la entrega previa se conserva sin sobrescribir.

La reauditoría posterior cerró el hallazgo bloqueante según la sección 10. Se mantiene pendiente **la validación con micrófono real**. Los callbacks y transcripciones son simulados también en Chrome; cargar módulos ES reales no valida audio, permisos físicos ni calidad de transcripción.

## 10. Reauditoría aprobada y publicación autorizada (25/11/2026)

El usuario comunicó el dictamen definitivo del AUDITOR: **APTO PARA PUBLICACIÓN**. Confirmó 88/88 verificaciones anteriores, 20/20 regresiones nuevas y los mismos 20 casos en Chrome con módulos ES originales: **108 casos distintos**, sin contar dos veces la ejecución de Chrome. Los tres escenarios bloqueantes fueron reproducidos independientemente y corregidos; no se identificó ninguna regresión relevante. Se conservan la navegación manual de fichas y la integridad de buscadores y módulos financieros. **Hallazgo de cancelación completa CERRADO; implementación y auditoría CERRADAS**.

Antes de actualizar estos dos documentos se verificaron la carpeta Prestcontrol, repositorio `G0nz87/Prestcontrol-26`, rama `main`, HEAD y remoto `origin/main` en `49821abe2d62d4cb24a3ce81a9b6b31f11e7de5d`, exactamente 19 archivos pendientes sin staging, y **124/124 archivos idénticos** al manifiesto `%TEMP%\prestcontrol-voz-cancelacion-auditoria-hashes.json`, incluido su inventario. La única modificación posterior autorizada es documental: este informe y `docs/ROADMAP_MAESTRO.md`. Código y pruebas deben conservar todos sus hashes auditados.

Se autoriza preparar exclusivamente esos 19 archivos y crear el commit `feat(busqueda): unifica buscadores y mejora reconocimiento fonetico por voz`, seguido de `git push origin main`, sin fuerza. Se mantiene **`prestcontrol-shell-v71-busqueda-unificada-voz-v1`**. Controles finales ejecutados satisfactoriamente: **20/20 cancelación en Node, los mismos 20/20 en Chrome ES y 8/8 compatibilidad/PWA**; sintaxis de un script inline y 32 módulos/scripts JS; **36 entradas de precache y las 31 importaciones locales identificadas**, además de cinco declaraciones de importación multilínea, todas cubiertas; revisión del alcance exacto de 19 archivos sin material privado/temporal ni alertas de claves privadas/credenciales, integridad respecto del manifiesto y `git diff --check`. No se repiten auditorías financieras ni se agrega código. La ejecución final confirma 28 casos distintos pertinentes; no se presenta como una nueva ejecución de las 108 pruebas de la reauditoría.

El cierre técnico de publicación queda condicionado a comprobar por lectura que Netlify está `ready` en producción para el commit generado, verificar SHA-256 de los archivos estáticos publicados contra los blobs de ese commit, confirmar el shell y dejar Git limpio con `main = origin/main`. El identificador del deploy, commit completo y resultados efectivos se entregan en el informe posterior al push, fuera de este commit para evitar modificar el artefacto publicado.

La aceptación funcional en PC/celulares reales permanece **PENDIENTE DEL USUARIO**, especialmente el reconocimiento con micrófono. La carrera preexistente de Clientes/Préstamos permanece reservada para V2, sin intervención. No se modifican datos productivos, Firebase/reglas, operaciones financieras, Caja, Carga histórica, importación Excel, identificadores, contadores, IndexedDB ni colas; las comprobaciones de publicación solo requieren lecturas estáticas.
