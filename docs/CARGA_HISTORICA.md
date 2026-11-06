# Carga inicial histórica — diseño previo

> La revisión anterior dejó el artefacto **NO APTO** por tres bloqueos. Su corrección local y el nuevo corrector previo al cierre se documentan en [Corrección de bloqueos v71](CORRECCION_BLOQUEOS_V71.md). El diagnóstico anterior se conserva como evidencia. La publicación sigue pendiente de revisión, pruebas finales y requisitos operativos; no está autorizada.

Base: código local v71, sin publicar. No se modifican cuentas reales ni se usa producción para las pruebas.

## Autoridad y reglas necesarias

La autoridad nueva `users/{uid}/carga_inicial/estado` queda fuera de IndexedDB, colas y stores reemplazados por respaldos. Estados: `preparando` (barrera de comprobación), `activa`, `finalizada` (corte irreversible), `rechazada` (la comprobación detectó datos financieros previos). Activación explícita; los clientes existentes se conservan y no se reclasifican. Nunca habilitar si ya existe autoridad de Caja.

Una consulta de colecciones vacías seguida de una transacción no basta: un cliente antiguo puede escribir en el intervalo. Por eso primero se comprueba, después se instala transaccionalmente la barrera y se vuelve a comprobar el servidor. Si aparece cualquier dato financiero previo, no se convierte: se rechaza la activación y se conservan todos los registros. Una comprobación interrumpida puede continuarse explícitamente, sin habilitar el modo automáticamente.

Cada operación histórica confirma en una sola transacción préstamo/cuotas/pagos, auditoría inmutable y revisión del estado. No genera ni encola movimientos de Caja. Referencia externa obligatoria y estable para reintentos idempotentes. La auditoría conserva solicitud y registros resultantes, UID, sesión, fecha económica original y confirmación de servidor.

Las reglas locales deben extender, sin quitar, las protecciones de apertura v71:

- Proteger la nueva autoridad y sus transiciones; no eliminar ni reabrir una carga finalizada.
- Durante preparación/carga, impedir operaciones financieras normales de versiones anteriores y escrituras históricas sin evento/revisión atómicos. Permitir el CRUD habitual de clientes.
- Impedir movimientos de Caja durante la carga y antes de abrir Caja tras el cierre. La apertura y el cierre leen el mismo documento de autoridad.
- Conservar la clasificación histórica después del corte; las cuotas históricas pueden recibir nuevos pagos normales una vez abierta Caja. La clasificación del préstamo no determina la del nuevo pago.
- Proteger la autoridad frente a reset/restauración. En cuentas que usaron carga histórica, una restauración no puede sustituir datos financieros diferentes ni publicar un snapshot anterior sobre el libro confirmado: el cliente debe rechazarla antes de escribir y las reglas restringir las escrituras de restauración. Una copia idéntica puede recuperar la réplica, conservando la autoridad remota.
- Las cuentas sin autoridad de carga mantienen el comportamiento v71. No se activa por fecha ni por ausencia aparente de datos locales.

La eliminación actual de un cliente hace borrado en cascada de su cartera. Antes de implementar esa protección adicional se documenta su necesidad: un índice remoto inmutable `carga_inicial_clientes/{clienteId}` vinculará los clientes usados en eventos históricos, sin modificar su documento. Las reglas impedirán eliminar esos clientes; las altas y modificaciones de contacto permanecerán permitidas. Así una PWA desactualizada tampoco podrá borrar el vínculo y provocar una restauración parcial de la cartera auditada.

Estos cambios son necesarios para proteger también frente a dispositivos desactualizados; un booleano local no alcanza. Se prepararán únicamente en `firestore.rules` y se probarán con Firestore Emulator. **No se desplegarán reglas.**

## Verificación y cierre

La verificación lee un snapshot estable por revisión, reconstruye el libro a partir de los eventos y comprueba referencias, planes, pagos, compensaciones y métricas. El cierre vuelve a leer esa revisión en una transacción: si otro dispositivo registró una operación, exige verificar de nuevo. El corte es un timestamp del servidor, nunca una fecha local que convierta automáticamente pagos en históricos.

Caja solo se abre después del cierre en cuentas con carga activada. La apertura v71 conserva su autoridad fija y su transacción exclusiva. En cuentas existentes sin carga, sigue funcionando como antes. Una carga histórica exige conexión; no se crean operaciones históricas pendientes offline.

## Alcance previsto

