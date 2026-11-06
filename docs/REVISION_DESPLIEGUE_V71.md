# Revisión de seguridad de publicación v71

Base publicada según Git: `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc` (v70). Revisión local del 5 de noviembre de 2026. Shell preparado: `prestcontrol-shell-v71`.

Continuación posterior: este informe conserva la revisión previa de apertura. La carga histórica autorizada después ya está implementada localmente; para el artefacto y publicación conjunta actuales usar [CARGA_HISTORICA.md](CARGA_HISTORICA.md), con las reglas extendidas completas. No se realizó ninguna publicación.

## Dictamen

La apertura única pasó nuevamente sus 25 pruebas. La revisión de despliegue agregó 11 escenarios aprobados, algunos de los cuales **reproducen riesgos**, no certifican ausencia de problemas.

**No corresponde autorizar una publicación desatendida ni prometer continuidad sin pausa con PWA antiguas.** El orden técnicamente recomendado es reglas nuevas primero y frontend v71 después, sujeto a las condiciones operativas siguientes. Publicar solo v71, o volver a las reglas permisivas de v70, no protege Caja.

La transición requiere controlar todos los dispositivos/pestañas, preservar y conciliar las colas y suspender operaciones durante el cambio. No existe en esta entrega una barrera de mantenimiento que fuerce la actualización de los clientes antiguos. Si no puede garantizarse ese control, detener la publicación y diseñar esa protección adicional en otra tarea. No se implementó en esta revisión.

No se consultaron cuentas, datos ni reglas activas de producción. La comparación de reglas antiguas usa el archivo de Git de v70; **no demuestra que la consola de producción tenga exactamente ese archivo**. Verificarlo será una condición previa del despliegue autorizado.

## Compatibilidad comprobada

| Frontend | Reglas | Resultado |
| --- | --- | --- |
| v70 | v70 | Operación anterior; permanece la carrera original de apertura. |
| v71 | v70 | Inseguro: un cliente antiguo puede crear otra apertura o sobrescribir apertura y autoridad. Reproducido. |
| v70 | v71 | Préstamos, cobros, pagos parciales y renovación normales con Caja existente están permitidos. Aperturas antiguas pendientes se rechazan; pueden bloquear batches compartidos. Restauraciones y resets antiguos pueden quedar parcialmente aplicados. |
| v71 | v71 | Apertura transaccional y protección de servidor validadas. No abre desde la cola. Sin apertura remota, una apertura antigua pendiente bloquea el resto del push hasta revisión/confirmación explícita. |

Las reglas nuevas no convierten ni borran documentos al desplegarse. Una cuenta con una sola apertura válida conserva su ID, importe y movimiento originales. Al verificar Caja desde v71 se crea, si falta, el documento de autoridad que referencia esa apertura; no se genera un segundo saldo inicial. Una cuenta con duplicados previos, apertura eliminada sin sucesora, movimientos sin apertura identificable o reset incompleto requiere revisión; no debe forzarse su conversión.

Una PWA v70 puede mostrar un éxito local aunque el servidor rechace su apertura. Instalar el nuevo service worker no sustituye instantáneamente el JavaScript ya cargado en todas las ventanas. El shell usa `skipWaiting` y `clients.claim`; la página coordina la recarga para evitar formularios/operaciones activos. Ver una caché v71 no demuestra que una pestaña abierta esté ejecutando íntegramente v71. Los assets no tienen nombres con hash; las comprobaciones deben incluir recarga controlada y módulos servidos, no solo el estado de Netlify.

## Riesgos concretos encontrados

