# Revisión final de v71 — NO APTO

> Documento de diagnóstico conservado: sus reproducciones corresponden al código anterior a la corrección autorizada. Consultar [Corrección local de bloqueos v71](CORRECCION_BLOQUEOS_V71.md) y su evidencia de pruebas para el estado posterior. No se publicó ni desplegó ninguna versión.

**Resultado: NO APTO para publicación controlada en su estado actual.** La apertura conserva sus 25 regresiones aprobadas, pero la revisión de correcciones manuales reprodujo un defecto que elimina deuda cobrable de la proyección y dos rutas de edición que dejan réplicas/colas divergentes. No alcanza con prohibir verbalmente editar errores al cargar numerosos préstamos reales.

Esta revisión no modifica código de aplicación ni reglas locales. Agrega pruebas, evidencia y documentación. No se ejecutaron commit, push, deploy, publicación ni escrituras sobre Firebase de producción. Los errores reproducidos usan exclusivamente Emulator y datos sintéticos.

## 1. Corrección de errores: comportamiento comprobado

| Situación | Antes de finalizar la carga | Después del cierre |
| --- | --- | --- |
| Capital incorrecto | En borrador, editable. Ya confirmado, la referencia no admite sobrescritura. Solo en préstamo simple sin pagos ni relaciones de renovación puede anularse y registrarse uno nuevo con otra referencia, conservando el anterior. Con pagos no hay corrección general. | No se reabre la carga. La edición normal de capital exige un desembolso original de Caja; el préstamo histórico no lo tiene y se rechaza. No inventar ese desembolso. |
| Interés, cantidad, importes o vencimientos | Editables en el plan antes de confirmar. Un préstamo simple confirmado sin pagos puede sustituirse mediante anulación y nueva carga; no hay editor histórico de registros confirmados. | El editor normal ofrece algunos cambios si no hay pagos; no es una corrección histórica auditada. Reducir cuotas puede bloquear el batch de sincronización, como se reproduce abajo. No usarlo para corregir esta cartera hasta protegerlo. |
| Cuota marcada pagada por error | No hay acción para deshacer el pago. No admite pago negativo, borrado ni anulación del préstamo ya cobrado/cerrado. | No hay procedimiento histórico implementado para revertirlo conservando corte y saldo. Detener la operación afectada y revisar un corrector específico. |
| Pago parcial incorrecto | No se puede reducir ni reemplazar el evento. Si faltó registrar parte realmente cobrada, puede agregarse exclusivamente ese importe real con otro evento, si la cronología lo permite. Esto no corrige un sobreimporte, una fecha equivocada ni un duplicado ya registrado. | No hay corrector histórico implementado. No registrar un cobro/egreso actual ficticio para compensarlo. |
| Renovación equivocada | No hay reversión de la cadena. Reutilizar la referencia con datos nuevos se rechaza. **La anulación genérica del préstamo resultante es insegura.** | El corte no se reabre y no hay reversión histórica de la cadena. No usar una renovación nueva para ocultar el error de una anterior. |
| Reintentar tras perder respuesta | Misma referencia + mismos datos recupera lo confirmado sin duplicar; no es una edición. | El reintento de un evento existente recupera sus registros actuales sin reabrir la carga ni reenviar dinero. |

Una anulación de un préstamo simple conserva su evento original y deja ese préstamo `Cancelado`; el nuevo usa otra referencia y una nota documental que lo relaciona. No debe usarse ese mecanismo si el préstamo procede de una renovación o tiene dependencias. Actualmente el código no impone suficientemente esa distinción.

La verificación coteja el libro contra los eventos y valida sumas/referencias. No puede determinar que el monto coincide con el documento original del negocio: un pago mal digitado pero internamente consistente puede pasar. La revisión humana de documentación sigue siendo obligatoria.

## 2. Bloqueos reproducidos

### B1 — Anulación de renovación elimina deuda sin reversión

Código: `services/CargaHistoricaService.js:227` y `verificarLibro` en la misma clase.

Secuencia ejecutada contra reglas y transacciones reales del Emulator:

1. Préstamo original: capital 1.000, deuda 1.200, sin pagos.
2. Renovación histórica: nominal 1.500, deuda compensada 1.200, entrega adicional histórica 300, nuevo total pendiente 1.650.
3. Anulación genérica del préstamo nuevo: se permite porque sus cuotas propias no tienen cobros.
4. El préstamo original permanece `Pagado` por renovación; el nuevo queda `Cancelado`.
5. La deuda cobrable pasa de **1.650 a 0, sin un cobro ni una reversión**.
6. La verificación acepta el libro y permite finalizar la carga.

