# Corrección local de bloqueos financieros v71

Fecha: 06/11/2026. Sin publicación, commit, push, deploy ni datos reales. Este informe actualiza el estado técnico de `REVISION_FINAL_V71.md`; el informe anterior y sus evidencias se conservan como diagnóstico anterior a la corrección.

## Cambios acotados

### B1: anulación de renovaciones

El servicio rechaza la anulación genérica de préstamos con origen o vínculos de renovación. Las reglas también la rechazan, aunque un cliente prepare un evento y revisión nuevos. La verificación del libro comprueba relaciones recíprocas, existencia de origen y sucesor y estado de la deuda; no permite cerrar una cadena cuyo sucesor haya quedado cancelado o ausente.

La corrección permitida es deshacer la renovación completa, no cancelar su sucesor. Una única transacción recupera el préstamo original y sus cuotas exactamente como estaban, incluidos parciales previos; marca el préstamo resultante y sus cuotas como revertidos. Capital compensado nunca se transforma en capital recuperado ni en ingreso de Caja.

### B2: edición de cuotas

El editor común identifica un préstamo histórico antes de cualquier rama o escritura. Rechaza cambios de capital, tasa, cantidad, período, fecha y prenda. Deshabilita esos controles y explica cómo corregir antes del cierre. Las reglas conservan las condiciones contractuales históricas después del corte, incluso para una PWA antigua; sí permiten los cobros y renovaciones normales posteriores.

Las ediciones de préstamos normales conservan su cálculo y cola; su aviso ahora dice que están guardadas en el dispositivo y pendientes de sincronización, sin afirmar confirmación remota. Una edición financiera histórica incompatible no modifica IndexedDB ni encola nada.

### B3: notas

Las notas de préstamos históricos usan confirmación remota. Durante carga crean un evento histórico; después del cierre y apertura confirmada, una transacción actualiza exclusivamente las notas del documento remoto actual. Nunca publica una copia financiera local desactualizada.

La réplica se escribe después de confirmar. Un rechazo de permisos o falta de conexión muestra un error y no anuncia éxito ni crea una cola incompatible. Si hubo confirmación remota pero falla la réplica, el mensaje distingue ambos hechos y pide recuperar el estado confirmado. Las notas de préstamos normales y los contactos/observaciones de clientes mantienen su funcionamiento.

## Deshacer el último evento antes del cierre

1. Abrir **Carga inicial de cartera histórica → Corregir un error antes del cierre**.
2. Seleccionar un evento disponible y escribir el motivo documental. Solo se ofrecen eventos originales aún vigentes en todos sus registros afectados.
3. Confirmar. El servidor vuelve a comprobar sesión, fase activa, inexistencia de apertura, revisión y registros. Si hubo una operación posterior incompatible, rechaza todo sin escribir parcialmente.
4. Se agrega el evento inmutable `R-<evento original>`, con motivo, UID, sesión, revisión, fecha de confirmación del servidor e imágenes anterior/posterior. La fecha económica conserva la del hecho corregido; no clasifica operaciones nuevas como históricas por su fecha.
5. Se recuperan los registros anteriores. Los creados por el evento erróneo quedan con `_deleted: true` y `revertidoPor`, sin borrar su documento ni la auditoría. No participan de deuda, cobros ni métricas vigentes.
6. Si se requiere otra corrección anterior de la misma cadena, deshacer primero los eventos posteriores. Una vez recuperado el estado, cargar los datos correctos con **otra referencia**, conservando las referencias anteriores.
7. Verificar otra vez cartera y documentos originales antes del cierre.

La identidad fija de corrección impide dos reversiones de un evento. Repetir la misma solicitud recupera su confirmación; cambiar el motivo de una corrección ya confirmada no la sobrescribe. Una respuesta perdida puede significar que el servidor sí confirmó: consultar/reintentar con la misma identidad antes de registrar otra operación.

Se permiten reversiones de altas, pagos completos/parciales, renovaciones, anulaciones simples y notas, siempre que no existan dependencias posteriores incompatibles. Deshacer un alta revierte sus cuotas; deshacer una renovación recupera la deuda original y sus pagos previos. No se permite deshacer una corrección para reutilizar referencias.

## Persistencia y reglas locales necesarias

Los eventos nuevos tienen `formato: 2`, imágenes por clave e identificación del último evento económico vigente. Las reglas ligan las imágenes con los registros realmente leídos/escritos, conservan procedencia, restringen las reversiones a las imágenes originales y exigen revisión/evento atómicos durante carga activa. Se conserva la protección de apertura única y el cierre irreversible.

Estos cambios de reglas son necesarios: una guarda visual no protege frente a pestañas antiguas, reintentos o llamadas de escritura anteriores. Solo se modificó el archivo local y se probó en Emulator; **no se desplegaron reglas**. Se verificó también una renovación de 120 cuotas y su reversión, sin dividir la operación en batches parciales. Se rechazan eventos que excedan el límite local de tamaño seguro.

Un evento de un prototipo local anterior sin imágenes de formato 2 no se convierte ni se revierte automáticamente. Puede leerse/verificarse con sus controles originales y de cadena, pero su corrección requiere revisión específica. Este formato histórico no está publicado en v70; no afecta los clientes cargados allí. No se ejecuta migración de datos.

