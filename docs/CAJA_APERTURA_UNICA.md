# Apertura única de Caja — diseño y validación local

Base: v70 (`3ed27bc`). Alcance autorizado: exclusivamente integridad de apertura. No se implementa la carga histórica.

Actualización posterior autorizada: la carga histórica ya está implementada localmente sobre esta base; consultar [CARGA_HISTORICA.md](CARGA_HISTORICA.md). La apertura conserva sus protecciones y agrega la lectura del estado histórico para impedir abrir antes del cierre. Sus 25 pruebas se repitieron con las reglas extendidas. Este documento conserva el diseño original de la corrección v71.

## Diseño previo a la implementación

La apertura se decide en una transacción Firestore por UID. Lee un documento fijo `users/{uid}/control_caja/apertura_GENERAL` y el movimiento correspondiente antes de escribir. Si otra transacción gana, Firestore reintenta y la segunda recupera la apertura ganadora. No se confirma éxito ni se crea una apertura local pendiente antes de la confirmación del servidor.

Las aperturas existentes se descubren con lectura explícita del servidor. Se conserva su movimiento íntegro y se vincula mediante metadatos nuevos; no se recalculan saldos ni se cambian operaciones existentes. Si hay varias aperturas activas o evidencia de un reinicio anterior sin apertura vigente, se bloquea la creación para revisión.

La cola general nunca crea una apertura a partir de una operación pendiente. Consulta la apertura autoritativa, recupera su réplica y retira de publicación el intento obsoleto. Un fallo entre confirmación remota y persistencia local se recupera repitiendo la consulta, sin crear otro movimiento. Los intentos locales incompatibles se conservan en una auditoría local antes de sustituir su réplica; no se modifican registros financieros remotos.

Las restauraciones deben comprobar la apertura remota antes de reemplazar datos locales. Un respaldo anterior que no contiene esa apertura conserva la confirmada. Uno que contiene una apertura distinta o un importe incompatible se rechaza antes de aplicar la restauración. La autoridad de apertura queda fuera de los stores reemplazados por el respaldo.

## Necesidad de reglas adicionales, documentada antes de modificarlas

Las reglas actuales permiten al propietario escribir cualquier documento bajo su UID. Una transacción del cliente nuevo no impide que una PWA antigua publique un batch incompatible. Es necesario proteger también en el servidor:

- Autoridad de apertura de creación única, vinculada al movimiento en la misma operación atómica, sin actualización ni eliminación por clientes.
- Nuevos `SALDO_INICIAL` permitidos solamente si la autoridad resultante apunta a ese movimiento.
- Aperturas existentes inmutables en sus datos financieros, incluso si aún no tienen autoridad. Solo se admiten metadatos de sincronización/restauración compatibles.
- Sin eliminación ni conversión de una apertura a otro tipo. Los demás movimientos conservan sus permisos actuales por UID.
- La autorización recursiva existente debe excluir esos caminos: una regla restrictiva superpuesta no revoca otra autorización permisiva.
- El reinicio total no puede modificar la barrera de reset de una cuenta con apertura protegida, porque dejaría inaccesible una apertura que no puede borrarse. El cliente actualizado debe advertirlo antes de iniciar un reset.

Estos cambios se prepararán únicamente en el archivo local de reglas y se probarán en un emulador con proyecto `demo-`. No se aplicarán a Firebase de producción. La garantía frente a clientes antiguos depende de desplegar esas reglas en una publicación futura revisada; el código de frontend por sí solo no puede ofrecerla.

## Límite de compatibilidad y preparación del corte histórico

La autoridad no depende de la fecha del movimiento, del dispositivo ni del identificador de reset. No se elimina al restaurar un respaldo. El futuro cierre de carga histórica deberá coordinarse con esta misma decisión transaccional y sus reglas; no se agrega ahora ningún modo histórico.

Los clientes antiguos pueden seguir mostrando un éxito local incorrecto porque su interfaz no espera al servidor. Con las reglas nuevas no podrán modificar la apertura confirmada ni crear una segunda. Deben actualizarse para recuperar la confirmación autoritativa y converger también en pantalla. Las reglas no corrigen datos ya duplicados antes de su instalación ni restringen escrituras administrativas que las omitan; cualquier inconsistencia preexistente exige revisión, sin conversión automática.

## Fuentes oficiales

