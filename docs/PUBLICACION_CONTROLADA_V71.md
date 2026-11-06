# Publicación controlada v70 → v71

Preparación del 06/11/2026. **No autoriza ni ejecuta publicación.** No se cambió código funcional, no se repitieron auditorías aprobadas y no se consultaron documentos de cuentas reales. Solo se leyó la configuración de reglas productivas y la referencia Git remota.

## A. Comprobaciones realizadas

- `git diff --check` correcto. HEAD, referencia local `origin/main` y rama remota consultada: `3ed27bc7cd7a0f2f58bab439ee502c220d74c0bc`. Working tree con el trabajo v71 pendiente; sin commit ni push.
- Los 14 archivos productivos coinciden byte a byte con los hashes de la ejecución final aprobada. No hay cambios fuera de esos archivos, pruebas/configuración aislada y documentación/evidencias v71. [Verificación local](evidencia-v71/prepublicacion-local.json).
- La ejecución final terminó a las 00:29:38 de Argentina del 06/11/2026: 112 comprobaciones de comportamiento/regresión y 8 reproducciones de riesgos; cero suites fallidas. Apertura única 25/25. No se repitieron suites cuyo código probado permanece idéntico. [Pruebas](evidencia-v71/pruebas-correcciones.json).
- Reglas ACTIVAS leídas nuevamente a las 00:36:38 de Argentina del 06/11/2026, proyecto `prestcontrol-5e965`, release `cloud.firestore`: siguen coincidiendo con v70. No incluyen las protecciones locales v71. [Consulta](evidencia-v71/prepublicacion-reglas.json), [fuente activa](evidencia-v71/prepublicacion-produccion.rules.txt), [diff](evidencia-v71/prepublicacion-reglas.diff.json).
- Fuente productiva SHA-256: `ff33035e7cc439bf3a9504f9702433c2e4a6df938f65272afe4a01349bc6809e`. Fuente local aprobada: `0be09e6f72b0b1a12e215b611a2be6ad5af812ebaa00394edc515836b7acb904`.
- El diff de reglas incorpora autoridad de apertura única, fases/corte de carga histórica, eventos/correcciones auditados, protección de clientes vinculados y condiciones históricas. Mantiene acceso por UID y los flujos normales probados. No crea migraciones ni modifica datos por desplegar el archivo.
- IndexedDB sigue en versión 7, sin limpieza de clientes. Shell local: `prestcontrol-shell-v71`. No se cambió Firebase/Auth ni la aplicación durante esta preparación.

## B. Comprobaciones del operador y respaldos

### 1. Registrar cuentas y dispositivos antes de cambiar reglas

Anotar una fila por combinación de cuenta, dispositivo, perfil y ventana/PWA que haya usado PrestControl. Incluir PC, Samsung, Motorola y equipos offline, si existen. Identificar la cuenta destinada a carga histórica por su **UID**, no solo por su nombre visible.

| Cuenta/UID | Equipo y perfil | Chrome/PWA | Clientes activos locales | Clientes activos remotos | Pendientes/errores | Respaldo previo/posterior | v71 comprobada |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Completar | Completar | Completar | Completar | Completar | Completar | Completar | Pendiente |

Pausar altas/ediciones financieras y de clientes mientras se obtienen las referencias finales. No abrir Caja, restaurar, importar, reparar sincronización ni ejecutar reset/mantenimiento en la ventana de actualización. No dar por conciliado un equipo inaccesible/offline; su posible retorno debe resolverse antes de avanzar.

### 2. Respaldar antes de sincronizar o actualizar

En **cada cuenta y dispositivo**, con la sesión correcta:

Si un equipo está offline, obtener primero sus copias locales **antes de reconectarlo**. No asumir que el servidor ya contiene sus últimos cambios.