Pantalla específica desde Configuración/Caja: activar, registrar préstamos con fechas/plan originales, pagos completos/parciales y dos renovaciones compatibles con los modelos existentes (refinanciación de deuda y cobro de interés con renovación de capital), verificar y finalizar. Los préstamos totalmente cancelados mediante pagos quedan `Pagado`, como en el resto de PrestControl. Las anulaciones sin cobro no deben inventar ingresos.

Se reutilizan el servicio de planes, helpers de saldos y métricas existentes. Los clientes ya cargados en v70 permanecen intactos. No se crean funciones de contactos.

## Implementación local terminada

Entrada desde **Configuración → Carga histórica / verificar corte**, o desde Caja antes de iniciarla. No se modifica `DB_VER` (7), no se limpian stores ni se ejecuta ninguna migración. Los clientes existentes conservan ID y contenido; las vinculaciones históricas se guardan en documentos nuevos separados.

`CargaHistoricaService` concentra activación, préstamos, pagos, dos modalidades de renovación, anulaciones sin cobros, verificación, cierre y validación de respaldos. La UI es independiente de los formularios normales. Se confirmó el funcionamiento con el mismo SDK compat 10.12.0 de PrestControl.

Cada solicitud tiene referencia externa obligatoria y estable. El evento `H-<referencia>` es inmutable por UID; la misma solicitud recupera lo confirmado, y una referencia reutilizada con otro contenido se rechaza. Préstamos `PH-*`, cuotas `CH-*` y pagos `HH-*` evitan interferir con los contadores existentes `PR-*`/`C-*`. Una referencia diferente representa otra operación documental: no se deduplican automáticamente personas o recibos distintos por coincidencia de nombre/importe.

Los registros históricos llevan `cargaInicial` (versión, UID, sesión, referencia original, fecha de registro) y `ultimaOperacionHistorica`. El evento conserva solicitud, fecha económica y registros resultantes. No se crean movimientos de Caja, ni siquiera compensatorios, ni entradas financieras pendientes en `sync_queue`. Una respuesta perdida se recupera con la misma referencia y consulta del servidor; la réplica IndexedDB se aplica sin tocar clientes ni borrar registros.

Las transacciones leen la autoridad de carga, la de Caja y el reset. Un contador serializa los eventos históricos. El Emulator reprodujo un rechazo de reglas sobre revisión obsoleta durante concurrencia; se incorporó un reintento acotado exclusivamente cuando una lectura autoritativa demuestra que el estado cambió. Un rechazo estable de permisos se propaga, sin rebajar validaciones.

La apertura v71 conserva ID fijo, autoridad permanente, transacción, confirmación remota y guardas de restauración/cola. Solo agrega la lectura del estado histórico: no abre durante `preparando`/`activa`. En cuentas sin carga, su comportamiento anterior se conserva; las 25 regresiones pasaron nuevamente con las reglas finales.

## Uso paso a paso

1. Sincronizar los clientes que ya se están cargando en v70 y actualizar todos los dispositivos después de la publicación autorizada. No crear otra cuenta ni vaciar IndexedDB para usar la función.
2. Entrar en la pantalla histórica y activar explícitamente. Se rechaza una cuenta con registros financieros previos, incluso tombstones, o Caja iniciada. Una cuenta con solo clientes es compatible. Si la segunda comprobación detecta una escritura concurrente, conserva sus datos y deja la carga rechazada; no convierte nada.
3. Registrar cada préstamo original: referencia, cliente, fecha, capital, interés por cuota, período y cantidad. Se admite total contractual original y edición de cada vencimiento/importe. El plan debe reconciliar exactamente; el último centavo del plan calculado se ajusta en la última cuota. Límite de 120 cuotas por préstamo y total hasta 10^12 para conservar precisión monetaria.
4. Registrar los pagos completos o parciales con fecha e importe realmente cobrados. Todos quedan auditados en `pagos_cuota`; al completar todas las cuotas el préstamo queda `Pagado` (cancelado mediante pagos). El historial y el riesgo usan las fechas originales. Un parcial vencido mantiene el préstamo atrasado.
5. Registrar renovaciones en orden cronológico. En refinanciación, nominal = saldo pendiente compensado + dinero adicional realmente entregado; el efectivo anterior ya cobrado permanece en sus pagos. En renovación de capital, se requiere una cuota sin parciales y separación exacta de interés cobrado/capital renovado, como en el modelo normal existente. Se conservan vínculos y cuotas compensadas. Ninguna modalidad modifica Caja durante la carga.
6. Verificar cartera, documentación original y datos del informe. La verificación compara todos los registros financieros contra la secuencia de eventos, controla clientes, planes, pagos y compensaciones y calcula métricas. No crea ajustes ni modifica saldos para forzar coincidencias.
7. Escribir `FINALIZAR` y confirmar. Se verifica nuevamente y se exige la misma revisión. El corte operativo es fecha/hora del servidor y es irreversible. Una operación concurrente que cambia la revisión obliga a verificar otra vez; una operación posterior al corte se rechaza.
8. Abrir Caja con el dinero real disponible mediante la apertura única v71. Una cartera de 60.000.000 no se suma a una apertura de 20.000.000. Dos aperturas concurrentes convergen al mismo importe confirmado, sin sobrescritura.
9. Operar normalmente. Un pago nuevo sobre un préstamo histórico crea ingreso de Caja y un pago normal; la procedencia histórica del préstamo se conserva. Ingresar una fecha antigua después del corte no convierte la operación en histórica.