1. **Frontend primero:** con reglas v70, v71 confirma una apertura y una escritura equivalente a v70 crea otra distinta. También se pudo alterar el importe y el puntero de autoridad. La protección de concurrencia del cliente no sustituye reglas de servidor.
2. **Reglas primero con apertura pendiente de v70:** el push antiguo agrupa apertura y otro registro en un batch. El servidor rechaza el batch entero; los registros locales y su cola permanecen pendientes. No se pierden automáticamente, pero la sincronización queda bloqueada.
3. **Cola pendiente después de actualizar a v71:** si no hay apertura remota confirmada, el preflight lanza un error antes de publicar cualquier elemento del push. No confirmar automáticamente, borrar la cola ni marcarla como enviada. Resolver la situación de Caja explícitamente, con revisión de las operaciones relacionadas; si ya hay movimientos sin apertura confirmada, el servicio exige revisión y puede no permitir una nueva apertura.
4. **Restauración grande desde v70:** la publicación usa varios batches de hasta 400 escrituras, sin atomicidad global. Se ejecutó el publicador real de v70: el primer batch confirmó 399 clientes sintéticos y sobrescribió un desembolso de prueba de 1000 a 900; el siguiente intentó eliminar la apertura y fue rechazado. La apertura quedó intacta, pero el resto de la restauración quedó parcialmente aplicado. Esta es una situación concreta de sobrescritura financiera posible desde un cliente antiguo, no un supuesto.
5. **Reset v70 en cuenta legacy todavía sin autoridad:** las reglas permiten escribir `prestcontrolDataReset: preparing` mientras no hay autoridad. Un batch anterior puede eliminar lógicamente clientes y el de apertura se rechaza; la barrera queda preparando y bloquea la sincronización. Se reprodujo la secuencia de escrituras relevante en el emulador. Con autoridad ya creada, el cambio de barrera se rechaza al inicio. No completar, borrar ni reintentar ese reset a ciegas.
6. **Alcance de las reglas:** los movimientos distintos de `SALDO_INICIAL` mantienen los permisos anteriores de propietario. La cola normal tiene comprobaciones de integridad, pero las reglas no garantizan por sí solas inmutabilidad de todos los movimientos. Se comprobó que una escritura autenticada puede cambiar un desembolso de prueba. No implica que el flujo normal de cobro haga esa escritura, ni es una vulnerabilidad nueva introducida por v71; impide dar una garantía absoluta frente a restauraciones/versiones antiguas o escrituras que eludan esas comprobaciones.
7. **Rollback de reglas:** volver a las reglas v70 después de confirmar una apertura permite crear otra. Reproducido. Revertir el sitio tampoco revierte reglas, datos, IndexedDB ni todas las PWA instaladas.
8. **Restauraciones v71 y fallos de red:** v71 omite la apertura y sus tombstones, pero conserva la publicación en varios batches. Por inspección del código, un fallo de red entre batches también puede dejar publicación parcial del resto de los datos; su estado de restauración pendiente bloquea la sincronización normal hasta resolverlo. Actualizar las PWA elimina el caso antiguo que intenta borrar la apertura, pero no vuelve atómica toda restauración. No probar una restauración productiva como verificación de despliegue.