La réplica histórica no crea `sync_queue`. Antes de escribir se lee la cola directamente con una transacción IndexedDB readonly: un fallo de lectura no equivale a cola vacía. Pendientes financieros deben conciliarse antes de continuar. Los vínculos de cliente se conservan incluso si un evento fue revertido, preservando su trazabilidad.

## Después del cierre

El cierre sigue siendo irreversible. Se pueden editar notas con conexión y Caja confirmada y registrar cobros/préstamos/renovaciones reales por los flujos normales. No se pueden reescribir capitales, planes ni pagos históricos desde el editor común ni ejecutar nuevas reversiones históricas.

Un error de base detectado después requiere un procedimiento administrativo auditado específico, aún no implementado. Detener la operación afectada, conservar respaldo y documentos y revisar el impacto sobre operaciones posteriores. No reabrir la carga, restaurar una copia vieja, reiniciar Caja ni crear cobros/egresos ficticios para compensarlo. El corrector previo al cierre no debe usarse como sustituto de revisar la documentación original.

## Pruebas y publicación

Ejecución final: **120 comprobaciones cumplidas, 0 suites fallidas**. De ellas, 112 comprueban comportamientos/regresiones y 8 reproducen riesgos de despliegue/legado que no se presentan como defectos corregidos.

| Suite | Resultado final |
| --- | --- |
| `carga-historica.test.cjs` | 33/33 |
| `carga-historica-ui.test.cjs` | 13/13 |
| `apertura-caja.test.cjs` | 25/25 |
| `despliegue-v71.test.cjs` | 11/11, incluidas 8 reproducciones de riesgo |
| `revision-correcciones-v71.test.cjs` | 9/9, incluidas las tres regresiones corregidas |
| `correcciones-historicas.test.cjs` | 29/29 nuevas comprobaciones |

Resultados finales en `evidencia-v71/pruebas-correcciones.json`. Las cinco suites previas se repiten; las tres reproducciones de `revision-correcciones-v71.test.cjs` ahora exigen el comportamiento corregido. Su versión anterior se conserva en `evidencia-v71/reproducciones-antes-correccion.test.cjs.txt`, junto con el diagnóstico previo. Los escenarios de riesgo de despliegue de `despliegue-v71.test.cjs` siguen siendo riesgos documentados, no correcciones financieras.

Se añaden pruebas de cadenas con parciales, reversiones, imágenes inválidas rechazadas por reglas, concurrencia/reintentos, pérdida de confirmación, dos réplicas, UI real, respaldo/restauración, ediciones normales y corte. Todo usa proyecto demo y datos sintéticos. `disableNetwork()` del SDK no equivale a un cortafuegos de todas las RPC de transacción: se ensayan tanto respuesta ambigua y recuperación como fallo de transporte previo al envío.

Los clientes v70 se conservan: misma base IndexedDB versión 7, sin limpieza ni modificación automática de clientes. Shell local: `prestcontrol-shell-v71`. No se modifica la implementación del servicio de apertura durante esta corrección.

Archivos productivos modificados en esta intervención: `services/CargaHistoricaService.js`, `ui/carga-historica.js`, `index.html`, `firestore.rules` y `ui/historial.js`. Se agrega la suite de correcciones, se transforma la suite de revisión en regresiones, se conserva su fuente anterior y se actualizan informe/roadmap/evidencia. Los demás cambios v71 existentes se conservan.

El procedimiento de publicación conjunta sigue siendo el de la revisión final: validación física aislada PC/Samsung, inventario y pausa de dispositivos, respaldos completos, conciliación por ID/importe con el servidor, reglas primero y confirmación de propagación, aplicación después y recarga de todas las PWA. No se verificaron en esta intervención las colas/cuentas reales, la configuración activa Netlify ni los dispositivos físicos. No se publica con esos requisitos pendientes.

Las reglas mantienen las operaciones y mecanismos anteriores en cuentas sin carga histórica; no convierten todos los movimientos financieros normales en registros inmutables. En particular, las restauraciones/reset de PWA viejas y las colas mixtas conservan los riesgos descritos en la revisión de despliegue. Hay que controlar todos los dispositivos y conciliarlos; no basta con ver una caché v71 ni con que las pruebas aisladas aprueben. Las reglas productivas consultadas en la auditoría anterior siguen siendo evidencia de ese instante; no se volvió a acceder a producción en esta corrección.

Si falla el despliegue, conservar las protecciones y la pausa de operaciones incompatibles; no volver a reglas permisivas ni restaurar finanzas ciegamente. Publicar frontend antiguo antes/después de reglas nuevas no es un rollback financiero.

## Conclusión y Git

Los tres bloqueos financieros identificados quedaron corregidos y el corrector previo al cierre pasó sus regresiones. No se detectaron bloqueos financieros adicionales en los flujos probados. **VALIDADO LOCALMENTE; PUBLICACIÓN PENDIENTE DE REVISIÓN OPERATIVA**, sin autorización de publicar. La limitación administrativa posterior al cierre es explícita, bloquea cambios incompatibles y no se resuelve reabriendo la carga.

`git diff --check` correcto; sintaxis de módulos, scripts inline y pruebas verificada. Working tree con cambios pendientes, incluyendo el trabajo v71 previo. HEAD y referencia local `origin/main` conservados en `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`. Sin commit, push, deploy ni modificaciones de datos reales. El Emulator local se detuvo al terminar.
