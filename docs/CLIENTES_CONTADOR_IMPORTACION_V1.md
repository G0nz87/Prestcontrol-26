# PrestControl V1: contador e importación de clientes

Fecha: 24/11/2026. Repositorio verificado: `G0nz87/Prestcontrol-26`.

Estado documental: implementación y verificación aprobadas; publicación controlada autorizada el 24/11/2026. Las secciones A–K conservan la evidencia previa al commit; la sección L registra la autorización y las comprobaciones finales. La recepción física en PC/celular queda pendiente de validación del operador.

## A. Diagnóstico

La ruta activa combina `renderClientes()` y persistencia IndexedDB en `index.html`, los handlers de `ui/clientes.js` y la validación de `ClienteService`. Las altas manuales usan `nextId('CL', todosIncluyendoEliminados)`, guardado local y cola de sincronización. El listado obtiene `dbAll('clientes')`, que excluye tombstones. El listener existente de Firebase vuelve a renderizar Clientes al recibir cambios; no fue modificado.

El importador Excel activo anterior estaba dentro de `index.html`. Escribía directamente, exigía IDs del archivo, no ofrecía selección ni confirmación y también importaba préstamos/cuotas. La copia de `legacy/` no se carga. Se reemplazó la entrada activa por una importación exclusiva de clientes; se reutilizan el selector, SheetJS ya cargado, la validación, el generador de IDs y la cola existentes. La exportación Excel no cambia. Los respaldos JSON y sus flujos no cambian.

El Excel privado existe fuera del repositorio. Se abrió solo para inspeccionar estructura, encabezados y número de filas: hoja `Para PrestControl`, 13 columnas y 240 candidatos. Las otras siete hojas no se utilizan para importar. No se analizaron ni exportaron datos personales como evidencia; no se modificó ni copió el archivo original.

## B. Contador

En Clientes se muestran permanentemente total registrado, con teléfono y sin teléfono, incluso con cero clientes. Cuenta la misma lista local de la cuenta activa que alimenta el listado, antes del filtro de búsqueda. No suma una segunda consulta Firebase ni cuenta préstamos. Teléfono vacío, ausente o solo espacios se considera sin teléfono; ambas categorías suman el total.

Se recalcula al renderizar tras un alta, una edición, una eliminación confirmada, la importación o los cambios recibidos por el listener existente. La réplica offline puede estar pendiente de sincronización: el contador refleja lo visible localmente y no afirma que Firebase ya confirmó cada alta.

## C. Importación

1. Selección de `.xlsx` o `.xls` (máximo 10 MB), con cuenta activa y aplicación desbloqueada.
2. Lectura local exclusiva de `Para PrestControl`; validación de las 13 columnas, nombres obligatorios, teléfono opcional y formato de teléfono. Fórmulas en columnas reconocidas se señalan como error. Límite de 5000 filas candidatas y 101 columnas.
3. Consulta de clientes locales, incluyendo eliminados, y lectura explícita del servidor de la cuenta activa. Un fallo de lectura detiene la operación; no se interpreta como lista vacía. Para abrir la revisión y confirmar se necesita conexión.
4. Vista previa con filas, seleccionados/a incorporar, nuevos, posiblemente existentes, advertencias, errores, ya importados y omitidos. Cada fila muestra su estado, coincidencias, datos de revisión y notas.
5. Selección individual; seleccionar nuevos o deseleccionar todos. Los posibles duplicados y las filas marcadas «No» en autorización comienzan desmarcados. Una duda de identidad, alias o ausencia de teléfono genera advertencia y no excluye por sí sola un candidato.
6. Para importar posibles duplicados se necesita marcar su aceptación expresa, además de la confirmación final que informa cantidades y advertencias. Antes de esa confirmación se vuelve a leer el servidor; cambios en las coincidencias obligan a revisar nuevamente.
7. Se guardan únicamente nombre/alias, teléfono y Observaciones como notas. DNI y dirección quedan vacíos. Identidad, números auxiliares, menciones, páginas, parentesco y demás columnas son información de revisión; no se inventan campos ni se transforman en IDs.
8. Cada fila se confirma en una transacción IndexedDB con cliente y operación de cola, sin cambios de esquema. Se lee también el bloqueo de restauración. Si falla la cola, se revierte esa fila completa; las otras filas confirmadas se conservan.
9. El resultado detalla por fila qué se incorporó localmente, qué se omitió y qué falló. Se puede reintentar la selección fallida. El mensaje de resultados no anuncia éxito remoto: remite al indicador de sincronización existente.

