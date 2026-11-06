# Carga inicial histórica — auditoría previa

Fecha: 05/11/2026. Base: v70, commit `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`.

Estado: **IMPLEMENTACIÓN DETENIDA POR RIESGO DE INTEGRIDAD FINANCIERA**.

Nota de continuación: este estado corresponde a la auditoría original de v70. Tras proteger la apertura v71 y recibir nueva autorización, se implementó la carga histórica local y se validó en Emulator. El resultado actual, las pruebas y los límites de publicación están en [CARGA_HISTORICA.md](CARGA_HISTORICA.md); no se publicó ni modificó producción.

Continuación autorizada: se implementó por separado la protección de apertura, documentada en [CAJA_APERTURA_UNICA.md](CAJA_APERTURA_UNICA.md). Este documento conserva el diagnóstico original de v70. La carga histórica sigue sin implementarse. La reproducción de concurrencia de `auditoria-carga-inicial.cjs` usa las funciones originales del commit `3ed27bc`; la regresión del código corregido está en `apertura-caja.test.cjs`.

No se modificó el código de la aplicación. No se consultaron ni modificaron datos reales, Firebase de producción o IndexedDB del usuario. No se ejecutaron commit, push ni deploy.

## Funcionamiento actual

- `ui/caja.js`, `confirmarSaldoInicial`: consulta movimientos locales, valida que no exista una apertura y guarda un movimiento `SALDO_INICIAL` mediante `guardarLocalYEncolar`. La confirmación visual ocurre después de la escritura local; no espera una transacción remota de apertura.
- `services/CajaService.js`: identifica Caja iniciada mediante un saldo inicial activo y genera su ID de forma determinista. La validación de unicidad usa los movimientos proporcionados por el llamador.
- `ui/prestamos.js`, `savePrestamo`: exige Caja iniciada y confirma préstamo, cuotas, garantía opcional y desembolso junto con sus operaciones de sincronización en una transacción local.
- `index.html`, `registrarCobroCuotaCaja`: exige Caja iniciada y registra el ingreso junto con la cuota pagada. Una fecha antigua no cambia esa clasificación.
- `index.html`, `registrarAbonoCuotaCaja`: los parciales requieren conexión; la transacción remota confirma pago, cuota y movimiento de Caja antes de completar la escritura local.
- `ui/prestamos.js`: las renovaciones distinguen nominal, deuda compensada y efectivo entregado. Una refinanciación sin efectivo adicional puede seguir un camino sin movimiento de Caja; las renovaciones con parciales verifican saldos remotos. La renovación de capital con cobro de interés tiene su transacción específica.
- Historial, métricas y riesgo se calculan a partir de préstamos, cuotas y pagos; Caja es un registro separado. Ya existen los componentes necesarios para conservar información histórica sin reconstruir saldos, pero no existe el procedimiento de carga inicial solicitado.
- `getConfig`/`setConfig` son locales. El pull general sincroniza clientes, préstamos, cuotas, prendas, movimientos de Caja y pagos; no sincroniza arbitrariamente `config`.
- El respaldo manual incluye esos registros, bitácora y teléfono de WhatsApp. No incluye un estado de carga histórica o una autoridad de corte. La restauración completa tiene un protocolo propio que debe conservarse.

## Riesgo bloqueante reproducido

Se ejecutaron las funciones reales `confirmarSaldoInicial` y `_pushToFirebaseSinLock` en dos contextos aislados, con almacenamiento local y un servidor simulados en memoria. No se cargó el SDK de Firebase ni se realizó ninguna conexión de red.

Secuencia simulada válida:

1. Ambos dispositivos tienen copias locales sin apertura de Caja.
2. A confirma $20.000.000 y B confirma $30.000.000. Ambos generan el mismo ID de saldo inicial y confirman la apertura localmente.
3. Durante el push, ambos leen que ese documento todavía no existe en el servidor simulado.
4. Ambos envían su batch. Para `SALDO_INICIAL`, el camino actual no utiliza una transacción de creación exclusiva; la lectura y la escritura no forman una operación indivisible.
5. Ambos pushes devuelven éxito y ambas colas quedan vacías. El servidor simulado conserva $30.000.000 mientras A todavía conserva $20.000.000.

No se observaron dos aperturas remotas con IDs distintos: el problema es la sobrescritura concurrente del mismo documento y la confirmación de dos importes incompatibles.

La simulación demuestra un intercalado permitido por el código actual; no representa una prueba contra Firebase real ni evidencia de que esto haya ocurrido en producción. Un pull posterior puede reconciliar la copia local, pero no convierte las dos confirmaciones de apertura en una decisión financiera inequívoca.