Los documentos/eventos originales permanecen físicamente, pero la proyección financiera pierde la deuda. Caja queda sin movimientos; eso no vuelve correcto el saldo de cartera. Este defecto bloquea la publicación.

### B2 — Editor normal posterior al corte deja una edición no sincronizable

Código: `index.html:6972`, `cuotasEliminadas` y el mensaje de éxito de `guardarEdicionPrestamo`.

Se ejecutó el editor real con JSDOM e IndexedDB en memoria sobre un préstamo histórico de dos cuotas, ya cerrada la carga y abierta Caja por 20.000.000. Al reducirlo a una cuota:

- La réplica local cambia y la interfaz informa «Préstamo actualizado correctamente».
- Se encolan tres registros, incluido un tombstone de una cuota histórica.
- Las reglas rechazan ese tombstone y el batch no se confirma.
- El servidor conserva dos cuotas; el dispositivo muestra una. La cola permanece pendiente.
- Caja remota mantiene 20.000.000.

No hubo pérdida remota en ese ensayo, pero la confirmación visual no representa convergencia y puede bloquear otros registros compartiendo batch.

### B3 — Edición de notas durante carga evita el guarda del commit financiero

Código: rama `!permiteEditarFinanzas` de `guardarEdicionPrestamo`, `index.html:7006`.

Con un histórico que ya tiene un parcial, editar las notas mediante el editor normal escribe directamente en IndexedDB y encola el cambio. La interfaz informa éxito, pero las reglas de carga activa rechazan la actualización porque no tiene evento/revisión histórica nuevos. La cola financiera pendiente impide luego continuar por la pantalla histórica. Reproducido con el editor real.

## 3. Solución mínima propuesta, sin implementar en esta revisión

1. **Protección inmediata:** impedir anular genéricamente préstamos originados por renovación o con vínculos posteriores. Agregar a la verificación el control de cadenas: una deuda cerrada por compensación no puede terminar en un sucesor anulado/eliminado sin reversión documentada. Debe impedir también finalizar un libro ya inconsistente.
2. **Cerrar los accesos al editor equivocado:** verificar fase/procedencia al principio de `guardarEdicionPrestamo`, antes de cualquiera de sus ramas o escrituras locales. Durante carga, toda modificación del registro histórico debe pasar por un evento histórico. Tras el cierre, bloquear cambios financieros de ese registro por el editor común hasta contar con un procedimiento correcto; las notas posteriores compatibles pueden mantenerse sin cambiar importes.
3. **Corrector mínimo para la carga manual:** «Deshacer último evento de una cadena de préstamo y volver a registrarlo», solo mientras la carga siga activa. Debe crear un evento correctivo inmutable con motivo, usuario, fecha de registro, referencia al original y revisión; reconstruir atómicamente préstamos/cuotas/pagos/vínculos, sin tocar Caja. Si existen operaciones dependientes, deshacerlas explícitamente en orden inverso o bloquear; no borrar ni sobrescribir la auditoría original.
4. **Después del cierre:** mantener el corte irreversible. Los errores de base histórica requieren un evento correctivo específico, revisado y separado de operaciones reales posteriores; no reactivar el modo histórico. Si hubo una devolución real o un cobro nuevo, es otro hecho económico que debe registrarse por el flujo normal correspondiente, nunca como compensación ficticia.

Para habilitar carga masiva manual, los puntos 1–3 son necesarios. El tratamiento posterior al corte debe estar claramente restringido/documentado; no se promete un corrector general que todavía no existe. Añadir pruebas de concurrencia, doble deshacer, dependencias, reintento, corte simultáneo, respaldo y convergencia de dispositivos. Las reproducciones B1–B3 deben convertirse en regresiones que exijan rechazo previo o corrección atómica válida.

## 4. Reglas ACTIVAS de producción: verificadas por lectura

Consulta realizada el **05/11/2026 a las 23:45:45 de Argentina** (`2026-11-06T02:45:45Z`), proyecto `prestcontrol-5e965`, base por defecto.

Se usó la sesión administrativa existente, sin iniciar una sesión nueva ni mostrar credenciales. Consultas de configuración:

```text
GET /v1/projects/prestcontrol-5e965/releases/cloud.firestore
GET /v1/projects/prestcontrol-5e965/rulesets/f4b33485-8e2c-4c09-8d70-755ab88da6f6
```

Resultado: las reglas activas coinciden con las de Git v70, normalizando saltos de línea/borde del archivo. Permiten al propietario leer/escribir bajo su UID; no incluyen la protección de apertura ni de carga histórica. **No coinciden con el archivo local v71.** Última actualización de la release obtenida: `2026-07-22T00:54:23.143808Z`.

- SHA-256 productivo: `ff33035e7cc439bf3a9504f9702433c2e4a6df938f65272afe4a01349bc6809e`.
- SHA-256 local revisado: `f05aba4344fc36551d2130434ccccd68ae8eeb5ca8466a116f97bf3397b4093d`.
- [Reglas activas descargadas](evidencia-v71/firestore-produccion.rules.txt), [metadatos de lectura](evidencia-v71/reglas-produccion-lectura.json), [comparación con reglas locales](evidencia-v71/reglas-produccion-vs-local.diff.json).

Estas API son consultas GET de configuración: [release](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get), [ruleset y su fuente](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get). No se consultaron clientes, pagos ni otros documentos financieros reales; no se probaron escrituras en producción.

## 5. Diff completo y pruebas reejecutadas

Se revisaron las modificaciones de aplicación respecto de `3ed27bc`, incluidos los tres módulos nuevos que todavía son untracked, puentes, reglas, guardas, respaldo/restauración y sincronización. Se fijaron hashes de los 14 archivos productivos nuevos/modificados en [artefactos-revisados.json](evidencia-v71/artefactos-revisados.json). No hubo cambios en ellos durante esta revisión.

Se conserva IndexedDB versión 7 y su base por usuario. No hay borrado/migración de clientes al actualizar. La activación histórica no modifica sus documentos; crea vínculos separados. Los cálculos financieros globales originales, configuración de Firebase y Auth se conservan. La extensión de métricas corresponde al historial por período. La ausencia de migración destructiva no sustituye la conciliación de réplicas/colas reales.

| Suite reejecutada | Resultado |
| --- | --- |
| `carga-historica.test.cjs` | 33/33 |
| `carga-historica-ui.test.cjs` | 13/13 |
| `apertura-caja.test.cjs` | 25/25 |
| `despliegue-v71.test.cjs` | 11/11 |
| `revision-correcciones-v71.test.cjs` | 9/9 |

**91 aserciones cumplidas no equivalen a publicación aprobada:** algunas prueban que una limitación/defecto puede reproducirse. B1–B3 siguen presentes. [Resultados y entorno](evidencia-v71/pruebas-revision.json). Proyecto demo local, SDK compat 10.12.0, Firestore Emulator 1.20.4, fake-indexeddb y JSDOM; sin datos productivos. El fragmento de auditoría readonly adicional también se comprobó con IndexedDB en memoria: conserva pendientes y propaga el error al cerrar la base.

## 6. Qué falta verificar en el entorno real

- Las reglas activas y la rama remota sí se comprobaron. `git ls-remote origin refs/heads/main` devuelve `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`, igual a HEAD. [Evidencia](evidencia-v71/git-remoto-lectura.json).
- **No se inspeccionaron las bases IndexedDB, colas, conteos o saldos reales de cada dispositivo/cuenta.** No puedo certificar que no existan pendientes, respaldos divergentes, duplicados anteriores o resets interrumpidos.
- No se validó físicamente PC/Samsung, ni el código efectivamente ejecutado en sus PWA. JSDOM no sustituye esa validación.
- No se verificó en Netlify el sitio, rama de producción, último deploy o vínculo activo con GitHub. No hay `.netlify/state.json` local; no se infiere la configuración del panel a partir de Git.

Por eso **no se confirma ausencia de pérdida para todas las cuentas existentes**. El diseño conserva los clientes v70 y los ensayos lo comprueban con datos sintéticos, pero hay un defecto financiero reproducido y el estado de dispositivos reales no fue conciliado.

## 7. Conciliación y respaldo previos: procedimiento preparado

No se ejecuta sobre cuentas reales en esta revisión. Para una ventana futura autorizada:

1. Inventariar UID, usuario, dispositivo, navegador/perfil, PWA/pestañas y base local de cada cuenta. Incluir equipos offline; si no pueden controlarse, detener el corte. Congelar cargas financieras, aperturas, restauraciones y resets durante la transición.
2. **Antes de sincronizar o actualizar**, guardar un respaldo manual v70 por cuenta/dispositivo y una copia local íntegra de IndexedDB, incluyendo eliminados, `sync_queue`, `config` y `sync_meta`. El respaldo manual excluye internos de sync y por sí solo no preserva la cola. Guardar las copias fuera del repositorio y con acceso restringido; no enviarlas como evidencia de código.
3. Para leer la réplica sin mutarla, se preparó [auditar-indexeddb-solo-lectura.js](evidencia-v71/auditar-indexeddb-solo-lectura.js). Puede evaluarse en DevTools de la cuenta desbloqueada; devuelve resumen y copia de stores mediante una transacción `readonly`, sin solicitudes de red. Guardar el resultado como JSON local si se utiliza para respaldo. Un error de lectura es **NO VERIFICADO**, nunca cola vacía. `getSyncQueuePending()` actualmente captura errores y puede devolver `[]`; no usar ese resultado como única evidencia.
4. Revisar cada pendiente/error por store, ID, tipo y contenido, junto con su registro local y la versión del servidor leída con confirmación remota. Identificar especialmente `SALDO_INICIAL`, borrados, restauraciones, pagos/huellas y renovaciones. No forzar un batch mixto de apertura ni descartar/editar entradas manualmente para que el contador llegue a cero.
5. Solo para pendientes legítimos y compatibles ya conciliados, el operador podrá usar «Guardar ahora» en la ventana autorizada. Eso escribe operaciones reales: no se hizo durante esta revisión. Si hay conflictos, aislar la cuenta y conservar copias para resolución específica; no ejecutar reparación, restore, reset o ajustes para sortearlos.
6. Repetir la lectura raw de la cola y comprobar en servidor IDs, importes, estado, fingerprints/vínculos y tombstones, no solamente conteos o indicador «En línea». Exigir cero pendientes/errores y ningún `restorePending` o reset `preparing`. Revisar varias aperturas activas o movimientos sin apertura antes de actualizar esas cuentas.
7. Guardar una segunda copia consistente posterior a la conciliación, más un snapshot remoto por UID de sus colecciones/autoridades obtenido mediante lectura. Verificar que los JSON abren, sus conteos/IDs y hashes; ensayar recuperación solo con copias aisladas en Emulator. No restaurar una copia vieja en producción como prueba.
8. Cerrar pestañas/PWA antiguas cuando no haya formularios sin guardar ni nuevas operaciones automáticas pendientes. No desinstalar la PWA, borrar almacenamiento ni eliminar caches de datos para forzar la actualización. Mantener un registro de antes/después por dispositivo.

Los respaldos no autorizan una restauración ciega: v71 rechaza una copia financiera divergente en una cuenta histórica y conserva autoridades remotas. Un incidente que requiera reponer datos del servidor necesita un plan de recuperación específico, no reiniciar Caja ni reabrir el corte.

## 8. Orden exacto de publicación, condicionado a resolver los bloqueos

**No ejecutar este orden con el artefacto actual.**