Se utiliza `sheet_to_json` con encabezados como matriz, valores formateados y filas vacías conservadas para mantener los números de fila. Referencia técnica: [API oficial de SheetJS](https://docs.sheetjs.com/docs/api/utilities/array/).

## D. Archivos

| Archivo | Cambio |
| --- | --- |
| `index.html` | Contador en el listado, estilos acotados, entrada al importador, transacción local y protección de envío de clientes Excel. |
| `ui/index.js` | Registro de los handlers de importación. |
| `ui/importacion-clientes.js` | Vista previa, selección, confirmación, contexto de cuenta, ejecución y resultados. |
| `services/ImportacionClientesService.js` | Validación del Excel, huellas de procedencia, coincidencias, resúmenes y conteo. |
| `sw.js` | Dos dependencias nuevas en el precache y caché `prestcontrol-shell-v71-clientes-v1`; conserva la lógica de sesión y actualización. |
| `.gitignore` | Exclusión preventiva de `.xlsx` y `.xls`. |
| `tests/clientes-importacion.test.cjs` | Ensayos sintéticos de dominio, handlers reales, DOM, IndexedDB y Firestore Emulator. |
| `tests/clientes-verificacion-final.test.cjs` | Ocho verificaciones acotadas de compatibilidad, cola normal/mixta y actualización del shell. |
| `docs/CLIENTES_CONTADOR_IMPORTACION_V1.md` | Diagnóstico, alcance, uso y limitaciones. |
| `docs/ROADMAP_MAESTRO.md` | Registro de esta mejora local, sin avanzar etapas de V2. |

No se modifican módulos financieros, reglas, autenticación, numeración, versión de IndexedDB ni protecciones de eliminación. El helper de tombstones conserva además la procedencia Excel exclusivamente para clientes importados; sus validaciones y borrado lógico se mantienen.

## E. Pruebas

Las dependencias de prueba se instalan fuera del repositorio, en la carpeta temporal. Excel sintéticos generados en memoria, JSDOM, fake-indexeddb y Firestore Emulator local: `demo-prestcontrol-apertura`, `127.0.0.1:8089`. No se inicia la aplicación productiva ni se carga su configuración Firebase.

Ejecución nueva:

```powershell
node tests/clientes-importacion.test.cjs --emulator
```

Resultados del 24/11/2026:

| Suite | Resultado |
| --- | --- |
| `clientes-importacion.test.cjs --emulator` | 24/24 |
| `apertura-caja.test.cjs` | 25/25 |
| `carga-historica.test.cjs` | 33/33 |
| `carga-historica-ui.test.cjs` | 13/13 |
| `correcciones-historicas.test.cjs` | 29/29 |
| `revision-correcciones-v71.test.cjs` | 9/9 |
| `despliegue-v71.test.cjs` | 11/11 |

Las seis suites existentes terminaron con código 0; conservan también reproducciones deliberadas de riesgos/versiones anteriores. No se modificaron para esta tarea. El primer intento de la suite de correcciones alcanzó el timeout del runner en el caso de 120 cuotas; la repetición sin ese límite terminó correctamente con 29/29. La última ejecución de Clientes incluye la preservación de ediciones remotas posteriores a un alta cuya respuesta se reintenta, y la protección de colisiones de CL.

También pasaron los controles de sintaxis de los módulos, service worker y script inline completo de `index.html`, y `git diff --check`. La comprobación de privacidad encontró **0 planillas dentro del repositorio y 0 bajo seguimiento Git**.

La suite cubre cero clientes; con/sin teléfono; alta, edición y borrado mediante handlers reales; exclusión de tombstones; réplica desde otro dispositivo simulado; 240 candidatos sintéticos; validación de estructura; fórmulas; nombres/alias/teléfonos; personas similares y familiares independientes; selección; confirmación cancelada; doble clic; concurrencia local; repetición; reimportación después de eliminar; fallo parcial; aborto del encolado; pérdida de red; fallo de lectura remota; cambio de cuenta/base; restauración pendiente; escape de HTML; conservación de clientes existentes; colisiones remotas de CL y permisos entre cuentas.

Una comprobación compara con HEAD todas las funciones inline existentes, salvo el render de Clientes, la entrada de importación, el texto del botón y las adiciones identificadas de protección de clientes Excel. También compara completos los módulos financieros, `ui/clientes.js` y las reglas para verificar que permanecen intactos.

Para reproducir el entorno de pruebas, instalar las dependencias temporales indicadas en `CAJA_APERTURA_UNICA.md` más `jsdom@26.1.0` y `xlsx@0.18.5`. El emulador se puede iniciar directamente con el JAR local, sin credenciales ni Firebase CLI:

```powershell
java '-Duser.language=en' '-Duser.country=US' -jar "$env:USERPROFILE\.cache\firebase\emulators\cloud-firestore-emulator-v1.20.4.jar" --host 127.0.0.1 --port 8089 --project_id demo-prestcontrol-apertura
```

La configuración inglesa evita un error de recursos de idioma del emulador observado con `es_AR`. No se cambian las reglas para ejecutar las pruebas. JSDOM no valida apariencia, foco ni comportamiento físico de PWA en PC y celulares.

## F. Clientes existentes, coincidencias y reintentos

No se fusiona, elimina ni modifica ningún cliente existente desde el importador. Las coincidencias usan nombre/alias/apodo normalizados, al menos dos palabras compartidas o teléfono normalizado mediante la función ya existente. Un apellido compartido por sí solo no deduplica. También se muestran coincidencias entre candidatos del archivo. Se preservan nombres y familiares independientes cuando el usuario los selecciona y confirma.

Cada alta conserva una huella SHA-256 de los 13 valores de la fila y su ocurrencia si existen filas idénticas. El auxiliar participa como dato de procedencia, nunca como CL. Renombrar el archivo o mover una fila sin cambiar sus valores no permite reimportarla accidentalmente. La procedencia viaja con el cliente a Firebase, las ediciones y el tombstone, y se detecta en futuras importaciones.

Una fila idéntica previamente importada queda bloqueada, incluso si el cliente fue eliminado después. Si se cambian valores del Excel, la huella puede cambiar: se revisan entonces coincidencias y se requiere selección/confirmación cuando corresponda; no se afirma identidad exacta basándose solamente en un nombre.

La escritura local reserva CL mediante el generador actual dentro de una transacción, incluyendo tombstones y los IDs remotos conocidos. Doble clic y operaciones en pestañas locales no sobrescriben fichas. Se comprueban UID, base y bloqueo de restauración antes de escribir.

Justificación del cambio mínimo de sincronización: la numeración CL secuencial vigente puede colisionar entre dispositivos. Para clientes con procedencia Excel, el envío de la cola usa una transacción Firestore que comprueba la identidad del documento antes de escribir. Si otro cliente ya usa ese CL, se conserva el registro remoto y la operación local queda pendiente/error para revisión; no se renumera, elimina ni fusiona automáticamente. La marca de procedencia también se incluye en las operaciones de borrado de estos clientes para que un tombstone pendiente tenga la misma protección. Las demás entidades conservan su flujo anterior.

## G. Privacidad

El Excel original continúa en `Videos\Clientes`, fuera del repositorio y de la carpeta del sitio. No hay archivos Excel bajo seguimiento Git; las extensiones quedan ignoradas preventivamente. No se copiaron contactos reales a código, pruebas, documentación ni fixtures. Las lecturas del archivo privado imprimieron exclusivamente nombres de hojas, encabezados y cantidades.

No hubo importación en producción, cambios de datos reales, commit, push, publicación Netlify ni despliegue de reglas.

## H. Limitaciones y revisión pendiente

- Falta revisión visual en PC y celular con una publicación futura autorizada. No se certifica aquí el estado de los dispositivos ni la aplicación desplegada.
- Revisión y confirmación requieren conexión para consultar clientes remotos. Si se pierde después de confirmar, las altas locales y la cola quedan conservadas para la reconexión.
- SheetJS sigue siendo la dependencia ya existente por CDN; su disponibilidad determina si puede abrirse un archivo. No se agregan servicios de subida de archivos.
- Las coincidencias son avisos, no pruebas de identidad; no se puede reconocer cualquier apodo desconocido. La revisión humana sigue siendo necesaria.
- Usar un solo dispositivo para altas de clientes durante la importación. La protección de colisiones conserva datos, pero no resuelve automáticamente conflictos de numeración ni cambia las limitaciones de las altas manuales o clientes antiguos de V1.
- Una colisión de CL deja un pendiente que requiere revisión técnica antes de forzar sincronizaciones o restauraciones completas. No intentar resolverla con resets, limpieza de colas o borrados masivos.
- El contador representa la réplica activa y su criterio de listado; una cola pendiente no equivale a confirmación del servidor.
- Se reemplaza el importador genérico inseguro: el botón ya no importa hojas financieras ni Excel de formatos diferentes. No se modifica el mecanismo de respaldo/restauración JSON.

## I. Git

Los cambios quedan sin staging ni commit, para revisar con `git diff` y `git status --short`. No se publica ningún archivo privado. Las reglas y los archivos financieros mantienen su contenido previo.

Rama: `main`. HEAD conservado: `936a06b`. Cinco archivos existentes modificados y cinco nuevos, incluyendo esta documentación, la prueba final y el registro de roadmap; nada en staging. No se ejecutó `git push` ni se publicó el sitio.

## J. Uso después de una publicación autorizada

1. Abrir la PWA actualizada, ingresar en la cuenta correcta y dejar terminar la sincronización previa. Evitar cargas simultáneas desde otros dispositivos.
2. Entrar en **Clientes**: el contador aparece arriba, incluso si la lista está vacía. Buscar un nombre no reduce el total registrado.
3. Elegir **Importar clientes desde Excel** y seleccionar el archivo privado desde su ubicación original. También se puede acceder al mismo selector desde Configuración.
4. Revisar cantidades, advertencias y coincidencias; desmarcar lo que no se quiera incorporar. Los errores bloquean la fila y se corrigen en una copia del archivo original.
5. Si se desean incorporar posibles duplicados, seleccionarlos individualmente y marcar la aceptación explícita de fichas separadas.
6. Pulsar **Importar seleccionados** y aceptar el resumen final. Revisar los resultados por fila y reintentar únicamente los fallidos cuando corresponda.
7. Esperar la confirmación en el indicador habitual de sincronización. Un resultado «Incorporado localmente y en cola» todavía no significa que Firebase confirmó el cambio.
8. Revisar duplicados manualmente en Clientes usando las protecciones existentes. Nunca se elimina ni fusiona automáticamente a una persona desde la importación.

## K. Verificación final previa a publicación (24/11/2026)

Resultado: **APTO técnicamente para publicar el alcance de Clientes**, con las limitaciones siguientes y sin autorización de publicación ejecutada.

1. **Funcionalidad retirada:** el botón anterior «Importar Excel» permitía intentar importar hojas genéricas de clientes, préstamos y cuotas con columnas `ID`/`id` y nombres de campos del formato anterior. Esa ruta escribía directamente en IndexedDB, sin vista previa, confirmación por fila ni encolado de sincronización. Fue sustituida por la importación exclusiva de la hoja `Para PrestControl`, para evitar escrituras financieras desde esta operación. Por tanto, esta versión **ya no ofrece importación de préstamos/cuotas desde ese botón ni importación de clientes por los IDs de aquel formato genérico**. No se incorporó un nuevo importador financiero ni se restauró la ruta insegura. La exportación Excel nunca se utiliza como sustituto de un respaldo completo.
2. **Independencia:** el importador consulta y crea clientes. Su transacción local abarca `clientes`, `sync_queue` y la lectura de bloqueo en `config`. No invoca cálculos ni escrituras de préstamos, cuotas o Caja. El listado conserva sus lecturas habituales para mostrar situación crediticia.
3. **Conservación:** se compararon con HEAD y resultaron idénticas las funciones de exportación Excel/Google Sheets, PDF, comprobantes, exportación e importación de respaldos y restauración completa, incluyendo su publicación/verificación. Las entradas de interfaz siguen presentes. No se volvieron a ejecutar restauraciones ni auditorías financieras para esta verificación; se conserva la evidencia aprobada anterior.
4. **Protección CL:** la comparación del envío de cola con HEAD da igualdad al quitar únicamente los bloques marcados, exclusivos de clientes Excel. Pruebas de enrutamiento con datos ficticios comprueban que la cola normal de cliente/préstamo/cuota/Caja produce el mismo resultado previo, que el cliente importado usa su transacción y que una colisión conserva al cliente remoto sin impedir el envío de los demás registros. No se modificó ese mecanismo en esta revisión.
5. **Shell corregido:** el identificador de caché todavía era `prestcontrol-shell-v71`. Aunque el archivo SW había cambiado y podía disparar una actualización, no separaba las versiones de caché. Ahora es `prestcontrol-shell-v71-clientes-v1`; conserva el registro `updateViaCache: 'none'`, las dos nuevas dependencias en precache, el aviso de activación y la recarga diferida ante operaciones/formularios abiertos. No se tocan IndexedDB, sesiones ni datos.

También se corrigió exclusivamente el texto del aviso de importador todavía no disponible, que había quedado con caracteres dañados.

Pruebas ejecutadas en esta revisión:

```powershell
node tests/clientes-verificacion-final.test.cjs
node --check sw.js
node --check tests/clientes-verificacion-final.test.cjs
git diff --check
```

Resultado: **8/8 verificaciones**, sintaxis y diff correctos. Simulación aislada del service worker: caché nueva completa, activación que elimina solo cachés antiguas del proyecto, disponibilidad offline de HTML y módulos nuevos, conservación de la caché anterior si falla la instalación y recarga aplazada durante una operación o formulario. Sin SDK Firebase, solicitudes de red ni datos reales.

Limitaciones vigentes: la importación requiere conexión para revisión/confirmación; coincidencias y conflictos CL requieren revisión humana. El importador Excel genérico anterior fue retirado deliberadamente. Las PWA necesitan abrirse con conexión para recibir la actualización y deben terminar/cerrar operaciones para recargar. La prueba automatizada de ciclo del shell no sustituye comprobar físicamente PC/celular después de una publicación autorizada.

No se repitieron las auditorías financieras aprobadas. No se abrió el Excel privado ni se importaron clientes reales en esta revisión. Sin staging, commit, push, deploy Netlify o reglas Firebase.

## L. Publicación controlada autorizada (24/11/2026)

El usuario autorizó expresamente crear el commit de esta mejora, ejecutar `git push origin main` normal y permitir el despliegue automático de Netlify. Aceptó la retirada del importador Excel genérico. No se autoriza ni ejecuta importación real, carga financiera, apertura de Caja, restauración, reset, limpieza de datos ni despliegue de reglas.

Comprobaciones previas al commit:

- Directorio y remoto verificados: checkout de `G0nz87/Prestcontrol-26`, rama `main`.
- HEAD, referencia local `origin/main` y `refs/heads/main` consultada directamente en GitHub coinciden en `936a06bd74b32100df1ecff5f3d3701364d8197b`; sin avance remoto inesperado.
- Netlify identifica el sitio `prestcontrol-26`, ID `c8543976-1247-451c-9a04-1fefc3c692b1`, y la publicación productiva `ready` desde `main` del mismo commit base. La consulta pública no expone la configuración privada de builds; el resultado del despliegue automático se comprueba después del push.
- `git diff --check` correcto; exactamente diez archivos de código, pruebas y documentación de Clientes previstos para el commit. Sin planillas, respaldos ni datos personales reales entre ellos. Cero archivos Excel dentro del checkout y cero bajo seguimiento Git; el original permanece fuera del repositorio y no se vuelve a abrir.
- `firestore.rules`, inicialización Firebase, generador de identificadores, handlers de altas/borrado manual, servicios de préstamos, Caja, métricas y Carga histórica mantienen su contenido anterior. No se repiten auditorías financieras.
- Las ocho verificaciones finales acotadas se ejecutaron otra vez sobre el código a publicar y terminaron correctamente. Conservadas las 24 pruebas nuevas y las pruebas financieras previamente aprobadas; no se modificó implementación después de su revisión final.
- La referencia «versión anterior» de las dos pruebas de Clientes se fijó al hash base `936a06bd74b32100df1ecff5f3d3701364d8197b`, en lugar de resolver `HEAD` en cada ejecución, para que sigan reproduciendo la misma comparación después del commit. El código de aplicación probado se conserva idéntico.
- Shell exacto `prestcontrol-shell-v71-clientes-v1`, dependencias nuevas presentes y recarga diferida verificada. Se conserva IndexedDB y sus datos.

El commit asociado es el que incorpora esta sección. Su hash completo, resultado del push, estado final de Git y confirmación del commit/shell efectivamente servido por Netlify se entregan al operador al terminar la publicación. No se realiza despliegue manual ni se afirma éxito antes de comprobarlo.

Controles posteriores del operador, en PC y cada celular:

1. Abrir la URL habitual con conexión, terminar o cancelar cualquier formulario abierto y permitir la actualización. No desinstalar la PWA ni borrar almacenamiento. Confirmar el shell `prestcontrol-shell-v71-clientes-v1` y la cuenta correcta.
2. Revisar que los clientes anteriores sigan con sus IDs, nombres y teléfonos, y que total = con teléfono + sin teléfono. Los tombstones no figuran como clientes.
3. Confirmar que aparece **Importar clientes desde Excel**. Seleccionar el archivo privado para revisar los 240 candidatos y advertencias, y probar selección/deselección. Abrir la vista previa no debe crear fichas; todavía se puede cerrar sin importar.
4. Cuando el operador decida importar, revisar la selección, aceptar expresamente los posibles duplicados elegidos y confirmar el resumen final. Esperar el indicador de sincronización; una alta local en cola no equivale a confirmación remota.
5. Comprobar que el contador aumenta con las altas confirmadas, cambia la categoría al editar teléfonos y disminuye únicamente después de eliminaciones legítimas con las protecciones existentes. No crear ni borrar registros ficticios en producción para probar.
6. Confirmar recepción de los clientes en el otro dispositivo actualizado y ausencia de errores de cola. Ante conflicto de CL, conservar el pendiente y solicitar revisión; no forzar restauraciones, limpiar colas ni renumerar.

La operación futura de historia sigue siendo manual mediante **Carga histórica**, sin importaciones financieras desde Excel. La apertura de Caja se realiza únicamente cuando el operador complete y verifique la cartera y finalice esa carga. V2 conserva los cambios estructurales y de numeración.