1. Ir a **Configuración → Respaldo manual → Crear copia de seguridad**. Guardar el JSON descargado. No tocar Importar ni Restaurar.
2. Crear una carpeta privada **fuera del repositorio**, por ejemplo `PrestControl_pre_v71/UID/equipo/antes`. Conservar también una segunda copia independiente y protegida. El JSON manual no conserva la cola ni todos los internos locales.
3. Guardar una copia íntegra de la base local de esa cuenta, incluida `sync_queue`, `config`, stores existentes y registros eliminados. Para ello usar el fragmento ya preparado [auditar-indexeddb-solo-lectura.js](evidencia-v71/auditar-indexeddb-solo-lectura.js), sin modificar su contenido.
4. En PC: F12 → Console. Escribir `const respaldoLocalV71 = await` y pegar a continuación el fragmento completo; ejecutar. Luego ejecutar `copy(JSON.stringify(respaldoLocalV71, null, 2))` y pegar el contenido del portapapeles en un archivo `.json` UTF-8 dentro de la carpeta privada. El fragmento solo lee IndexedDB; no sincroniza, borra ni restaura. No recargar la página antes de guardar el archivo.
5. En Android: inspeccionar la **pestaña/PWA real** desde Chrome de la PC, mediante USB y `chrome://inspect/#devices`; repetir allí el paso anterior. No exportar otra cuenta o perfil como sustituto. [Instrucciones oficiales](https://developer.chrome.com/docs/devtools/remote-debugging?hl=es-419).
6. Abrir los archivos descargados, confirmar UID/equipo/fecha, número de clientes y presencia de la cola/configuración. Si la copia completa falla, el respaldo de pendientes queda **NO VERIFICADO**; no continuar con una supuesta cola vacía.

La copia íntegra puede contener datos internos sensibles. No subirla a Git, Netlify, chats ni carpetas públicas. El fragmento requiere la cuenta desbloqueada, pero no pide contraseña, claves ni acceso de terceros.

### 3. Confirmar que los clientes v70 están realmente sincronizados

Después del respaldo previo, revisar la cola completa y las alertas. No basta «En línea», «Sin errores» o ver el mismo total en dos pantallas.

- Cada cliente local vigente debe existir en el servidor con el mismo ID, nombre, teléfono y demás datos cargados; los clientes del servidor deben aparecer en las réplicas correspondientes. Revisar también borrados/tombstones y conflictos por ID. El mismo total con IDs diferentes no es coincidencia.
- Si existen pendientes **exclusivamente de clientes**, legítimos y sin conflictos, el operador puede usar **Configuración → Firebase — Sync en Tiempo Real → Guardar ahora** para publicar esos clientes con v70. Esta es una operación real del operador, no se ejecutó en la preparación. Esperar confirmación y verificar después el servidor.
- Si hay aperturas, préstamos, cobros, renovaciones, borrados dudosos o restauraciones pendientes, no pulsar Guardar ahora para vaciar todo: conservar la copia y conciliar por operación. No ejecutar Reparar sincronización ni marcar entradas como completadas manualmente.
- Volver a leer la cola con el fragmento: exigir cero pendientes/errores y revisar cualquier estado desconocido. Una lectura fallida nunca prueba cero. Exigir ausencia de `restorePending` y de reset incompleto.
- Comparar con Firebase Console → proyecto `prestcontrol-5e965` → Firestore → `users/{UID}/clientes`, o con el snapshot remoto readonly del anexo. Confirmar los IDs y contenidos, no modificar documentos desde la consola. No usar caché local como prueba del servidor.
- Para la cuenta que recibirá historia, confirmar además que no tiene Caja iniciada ni registros financieros previos, incluidos eliminados. Si aparecen, detener esa cuenta: no borrar ni convertir nada. Las otras cuentas mantienen su operación, sin activarles la carga histórica.
- Guardar una segunda copia manual + IndexedDB **después** de conciliar, en `UID/equipo/conciliado`, y una referencia remota por UID. Conservar también las copias «antes». Validar archivos/conteos y guardar hashes si se dispone de soporte técnico. Cualquier ensayo de restauración se realiza únicamente en Emulator.

### 4. Confirmaciones del panel Netlify

Comprobar en el sitio que sirve la URL habitual: repositorio correcto, rama de producción `main`, publicación automática habilitada, directorio publicado correcto y último deploy conocido. Anotar URL, sitio, ID del deploy anterior y commit asociado. Confirmar que no hay un deploy pendiente que pueda adelantarse. **Esta configuración no se verificó desde el entorno local.**

### 5. Lista PC y celulares

**Antes del cambio:** UID correcto; clientes cotejados con servidor; respaldo previo y conciliado guardados; cola sin pendientes/errores; sin formularios abiertos; todas las PWA/pestañas inventariadas y cerradas al iniciar la ventana. En cuentas con Caja existente anotar apertura original, saldo y movimientos como referencia, sin crear otra apertura.

**Después de publicar, antes de cargar préstamos reales:**

- Abrir online la URL habitual en PC y en cada Chrome/PWA del celular. Si hay una operación abierta, terminarla o cancelarla antes de recargar. Cerrar pestañas anteriores, volver a abrir y dejar completar actualización/recarga.
- Comprobar en DevTools el worker activo y `prestcontrol-shell-v71`, y que la página/módulos cargados corresponden al deploy aprobado. La caché v71 sola no prueba la versión de una ventana ya abierta.
- El botón circular del header llama a `refreshApp()` y actualiza datos/pantalla: **no sustituye una recarga de la página ni certifica la versión**. No desinstalar la PWA ni borrar almacenamiento para actualizar.
- Confirmar mismo UID y mismos clientes: IDs, nombres, teléfonos y cantidades. Repetir verificación de cola/errores; una cifra inexplicable detiene la cuenta.
- Samsung/Motorola vertical: indicador de conexión, usuario, campana, micrófono, sincronización y volver visibles/pulsables; formularios y nueva pantalla legibles. Revisar Chrome y PWA que se usen realmente.
- Cuenta de solo clientes: acceso a Carga histórica disponible, sin activar ni cerrar como prueba. Cuenta con finanzas: saldo/apertura/movimientos originales conservados y carga histórica sin habilitación automática. Al consultar Caja, v71 puede crear la autoridad que referencia la apertura anterior: es control previsto, no un nuevo saldo inicial.
- No fabricar préstamos/cobros en producción para probar. Las pruebas financieras siguen aprobadas en Emulator. Si falta ensayo físico de la pantalla con datos sintéticos, hacerlo en entorno aislado conectado a Emulator; una copia local con configuración productiva no es un entorno de prueba seguro.

## C. Riesgos que siguen pendientes

- Reglas y Netlify no se publican atómicamente entre sí. App nueva con reglas viejas deja las protecciones incompletas; reglas nuevas con una PWA vieja pueden rechazar lotes y mantener colas pendientes.
- Las reglas no expulsan todas las versiones v70. Algunas operaciones anteriores siguen siendo compatibles; otras se rechazan. No hay bloqueo universal por número de versión. Un equipo viejo que vuelva offline/online puede intentar publicar pendientes.
- Restauraciones/reset antiguos pueden aplicar parte de sus lotes antes de un rechazo; las reglas no hacen inmutable cada movimiento financiero normal. Por eso deben cerrarse todos los clientes antiguos y prohibirse mantenimiento/restauraciones durante la transición. No continuar si no se controla algún dispositivo.
- No se verificaron los datos/colas reales, el panel Netlify ni físicamente PC/Samsung en esta preparación. Esas casillas deben completarse; no se infieren de las pruebas ni del hash del código.
- Cierre histórico irreversible: después no hay corrector financiero administrativo general. Revisar y corregir la cartera antes de finalizarla; los errores posteriores se detienen y revisan específicamente, sin reabrir ni compensar con dinero ficticio.

## D. Orden exacto de publicación y recuperación

**Los comandos siguientes son para una autorización posterior. No se ejecutaron.**

1. Completar inventario, respaldo previo, conciliación y respaldo posterior. Cerrar todas las ventanas antiguas y pausar operaciones. Confirmar panel Netlify y conservar reglas/deploy anteriores como evidencia. Si algún requisito crítico falla, no cambiar reglas ni publicar.
2. Autorizar explícitamente la publicación conjunta. Volver a comprobar Git, hashes aprobados y reglas activas; si cambió el código, la rama remota o las reglas respecto de esta preparación, detener y revisar esa diferencia concreta.
3. Desde la raíz del repositorio, desplegar **solo reglas primero**, con el proyecto explícito. En PowerShell se puede usar el ejecutable `.cmd`:

   ```powershell
   firebase.cmd deploy --only firestore:rules --project prestcontrol-5e965
   ```

4. Leer nuevamente release/fuente activa y comparar la fuente completa con el archivo aprobado (normalizar saltos de línea si la herramienta los cambia). Confirmar el hash/contenido correcto. Mantener la pausa durante la propagación: Firebase documenta hasta un minuto para consultas nuevas y hasta diez para listeners activos. Esperar no sustituye comprobar la fuente. [Documentación oficial](https://firebase.google.com/docs/firestore/security/get-started).
5. Solo después de confirmar reglas y propagación, preparar el commit con los archivos v71 revisados, incluidos módulos nuevos, pruebas y documentación. Revisar `git diff --cached --stat`, `git diff --cached --check` y `git status --short`; no agregar respaldos de cuentas ni credenciales. Crear el commit autorizado y ejecutar:

   ```powershell
   git push origin main
   ```

   Sin force push ni rebase. Si hay rechazo por avance remoto, detenerse y revisar; no forzar. Netlify debe publicar automáticamente desde ese commit, sin deploy manual.
6. Confirmar en Netlify deploy de producción exitoso con el hash del commit esperado. Comprobar que se sirven `index.html`, `sw.js`, `services/CajaAperturaService.js`, `services/CargaHistoricaService.js` y `ui/carga-historica.js` del mismo artefacto, además de sus dependencias; sin 404 ni módulos mezclados.
7. Actualizar cada PC/Chrome/PWA de forma controlada y marcar la columna «v71 comprobada». Mantener las finanzas pausadas hasta completar los controles posteriores de B.5. No dar acceso de operación a dispositivos que todavía ejecuten v70.
8. Si todas las cuentas/dispositivos coinciden con sus referencias y no hay errores, habilitar operación gradualmente. En la cuenta destinada a historia, pasar a E. Las cuentas con Caja existente no hacen otra apertura ni se convierten a carga histórica.

### Recuperación ante un fallo

| Momento/fallo | Procedimiento que conserva operaciones |
| --- | --- |
| Antes de desplegar reglas | No publicar; conservar respaldos/colas y resolver el requisito faltante. |
| Deploy de reglas fallido o incierto | No publicar frontend. Leer cuál ruleset quedó activo; no deducirlo solo del exit code. |
| Reglas v71 activas, Netlify falla | Mantener reglas protectoras y pausa de operaciones incompatibles. Conservar datos y colas; resolver publicación hacia adelante con un artefacto autorizado. No volver a reglas permisivas para desbloquear v70. |
| Netlify muestra versión nueva pero un equipo sigue en v70 | Detener uso en ese equipo; conservar almacenamiento y pendientes. Cerrar ventanas y actualizar online. No reinstalar ni limpiar datos. |
| Rechazos de sync, clientes faltantes o saldo diferente | Detener la cuenta, guardar una nueva copia completa local y referencia remota, conservar mensajes/IDs. Revisar cada operación contra servidor antes de reintentar. No borrar colas, restaurar, reiniciar ni reenviar con otro ID. |
| Respuesta perdida de una operación histórica/apertura | Consultar autoridad/evento confirmado y reintentar con la misma identidad y datos. No crear una segunda apertura o referencia para resolver una confirmación incierta. |

Un rollback del frontend a v70 no revierte reglas, datos, cortes ni PWA ya actualizadas. Las copias sirven para conciliación y recuperación específica; no se restaura un archivo viejo sobre producción como primera respuesta. Operaciones pendientes se conservan hasta comprobar si están confirmadas o requieren un reintento legítimo.

## E. Condiciones para habilitar préstamos históricos reales

- [ ] Clientes v70 de todos los dispositivos conciliados por UID/ID/contenido con el servidor, con respaldos previo y posterior verificados.
- [ ] Ninguna cola pendiente/error ni restauración/reset incompleto; todos los dispositivos controlados.
- [ ] Reglas v71 activas verificadas y propagadas; deploy Netlify/commit correcto.
- [ ] PC y cada Chrome/PWA usados efectivamente en v71; controles de B.5 aprobados, sin diferencias de datos ni errores.
- [ ] Cuenta elegida contiene solo clientes, sin Caja ni registros financieros previos; se confirmó sin borrar ni convertir cuentas.
- [ ] Aceptada la revisión documental y el cierre irreversible; referencias únicas preparadas para préstamos, recibos y renovaciones.

Con todas las casillas completas, activar **explícitamente** la carga histórica en la cuenta elegida. Empezar por pocos registros **reales** documentados, comprobar fechas, capital, interés, cuotas, parciales y relaciones entre dispositivos; Caja debe permanecer sin movimientos históricos. Si hay error antes del cierre, usar Deshacer último evento, en orden inverso y con motivo; recargar lo correcto con otra referencia.

Continuar el resto de la cartera y verificar toda la información antes de finalizar. **Publicar v71 no obliga a cerrar la carga ni a abrir Caja ese día.** Solo al terminar y revisar toda la cartera, finalizar establece el corte y después se abre Caja una sola vez con el efectivo realmente disponible. A partir de allí los cobros y préstamos nuevos afectan Caja normalmente, incluso si se introduce una fecha anterior.

## Anexo técnico: referencia remota por UID, solo lectura

Opcional para el operador/asistencia técnica, en DevTools de una cuenta autenticada, durante la pausa. No ejecutado en esta preparación. Lee únicamente colecciones operativas conocidas de esa cuenta. No sincroniza, escribe, restaura ni cambia reglas. Si detecta caché o escrituras sin confirmar, falla: no es un respaldo remoto verificado.

```javascript
const referenciaRemotaV71 = await (async () => {
  const uid = window._fbUser?.uid, db = window._fbDb;
  if (!uid || !db) throw new Error('Falta sesión Firebase de la cuenta correcta.');
  const cuenta = db.collection('users').doc(uid);
  const colecciones = ['clientes','prestamos','cuotas','pagos_cuota','prendas',
    'movimientos_caja','bitacora','control_caja','carga_inicial',
    'carga_inicial_eventos','carga_inicial_clientes'];
  const confirmado = snap => {
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites)
      throw new Error('Lectura sin confirmación remota; revisar pendientes antes de seguir.');
  };
  const perfil = await cuenta.get({source:'server'});
  confirmado(perfil);
  const datos = {};
  for (const nombre of colecciones) {
    const snap = await cuenta.collection(nombre).get({source:'server'});
    confirmado(snap);
    snap.docs.forEach(confirmado);
    datos[nombre] = snap.docs.map(d => ({documentId:d.id, data:d.data()}));
  }
  if (window._fbUser?.uid !== uid || window._fbDb !== db)
    throw new Error('Cambió la cuenta; repetir la referencia.');
  return {tipo:'referencia-remota-solo-lectura', uid, fecha:new Date().toISOString(),
    cuenta:perfil.exists ? perfil.data() : null, colecciones:datos};
})();
copy(JSON.stringify(referenciaRemotaV71, null, 2));
```

Guardar el portapapeles como JSON privado fuera del repositorio. Es una referencia para conciliación/recuperación asistida, **no un archivo para importar en PrestControl ni un backup global de Firebase/Auth**. Es consistente solo si la pausa cubre todos los escritores de esa cuenta. Clientes vigentes: `colecciones.clientes` cuyo `data._deleted !== true`; comparar `documentId` y campos con `datosLocales.clientes` de la copia local, además de preservar los eliminados para auditoría.