1. Resolver B1–B3 y habilitar la corrección mínima previa al cierre. Convertir los ensayos de riesgo en regresiones, repetir las suites y revisar de nuevo el diff/hashes finales. Ensayar el flujo completo y los errores en PC y Samsung con datos aislados.
2. Verificar por lectura la configuración activa Netlify/main y el ruleset productivo nuevamente; fijar artefactos aprobados, commit destino e identificador del sitio/deploy anterior. Confirmar que no existe una publicación automática ya pendiente.
3. Completar inventario, pausa, respaldos y conciliación de la sección 7. Confirmar clientes v70 guardados en servidor y en copias. Si falla cualquier requisito crítico, no seguir.
4. Con autorización posterior, desplegar **primero las reglas completas revisadas**, con proyecto explícito:

   ```powershell
   firebase deploy --only firestore:rules --project prestcontrol-5e965
   ```

   Verificar por GET release, fuente y hash efectivos. Firebase documenta hasta un minuto para consultas/listeners nuevos y hasta diez minutos para listeners activos; mantener la pausa durante esa ventana y verificar el ruleset, no solo esperar. [Propagación de reglas](https://firebase.google.com/docs/firestore/security/get-started).
5. Solo después de confirmar reglas y propagación, autorizar commit y push normal del frontend a `main`; Netlify debe publicar automáticamente. Sin force push, rebase ni deploy manual. Confirmar éxito del sitio y módulos de la misma versión, incluido `prestcontrol-shell-v71` y los tres módulos nuevos. Netlify no hace una transacción común con Firestore ni reemplaza el JS de todas las pestañas. [Publicaciones atómicas del sitio](https://docs.netlify.com/deploy/deploy-overview/).
6. Actualizar/recargar de forma controlada cada instalación y cerrar todas las pestañas antiguas. Conservar IndexedDB y sus clientes. Verificar página y módulos ejecutados además de service worker/caché: ver una caché v71 no acredita que una ventana ya esté ejecutando v71.
7. Comprobar PC y Samsung según la sección siguiente. En cuentas con Caja previa, v71 puede crear la autoridad que referencia su apertura original al recuperarla: es una escritura de control prevista en la futura operación autorizada, no un segundo saldo inicial. No se activó ni probó en producción durante esta revisión.
8. Habilitar gradualmente cuentas existentes; después permitir activar la carga en la cuenta con solo clientes. Mantener corte/apertura como decisiones explícitas; observar operaciones legítimas posteriores, sin fabricar transacciones financieras de prueba en producción.

### Fallos y recuperación

- Si falla o es incierto el deploy de reglas: no publicar frontend; consultar qué reglas quedaron realmente activas.
- Si las reglas están activas pero falla Netlify: conservar protección y pausa de operaciones incompatibles, corregir frontend hacia adelante. No revertir a reglas permisivas para desbloquear clientes viejos.
- Si aparece una réplica/cola divergente, restore/reset parcial o saldo inexplicable: detener la cuenta afectada, preservar snapshot/colas y revisar la secuencia; no borrar datos ni repetir aperturas.
- Volver el sitio a v70 no revierte reglas, datos, cortes ni PWA ya instaladas. No es un rollback financiero automático y no se propone como recuperación segura.

## 9. Comprobaciones PC y Samsung

**Antes de publicar, entorno aislado:** Chrome en PC y Chrome Android/PWA Samsung, mismo UID de prueba. Cargar préstamo, parcial, pago completo, renovación; cometer/corregir errores; cerrar; abrir Caja; registrar préstamo/cobro nuevos y reconectar un dispositivo atrasado. Verificar saldos, eventos, colas y convergencia; dejar los escenarios conflictivos sin efectos parciales. Probar también una cuenta de prueba con solo clientes v70 y otra con Caja ya iniciada. Este ensayo físico sigue pendiente.

**Después de una publicación autorizada, cuentas reales:**

- Confirmar UID, cliente IDs/nombres/teléfonos y cantidad antes/después. No usar «activar carga» en cuentas con finanzas previas.
- Comprobar shell, página/módulos, ausencia de errores JS/permisos/sincronización y formularios sin desbordes en Samsung vertical. Verificar todos los controles de header y el uso de la nueva pantalla.
- Comparar apertura original, movimientos, saldo, cartera y pendientes de ambos dispositivos con las referencias anteriores. Ninguna cartera histórica debe aparecer como ingreso/egreso.
- Examinar la siguiente operación legítima: el nuevo préstamo resta su efectivo real, el cobro suma solo su efectivo real y la renovación separa compensación/dinero nuevo. Comprobar IDs/fingerprints para no duplicar.
- No registrar importes ficticios en producción para comprobar funciones. No realizar una nueva apertura si ya existe ni finalizar una carga real como prueba.

## 10. Estado final de esta revisión

- **NO APTO**; apertura validada, carga manual sin corrector general y B1–B3 pendientes.
- Reglas productivas verificadas; colas/cuentas/dispositivos reales y configuración activa Netlify pendientes de inspección.
- Código productivo local sin cambios en esta revisión; se conservan v71 y sus reglas para corregir estos puntos sobre la misma base.
- `git diff --check`: correcto. HEAD, referencia local `origin/main` y rama remota leída: `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`. Working tree con cambios pendientes.
- Nuevos artefactos: este informe, `tests/revision-correcciones-v71.test.cjs` y `docs/evidencia-v71/*`; documentación previa marcada con el resultado de revisión. Sin commit, push, deploy ni modificaciones de datos reales.