## Historial, riesgo y operaciones normales

La composición económica del servicio de métricas se conserva. Se agrega distribución de interés real por fecha de cobro para el historial de cuentas con registros de carga; se separan deuda compensada y dinero cobrado, incluidos parciales anteriores a una renovación. La ganancia real del resumen usa el mismo servicio de métricas. Las cuentas sin registros históricos mantienen su presentación/cálculos anteriores.

Las guardas de formularios y commits locales impiden registrar accidentalmente operaciones normales durante la carga. Los cambios automáticos de estados de registros históricos no se encolan antes de Caja; la UI/servicios calculan vencimiento y riesgo con las fechas originales. Después de abrir Caja, siguen los mecanismos normales de actualización y sincronización.

Se bloquea el borrado general/reset/mantenimiento destructivo de cuentas con carga auditada y la eliminación de clientes o registros históricos vinculados. Esta protección evita las rutas de cascada encontradas; no modifica documentos de clientes durante la activación o importación. Las altas de clientes y las ediciones de contacto siguen permitidas. Una PWA vieja puede conservar una réplica local divergente si intenta operaciones rechazadas: debe actualizarse y conciliar, sin limpiar almacenamiento.

## Backup, restauración y sincronización

- El respaldo manual histórico usa formato v7 e incluye estado y eventos confirmados. Para esa cuenta se obtiene el libro financiero del servidor y se comprueba estabilidad entre lecturas; requiere conexión. Los clientes del respaldo se conservan desde la réplica local, incluidos los ya ingresados en v70. Antes de exportar, sincronizar y pausar escrituras en otros dispositivos para obtener una copia coherente.
- El estado del archivo es informativo/auditable: no se importa a `carga_inicial`, `carga_inicial_eventos` ni `carga_inicial_clientes`. Esas autoridades permanecen en Firebase y no participan de resets, colas ni stores reemplazados.
- Durante preparación/carga se permite exportar, pero se rechaza restaurar antes de modificar la réplica. Después del cierre, una copia con el mismo libro financiero puede restaurarse y publicarse con metadatos de restauración; una copia anterior o financieramente distinta se rechaza antes de escribir. El corte remoto no cambia aunque la copia diga `activa`.
- No se admite importar una cartera histórica en otra cuenta sin su autoridad remota confirmada. Un desastre que incluya pérdida administrativa del servidor exige recuperación específica revisada; no se simula creando otra carga desde un JSON.
- Los datos financieros estándar siguen en las colecciones actuales y se reciben por el pull/realtime existentes. El estado histórico se consulta del servidor al usar la pantalla o los guardas; la copia en `config` es cache por base de usuario, nunca autoridad para reabrir la carga.
- Las reglas rechazan cambios financieros enviados como restauración distinta en cuentas históricas, sin endurecer globalmente la inmutabilidad de las cuentas antiguas que no activaron la función. Las restauraciones siguen usando varios batches: no se promete atomicidad global frente a fallos de red. Un estado `restorePending` debe resolverse antes de retomar operaciones.

## Pruebas ejecutadas

Datos exclusivamente sintéticos, UIDs únicos por ejecución; Firestore Emulator 1.20.4 en `127.0.0.1:8089`, proyecto `demo-prestcontrol-apertura`, Firebase compat 10.12.0, fake-indexeddb 6.2.4 y JSDOM 26.1.0. Sin configuración ni datos de producción.