- [Transacciones: reintentos por concurrencia y fallo sin conexión](https://firebase.google.com/docs/firestore/manage-data/transactions).
- [Aislamiento y serialización](https://firebase.google.com/docs/firestore/transaction-data-contention).
- [Reglas superpuestas](https://firebase.google.com/docs/firestore/security/rules-structure).
- [Validación atómica mediante getAfter](https://firebase.google.com/docs/firestore/security/rules-conditions).

## Resultado de implementación y pruebas

Implementado localmente mediante `CajaAperturaService`, un puente de persistencia atómica IndexedDB y guardas acotadas de cola, pull/realtime y restauración. `CajaService` conserva sus cálculos y reglas económicas; no se cambiaron préstamos, pagos, métricas, Auth ni datos reales.

La autoridad es permanente por UID y cuenta GENERAL. La apertura nueva usa el ID fijo `MC-APERTURA-GENERAL-V1`. Una cuenta legacy conserva exactamente el ID y contenido de su apertura existente; solo se añade la autoridad. Ninguna apertura se crea desde una cola antigua. Si un intento local no coincide con el servidor, se conserva su copia en `config` (`cajaAperturaReplicaAnterior:*`), se retira de publicación con estado `superseded` y se sustituye su réplica por la confirmada. Un intento local con otro ID que no fue reconocido por la autoridad queda marcado como rechazado en la réplica, sin enviarlo como borrado remoto. Los demás movimientos no se alteran.

Si el servidor no tiene apertura pero existe un intento local antiguo, Caja muestra la necesidad de confirmarlo explícitamente con conexión. No convierte automáticamente ese intento en dinero confirmado.

Las restauraciones anteriores a la apertura conservan la confirmada por el servidor. Las que contienen otra apertura o un importe distinto se rechazan antes de modificar los stores locales. La publicación de una restauración no escribe ni elimina aperturas; sus demás mecanismos de restauración se mantienen.

Shell local: `prestcontrol-shell-v71`, únicamente bump y precache del módulo nuevo. La publicación estable permanece en v70: no se ejecutó ningún despliegue.

### Pruebas aisladas aprobadas

25 casos contra **Firestore Emulator v1.20.4**, proyecto fijo `demo-prestcontrol-apertura`, host `127.0.0.1:8089`, SDK compat **10.12.0** (igual que la aplicación), reglas locales y `fake-indexeddb` en memoria:

- Dos dispositivos: importes distintos e iguales; una apertura remota y ambas réplicas convergentes.
- Dos pestañas compartiendo IndexedDB.
- Reintento con importe diferente sin sobrescritura.
- Sin conexión y red deshabilitada aunque `navigator` indique conexión.
- Respuesta perdida después de un commit real del emulador.
- Fallo de transacción local posterior al commit remoto y recuperación.
- Réplica/cola obsoletas, intento conservado para auditoría y movimientos ajenos intactos.
- Respaldo anterior, rechazo de respaldo incompatible y protección frente a tombstones de restauración.
- Apertura legacy sin reescribir su movimiento; cuenta con reset anterior completado y apertura vigente.
- Bloqueo ante duplicados anteriores o apertura eliminada sin sucesora vigente.
- Reglas contra clientes antiguos: altas sin autoridad, sobrescritura, cambio de tipo y eliminación de apertura; autoridad inmutable.
- Aislamiento por UID, permisos restantes de clientes y movimientos normales.
- Interfaz sin mensaje de éxito ni cierre del formulario antes de confirmar.
- Cola vieja sin autoridad: no publica ni crea una apertura automáticamente.
- Cambio de sesión durante la confirmación: no escribe en otra cuenta.
- Restauración completa ejecutada con las funciones actuales y una transacción real de IndexedDB en memoria: un respaldo anterior conserva la apertura y no cambia el movimiento ni la autoridad remotos.

Las transacciones y reglas se ejecutaron en el emulador real, no en un mock de Firestore. La pérdida de respuesta y el fallo local se inyectaron alrededor de un commit real del emulador. DOM e IndexedDB fueron aislados. No se consultó ni utilizó Firebase de producción.

### Reproducción

Dependencias de prueba fuera del repositorio, sin cambiar dependencias productivas:

```powershell
$taskRuntime = Join-Path $env:TEMP 'prestcontrol-caja-test-runtime'
npm.cmd install --prefix $taskRuntime --ignore-scripts --no-audit --no-fund firebase@10.12.0 @firebase/rules-unit-testing@3.0.3 fake-indexeddb@6.2.4
firebase emulators:start --only firestore --project demo-prestcontrol-apertura --config firebase.apertura-test.json
```

En otra terminal, desde este repositorio:

```powershell
node tests/apertura-caja.test.cjs
```

El runner fuerza proyecto demo, host local y UIDs sintéticos distintos por ejecución. No importa la configuración de producción. El emulador no se inicia con exportaciones de datos existentes. `tests/auditoria-carga-inicial.cjs` conserva además cuatro verificaciones de comportamiento financiero y la reproducción de la carrera ORIGINAL de v70; no debe confundirse esa reproducción histórica con el resultado de la corrección.

### Pendientes antes de una futura publicación

- Revisión del diff y aprobación de publicación. No se hicieron commit ni push.
- Despliegue coordinado de las reglas revisadas y del frontend actualizado. Las reglas locales todavía no protegen producción; publicar solo el frontend no bloquea escrituras de versiones viejas.
- Actualizar las PWA antiguas antes de abrir Caja. Aunque el servidor rechace una escritura vieja, esa interfaz puede anunciar un éxito local y conservar una réplica equivocada hasta actualizarse.
- Confirmar en dispositivos físicos la apertura/recuperación y el mensaje sin conexión. La concurrencia y las reglas ya se probaron con SDK real en emulador.
- Las cuentas con inconsistencias previas requieren revisión: no se corrigieron, borraron ni migraron automáticamente datos existentes. Un reset antiguo interrumpido también bloquea la apertura para revisión; nunca se completa ni reinicia automáticamente.

Estado: **VALIDADO EN CÓDIGO Y EMULADOR / PENDIENTE REVISIÓN Y PUBLICACIÓN**. No se implementó el módulo de carga histórica.