Firestore garantiza atomicidad de cada transacción o batch, no de una secuencia de batches. [Documentación de transacciones y batches](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Orden de publicación propuesto, pendiente de autorización

No se ejecutó ninguno de los pasos de publicación. Las comprobaciones de producción aquí indicadas son futuras y de solo lectura; no usar operaciones financieras ficticias como prueba.

1. **Fijar los artefactos y el destino.** Revisar el diff final y registrar hashes de reglas/frontend, commit base e identificador del despliegue Netlify actual. Confirmar proyecto `prestcontrol-5e965`, base Firestore y vinculación real de Netlify con `main`; no hay `.firebaserc` local, por lo que no debe confiarse en un proyecto CLI implícito. Comparar y guardar una copia de las reglas activas antes de reemplazarlas. Si difieren de las revisadas, detener y repetir pruebas con esa base. El CLI sobrescribe las reglas de consola.
2. **Inventariar cuentas y todos sus dispositivos/pestañas.** Identificar PWA offline que podrían reconectarse después. Revisar por dispositivo `sync_queue`, errores y restauraciones pendientes; el indicador «En línea» no prueba que todo esté enviado. Conservar respaldos locales y una referencia remota coherente antes del cambio, sin restaurarlos ni reescribir datos. No asumir que un JSON de respaldo incluye toda la cola/auditoría: preservar esos stores también por separado. Si hay apertura local/remota divergente, duplicados, operaciones financieras sin apertura, reset preparando o restauración parcial, detener el corte para esa situación y revisar antes de continuar. No drenar automáticamente una cola de apertura conflictiva con las reglas permisivas.
3. **Conciliar las operaciones normales pendientes y entrar en una pausa controlada.** Una vez comprobada su integridad, terminar la sincronización normal en cada dispositivo y verificar confirmación remota y ausencia de pendientes. Detener altas financieras, aperturas, resets y restauraciones, cerrar formularios y pestañas antiguas de manera coordinada. No borrar almacenamiento, desinstalar la PWA ni forzar recargas con trabajo pendiente. Si queda un dispositivo no controlado, no continuar. Esta pausa es operativa; no está impuesta por una nueva función de la aplicación.
4. **Desplegar únicamente las reglas revisadas, primero.** Solo tras una autorización posterior, ejecutar desde el artefacto revisado `firebase deploy --only firestore:rules --project prestcontrol-5e965`. Confirmar éxito y que el ruleset activo corresponde al revisado. No publicar frontend ni hacer push que dispare Netlify antes de esa confirmación.
5. **Mantener la pausa mientras se propagan las reglas.** Firebase documenta hasta un minuto para consultas/listeners nuevos y hasta diez minutos para listeners activos. Reservar al menos esa ventana desde el éxito, comprobar el ruleset activo y reconectar los clientes de forma controlada. El emulador no reproduce esos tiempos de producción; esperar por sí solo no acredita qué reglas se desplegaron. [Propagación y reemplazo de reglas](https://firebase.google.com/docs/firestore/security/get-started).
6. **Publicar v71 después.** Con reglas confirmadas y nueva autorización para commit/push, enviar el artefacto aprobado a `main` y dejar que Netlify publique automáticamente. No deploy manual, force push ni rebase. Verificar el despliegue correcto y disponibilidad de `index.html`, `services/index.js`, `services/CajaAperturaService.js`, `ui/caja.js` y `sw.js` de la misma versión. Netlify publica un conjunto de archivos atómicamente; no hay una transacción común con Firestore ni con las cachés y páginas ya cargadas. [Publicaciones atómicas de Netlify](https://docs.netlify.com/deploy/deploy-overview/).
7. **Actualizar y reconciliar cada instalación antes de habilitarla.** Recargar con conexión y sin trabajo sin guardar, verificar página/módulos v71 y shell `prestcontrol-shell-v71`; cerrar otras pestañas antiguas y comprobar los dispositivos que vuelven de offline. En cuentas existentes, consultar Caja desde v71 recupera/vincula la apertura original mediante el protocolo validado. Ese vínculo es metadato de la operación normal del nuevo cliente, no una prueba financiera ni una migración masiva. Revisar autoridad y movimiento, importe/ID originales, saldos y operaciones pendientes de todos los dispositivos. Si aparecen conflictos, bloquear la habilitación de esa cuenta y conservar las evidencias.
8. **Reabrir la operación gradualmente.** Exigir versiones confirmadas, colas sin errores ni pendientes, sin reset/restore incompletos y coincidencia de la apertura entre dispositivos. En producción verificar por lectura los datos existentes y observar el siguiente préstamo/cobro/renovación legítimos, sin inventar movimientos de prueba. Las pruebas adversas y de permisos se realizan solamente en Emulator. Registrar resultados; la comprobación física de PWA/Chrome Android, Samsung y Motorola sigue pendiente. Si no se puede cumplir un requisito anterior, no declarar el despliegue seguro ni reanudar indiscriminadamente.

## Fallos y recuperación

| Fallo | Procedimiento |
| --- | --- |
| Reglas no desplegadas o resultado incierto | No enviar frontend a producción. Confirmar el ruleset activo por lectura; conservar la pausa hasta conocer el estado. |
| Reglas nuevas activas pero falla Netlify | Mantener las reglas protectoras y la pausa. Corregir/publicar frontend hacia adelante. No reabrir aperturas, restauraciones ni resets de v70 para sortear el error. |
| Frontend publicado primero por accidente | Suspender aperturas y escrituras desde todos los dispositivos controlados; revisar por lectura si hubo aperturas duplicadas o modificaciones. Las reglas nuevas no reparan duplicados anteriores. Aplicar la protección solo mediante un despliegue autorizado y revisado. |
| Commit remoto de apertura confirmado pero respuesta/red/local falla | Reintentar la recuperación desde v71 con conexión. Recupera la apertura remota; no volver a crear saldo inicial ni compensaciones. |
| PWA vieja o cola rechazada | Conservar IndexedDB/cola y respaldo; actualizar y revisar Caja. Una apertura sin autoridad no se publica automáticamente; otras operaciones pueden seguir bloqueadas hasta conciliación. |
| Restauración/reset parcial | Detener escrituras y reintentos automáticos, capturar estado remoto y local, pendientes e identificador/último batch confirmado. Recuperación específica revisada; no reset, restauración ciega ni ajustes de saldo. |
| Necesidad de revertir frontend | No hay rollback financiero automático. Preferir una corrección compatible hacia adelante manteniendo reglas. v70 no confirma aperturas como v71 y puede bloquearlas o mostrar éxito local falso; su reactivación requiere revisión y pausa. Nunca revertir automáticamente a reglas permisivas. |

Un rechazo de batch no borró las operaciones locales en los ensayos. Eso no garantiza ausencia universal de pérdida: borrar almacenamiento pierde pendientes, un reset parcial elimina lógicamente datos y una restauración parcial puede sobrescribir movimientos ya confirmados. Por eso no se certifica una publicación sin riesgo con clientes antiguos activos.

## Evidencia de pruebas aisladas

Entorno: Firestore Emulator 1.20.4, proyecto fijo `demo-prestcontrol-apertura`, `127.0.0.1:8089`, Firebase compat 10.12.0 y fake-indexeddb en memoria. UIDs sintéticos únicos por ejecución. Sin importación de datos productivos, sin consultas/escrituras a Firebase de producción.

- `node tests/apertura-caja.test.cjs`: **25/25**, reejecutadas. Incluye concurrencia, reintentos, red, pérdida de respuesta, recuperación, réplicas obsoletas, respaldo anterior, cuenta legacy y protecciones de reglas.
- `node tests/despliegue-v71.test.cjs`: **11/11**. Matriz v70/v71, permisos de operaciones financieras, cola normal/mixta, restauración parcial, reset parcial, mutabilidad residual y rollback. Las aserciones de riesgo pasan porque logran reproducir el problema.
- Flujo financiero probado con funciones actuales de aplicación, SDK y reglas reales del emulador: saldo inicial 20.000.000; desembolso 1.000; cobro completo 600; parcial 200, pendiente 400; renovación nominal 700, compensación 400, efectivo entregado 300; saldo final **19.999.500**. Se preservan el importe original de apertura y las relaciones de renovación. El mismo flujo pasó con reglas v70 y nuevas.
- Se ejecutan los cálculos/funciones de préstamo, cobro completo/parcial y la transacción remota de renovación. Para publicar los payloads de préstamo/cobro el adaptador del ensayo usa batches reales, en lugar de recorrer toda la UI y cola IndexedDB. El ensayo de cola ejecuta `_pushToFirebaseSinLock` real con un adaptador local aislado. No es una prueba integral en navegador ni un ensayo físico de PWA.
- La suite adicional cambia reglas solo dentro del proyecto demo local y al terminar deja nuevamente las reglas v71. Ejecutar ambas suites secuencialmente, nunca en paralelo porque comparten las reglas del mismo emulador.

Reproducción: usar el runtime y arranque de emulador descritos en `CAJA_APERTURA_UNICA.md`; después ejecutar los dos comandos anteriores. No cambiar el destino demo/local por producción.

## Consulta secundaria: contactos

No se encontró exportación `.vcf`/vCard en el código activo, servicios, UI o legacy. `exportarExcel()` en `index.html` sí incluye la hoja Clientes con nombre y teléfono; también existen respaldos JSON. Ninguno equivale a un archivo de contactos importable como vCard.

Una actualización futura podría agregar una descarga local de los clientes no eliminados de la cuenta activa, una tarjeta por cliente con nombre (`FN`) y teléfono (`TEL`), escape/saltos de línea y codificación correctos, sin alterar los teléfonos almacenados ni escribir en Firebase, Caja, préstamos o sync. La normalización de teléfonos debería ser explícita y no inventar prefijos. No se implementó ni se generó ningún archivo de contactos. [Especificación vCard](https://www.rfc-editor.org/info/rfc6350/).

## Cambios y estado

Esta revisión agrega solamente `tests/despliegue-v71.test.cjs` y este informe. No modifica la implementación de v71, las reglas preparadas, el roadmap ni ninguna función de contactos. Los cambios locales anteriores continúan pendientes de revisión y publicación; no se implementó la carga histórica.

`git diff --check`: correcto. HEAD y la referencia local `origin/main`: `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`. La referencia remota no se actualizó por red en esta revisión. Working tree con cambios pendientes, no limpio. Sin commit, push, despliegue de reglas ni publicación Netlify. Se detuvo el emulador propio y se retiraron sus logs generados; se conservan las pruebas y documentación.

`git status --short --untracked-files=all`:

```text
 M docs/ROADMAP_MAESTRO.md
 M firestore.rules
 M index.html
 M services/index.js
 M sw.js
 M ui/caja.js
?? docs/CAJA_APERTURA_UNICA.md
?? docs/CARGA_INICIAL_HISTORICA_AUDITORIA.md
?? docs/REVISION_DESPLIEGUE_V71.md
?? firebase.apertura-test.json
?? services/CajaAperturaService.js
?? tests/apertura-caja.test.cjs
?? tests/auditoria-carga-inicial.cjs
?? tests/despliegue-v71.test.cjs
```

Estado: **APERTURA VALIDADA / DESPLIEGUE CONDICIONADO A CONCILIACIÓN Y ACTUALIZACIÓN CONTROLADA / SIN PUBLICAR**.