| Suite | Resultado | Alcance |
| --- | --- | --- |
| `tests/carga-historica.test.cjs` | 33/33 | Activación, preservación de clientes v70, barrera concurrente, préstamos/planes, pagos completos/parciales, dos renovaciones, métricas, riesgo, reintentos, cierre, apertura posterior, finanzas normales, respaldos, aislamiento y reglas. |
| `tests/carga-historica-ui.test.cjs` | 13/13 | DOM real aislado, formularios, plan editable, pagos/renovación, informe, corte, guardas, IndexedDB, exportación, restauración completa y publicación idéntica, commit/cola/push normal posterior. |
| `tests/apertura-caja.test.cjs` | 25/25 | Regresión completa de apertura v71 con reglas finales, dos dispositivos/pestañas, red/reintentos, respaldo/restore y cuentas existentes. |
| `tests/despliegue-v71.test.cjs` | 11/11 | Compatibilidad y reproducción de riesgos de despliegue/rollback en cuentas sin carga histórica. Un ensayo de riesgo aprobado significa que el riesgo se reprodujo, no que se eliminó. |

Ejemplos financieros comprobados:

- Préstamo 1.000, total 1.200, pago histórico 200: capital pendiente 833,33; interés pendiente 166,67; capital recuperado 166,67; interés cobrado 33,33; movimientos de Caja: cero.
- Renovación de esa deuda pendiente 1.000 a nominal 1.300 con entrega histórica 300: cartera nueva conserva composición de capital/interés, cobrado anterior 200 y compensación 1.000; Caja sigue sin movimientos.
- Renovación de capital 1.000 con interés real cobrado 100: interés histórico 100, capital pendiente 1.000; ningún ingreso de Caja.
- Apertura posterior 20.000.000; nuevo préstamo 1.000: Caja 19.999.000. Cobro normal 600 con fecha antigua: Caja 19.999.600; no se reclasifica como histórico.
- Cobro normal 400 sobre deuda con parcial histórico: Caja 20.000.400; el pago antiguo sigue histórico y el nuevo es normal.
- La UI y el commit/push reales confirmaron una cartera histórica sin movimientos y un préstamo nuevo de 100: saldo remoto 19.999.900, sin reenviar los desembolsos anteriores.

Los ensayos ejecutan SDK y reglas reales del Emulator. El recorrido de pantalla usa JSDOM, no una PWA física; las adaptaciones locales aíslan Auth/DOM/red y los commits de permisos cuando corresponde. No se arrancó la aplicación con Firebase de producción.

### Reproducción

Usar el runtime temporal indicado en `CAJA_APERTURA_UNICA.md` y añadir `jsdom@26.1.0`; no hay nuevas dependencias productivas. Iniciar el Emulator con `firebase.apertura-test.json` y proyecto demo. Luego, **secuencialmente** (las suites comparten reglas del mismo Emulator):

```powershell
node tests/carga-historica.test.cjs
node tests/carga-historica-ui.test.cjs
node tests/apertura-caja.test.cjs
node tests/despliegue-v71.test.cjs
```

`git diff --check` y compilación de scripts inline/módulos: correctos. Los logs generados del Emulator se retiran al finalizar; no se incorporan al código.

## Publicación conjunta futura, pendiente de autorización

El informe `REVISION_DESPLIEGUE_V71.md` conserva la revisión previa de apertura. Para publicar ambas mejoras, el artefacto revisado debe contener **las reglas extendidas actuales y todos los módulos nuevos**, no solo la versión anterior del archivo de reglas.