Este riesgo afecta directamente el requisito de que Caja comience exactamente con el saldo confirmado. Agregar un indicador histórico local o filtrar movimientos por fecha no lo resuelve. Conforme a la instrucción de detenerse ante un riesgo que impida garantizar la integridad financiera, no se implementó ni habilitó el modo histórico.

## Diseño mínimo necesario antes de implementar

1. Autoridad de carga inicial por cuenta y UID, con estados explícitos: carga histórica, carga finalizada con corte irreversible y operación normal después de abrir Caja. Activación exclusivamente explícita, verificando tanto datos locales como remotos. Si existen apertura, movimientos o registros financieros de origen desconocido, informar y bloquear la conversión; nunca borrarlos ni reclasificarlos automáticamente.
2. Corte, escrituras históricas y apertura coordinados mediante transacciones remotas que lean la misma autoridad. La apertura debe crear de forma exclusiva su documento determinista y confirmar el saldo remoto antes de anunciar éxito. Resolver también el caso de dispositivos atrasados antes de habilitar la carga.
3. Procedencia explícita por evento, con identificador idempotente, fecha económica original, fecha de registro, UID y sesión de carga. Un préstamo histórico puede recibir un cobro normal después del corte: la procedencia del préstamo no determina la de sus cobros futuros. Una fecha antigua ingresada después del corte tampoco activa el modo histórico.
4. Reutilizar planes, cálculo de saldos y composición de renovaciones. Los eventos históricos confirman sus registros y auditoría sin crear ingresos, egresos ni ajustes compensatorios en Caja. Mantener las transacciones de validación de parciales y renovaciones; no eludirlas con un indicador global.
5. Verificación previa al cierre: referencias, planes, pagos y saldos, capital/intereses pendientes, vínculos de renovación, operaciones incompletas y sincronización. El corte debe impedir nuevos eventos históricos en todos los dispositivos.
6. Backup, restauración y sincronización deben transportar y validar la procedencia. Restaurar un respaldo anterior no puede reabrir una carga cerrada ni sustituir silenciosamente la autoridad de otra cuenta. Esto debe diseñarse antes de persistir nuevos registros históricos.
7. Tras finalizar la carga, abrir Caja con el dinero real disponible. La cartera histórica no se convierte en dinero disponible ni se compensa mediante movimientos ficticios. Los flujos normales conservan sus mecanismos económicos.

Este diseño todavía no fue implementado. No se modificaron reglas de Firebase ni mecanismos de sincronización.

## Pruebas ejecutadas

Comando reproducible, sin dependencias adicionales:

```powershell
node tests/auditoria-carga-inicial.cjs
```

El script lee las funciones actuales y las ejecuta en contextos VM separados. Solo utiliza datos sintéticos, referencias de servidor simuladas y almacenamiento en memoria. No ejecuta el inicio de la aplicación ni abre bases de datos reales.

- Cobro completo sin apertura: rechazado, sin escrituras.
- Pago parcial sin apertura: rechazado, sin escrituras.
- Cobro con fecha antigua después de apertura: ingreso normal de $600; saldo de $20.000.000 a $20.000.600. Reintento rechazado sin nuevas escrituras.
- Cuota de $600 con abono de $200, en préstamo de capital $1.000 y total $1.200: capital pendiente $833,33 e intereses pendientes $166,67; capital recuperado $166,67 e intereses cobrados $33,33. Caja permanece independiente.
- Aperturas concurrentes de $20.000.000 y $30.000.000: riesgo reproducido; ambos pushes exitosos, colas vacías y copias con distintos importes.

La salida `REPRODUCIDO` de la última comprobación certifica la reproducción del problema, **no una corrección**. Las otras comprobaciones describen comportamiento actual; no certifican que exista un modo histórico.

## Validaciones pendientes

No se ejecutaron como pruebas de una funcionalidad nueva, porque la implementación se detuvo: préstamo/pago histórico sin Caja, parcial histórico, renovación histórica, cierre irreversible, apertura posterior al cierre, primer préstamo nuevo, persistencia de la sesión histórica y recorrido completo de backup/restauración/sync con esa procedencia.

Antes de retomar, la prueba de concurrencia debe convertirse en una regresión que exija una sola apertura remota válida y rechace o reconcilie el segundo intento sin anunciar un saldo incompatible. Deben agregarse casos de corte simultáneo con un pago histórico, reintentos, fallos parciales de escritura, dispositivos desactualizados, otras cuentas y restauración de un respaldo anterior al corte. Las pruebas remotas deberán usar un emulador o entorno de prueba aislado, nunca Firebase de producción.