1. Revisar diff/artefactos y comparar por lectura las reglas activas con la base revisada. Confirmar proyecto `prestcontrol-5e965` e integración Netlify/main; no hay `.firebaserc` local. Guardar referencia del despliegue/reglas y respaldos seguros. No se realizó esta inspección productiva en las pruebas.
2. Inventariar todas las cuentas/dispositivos/pestañas, incluidos offline. Para la cuenta donde se están cargando clientes v70, terminar y confirmar esas altas en el servidor. Conciliar pendientes y conservar bases/colas. No resolver diferencias con reset ni restauración automática.
3. Acordar una pausa de escrituras, aperturas, resets/restauraciones y cerrar sesiones/pestañas antiguas sin trabajo sin guardar. Las cuentas con finanzas previas continúan en operación normal después; no se activa la carga automáticamente. Si no pueden controlarse clientes antiguos, no declarar segura la transición.
4. Con autorización posterior, desplegar **primero** `firestore.rules` revisado, únicamente reglas y con proyecto explícito. Verificar ruleset activo y contemplar hasta diez minutos de propagación de listeners activos según Firebase; el Emulator no simula esos tiempos. No hacer un push que dispare Netlify antes de confirmar las reglas. [Documentación de propagación](https://firebase.google.com/docs/firestore/security/get-started).
5. Después, y solo con autorización, commit/push del frontend aprobado y publicación automática de Netlify. Confirmar entrega de módulos de apertura y carga, puentes UI/servicios y `sw.js`. Shell local sigue `prestcontrol-shell-v71`, aún no publicado; incluye ambos módulos en precache. No se cambió la versión de IndexedDB.
6. Actualizar y recargar controladamente **todos** los dispositivos/pestañas. Verificar código ejecutado y shell; no basta ver caché v71 mientras una pestaña sigue ejecutando código anterior. Conservar clientes y colas; nunca desinstalar/limpiar datos como método de actualización.
7. Comprobar por lectura clientes, cuentas con Caja existente, aperturas originales, pendientes y saldos. Validar físicamente Chrome Android/PWA Samsung/Motorola. No crear préstamos/cobros ficticios en producción para comprobar permisos; esos ensayos se hacen en Emulator.
8. Reanudar operación normal de las cuentas existentes. En la cuenta solo con clientes, activar explícitamente la carga, registrar/verificar cartera, finalizar y abrir Caja una vez. Supervisar los siguientes movimientos legítimos y convergencia entre dispositivos.

Si falla la publicación del sitio después de instalar reglas, mantener protección y pausa de operaciones incompatibles; corregir frontend hacia adelante. No volver a reglas permisivas para desbloquear una cola. Una apertura confirmada se recupera, no se repite; una carga finalizada no se reabre. Un restore/reset parcial requiere diagnóstico específico preservando evidencias.

## Limitaciones pendientes

- Sin validación física ni consulta de reglas/cuentas productivas. Publicación sujeta a actualización controlada de todas las PWA y verificación de sus colas.
- Carga solamente online y por las modalidades indicadas, con referencias documentales. No se implementó importación masiva ni corrección/reescritura libre de eventos ya confirmados. Ante un error de carga con cobros registrados, conservar la auditoría y revisar un procedimiento específico antes de seguir; no anular ni inventar pagos para compensarlo.
- No se inventan condonaciones, ejecuciones de prendas ni ajustes históricos que el módulo no represente. Casos con esas condiciones necesitan revisión/modelo explícito antes de cargarse. Las garantías/ventas antiguas no se importan mediante esta pantalla; sus formularios normales se conservan para la operación posterior.
- No se certifica que todos los movimientos de cuentas antiguas sean inmutables por reglas. Se conserva el riesgo de restauraciones/resets de PWA anteriores indicado en la revisión previa; no deben quedar activas durante la transición.
- Una copia financieramente distinta no puede retroceder el libro confirmado de una cuenta histórica. Es una restricción deliberada de integridad, no una recuperación automática de cualquier snapshot.

## Archivos de esta continuación

- Nuevos: `services/CargaHistoricaService.js`, `ui/carga-historica.js`, `tests/carga-historica.test.cjs`, `tests/carga-historica-ui.test.cjs` y este documento.
- Integración y protecciones: `index.html`, `firestore.rules`, `services/CajaAperturaService.js`, `services/index.js`, `ui/index.js`, `ui/caja.js`, `ui/clientes.js`, `ui/prestamos.js`, `ui/prendas.js` y `sw.js`.
- Historial: `services/MetricasFinancierasService.js` (método adicional; motor económico existente conservado) y `ui/historial.js`.
- Documentación de continuidad: `docs/ROADMAP_MAESTRO.md`, `docs/CAJA_APERTURA_UNICA.md`, `docs/CARGA_INICIAL_HISTORICA_AUDITORIA.md` y `docs/REVISION_DESPLIEGUE_V71.md`.

Los artefactos locales anteriores de v71 y sus pruebas se mantienen. No se modificaron `core/firebase.js`, `AuthService`, credenciales ni reglas desplegadas. HEAD y referencia local `origin/main` continúan en `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`; no se actualizó esa referencia por red. Working tree con cambios pendientes, no limpio.

Estado: **IMPLEMENTADO LOCALMENTE / PRUEBAS AISLADAS APROBADAS / SIN PUBLICAR**. Sin datos reales modificados, commit, push, deploy de reglas ni publicación Netlify.
