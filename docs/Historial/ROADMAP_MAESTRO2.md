# ROADMAP MAESTRO — PRESTCONTROL

**Proyecto:** PrestControl  
**Stack:** Netlify + Firebase + GitHub + IndexedDB  
**Última actualización:** 18/07/2026  
**Estado general:** Etapa 11 completada y validada

---

## REGLA GENERAL DE TRABAJO

- Problema resuelto = **CERRADO**.
- No reabrir tareas cerradas salvo pedido explícito del usuario.
- No modificar `CODEX_LOOP.md` ni `CODEX_RULES.md` automáticamente.
- `ROADMAP_MAESTRO.md` puede actualizarse cuando una tarea queda finalizada.
- Toda propuesta de cambio sobre LOOP/RULES debe quedar como propuesta y ser aprobada por el usuario.

---

# ETAPA 1 — ALERTAS INTERNAS

**Estado:** COMPLETADA

## Cerrado
- Centro de alertas activas.
- Badge de alertas.
- Categorías: vencidas, clientes con varias cuotas atrasadas, vencen hoy, próximos 7 días y errores sync.
- Badge basado en condiciones activas.

---

# ETAPA 2 — ESTABILIDAD FIREBASE / SYNC

**Estado:** COMPLETADA

## Cerrado
- Protección contra `_deleted:true` remoto.
- Normalización de `_deleted:false` y `deletedAt:null`.
- Pull no pisa operaciones pendientes.
- Push usa `sync_queue`.
- Diferencias PC vs celular diagnosticadas y corregidas.
- `autoUpdateEstados()` y `syncEstadoPrestamo()` encolan cambios automáticos.
- Sincronización offline más segura.
- Reparación local desde Firebase.
- Prevención de conflictos por `updatedAt`.

## Commits relevantes
- `61edf61` fix `_deleted`
- `2adeac6` Etapa 1
- `a6c31b6` Etapa 2
- `ba4035a` Fortalece sincronización offline segura

---

# ETAPA 3 — MÉTRICAS FINANCIERAS

**Estado:** COMPLETADA / ESTABLE

## Cerrado
- `services/MetricasFinancierasService.js`.
- Métricas base:
  - capital activo
  - capital recuperado
  - capital pendiente
  - capital ejecutado
  - ganancia real
  - ganancia proyectada
  - interés pendiente
  - ROI bruto
  - mora real
  - capital en riesgo
  - cashflow 7 días
  - cashflow 30 días
- Dashboard recalcula sobre IndexedDB local.
- Métricas no modificadas durante Renovación Fase 1.

## Observación
La renovación guarda metadata suficiente para separar más adelante: capital contractual, efectivo real entregado, compensación, interés real y caja real.

---

# ETAPA 4 — DASHBOARD PROFESIONAL

**Estado:** PARCIAL / ESTABLE

## Cerrado
- Dashboard global operativo.
- Bloques: Operativo, Cartera, Rentabilidad, Riesgo y Flujo.
- Alertas superiores integradas.
- Datos consistentes con préstamos activos y cuotas cobrables.

## Pendiente futuro
- Filtros por año / mes / semana.
- Vista histórica.
- Separación contable fina de caja real.
- Módulo futuro de empeños en dashboard.

---

# ETAPA 5 — MEJORAS VISUALES / UX OPERATIVA

**Estado:** COMPLETADA / ESTABLE

---

## 5.4 — Formularios, sheets y Agenda profesional

**Estado:** CERRADO

## Cerrado
- Clases visuales `form-*` y `choice-*`.
- Sheets profesionalizados:
  - Nuevo / editar cliente
  - Nuevo préstamo
  - Confirmar pago
  - Eliminar cliente
  - Eliminar / cerrar préstamo
  - PIN administrador
  - Editar préstamo
  - Renovar préstamo
- Mejor responsive desktop/móvil.
- Agenda con filtros: Cobrables, Todas, Pagadas.
- Agenda con leyenda dinámica según filtro.
- Agenda diferencia: Pendiente, Atrasada, Pagada y Cerrada.

## Correcciones cerradas
- Agenda ya no muestra cuotas cerradas como cobrables.
- Leyenda no muestra estados que no corresponden al filtro.
- Sheet cerrado ya no deja franja visible abajo.
- Préstamos mensuales corregidos: contador y lista usan la misma regla.

---

## 5.5 — UX de Préstamos / Cliente / Renovación Fase 1

**Estado:** CERRADO

## Navegación
- Botón volver paso a paso con rutas y contexto.
- `pageStack` guarda rutas con ID.
- Flujo correcto:
  - Clientes → Detalle Cliente → Detalle Préstamo
  - Volver → Detalle Cliente
  - Volver → Clientes

## Tarjetas replegables
- Préstamos dentro de Detalle Cliente se expanden/retraen.
- Pantalla Préstamos también contrae al volver a entrar.
- Botones internos usan `event.stopPropagation()`.
- Se restauraron acciones en cuotas: Marcar pagada y WA.
- Al pagar desde Detalle Cliente:
  - la cuota se actualiza en el acto
  - desaparecen Pagar/WA
  - progreso se recalcula
  - estado se recalcula
  - Renovar se recalcula
  - no se crea historial falso

## Cobros
- Las cuotas atrasadas se muestran primero.
- Luego se muestra “Cobrar hoy”.
- No se modificaron métricas ni sync.

## Renovación de préstamo — Fase 1

**Estado:** CERRADO

### Regla funcional
La renovación con descuento funciona así:

Ejemplo:
- Préstamo viejo: $400.000 en 4 cuotas.
- El cliente pagó 3 cuotas.
- Queda 1 cuota pendiente.
- Se renueva por $400.000.

Resultado:
- La cuota pendiente vieja se marca como **Pagado / Renovación**.
- Esa cuota se usa como compensación.
- El cliente no la paga en efectivo.
- Se descuenta de la nueva entrega.
- El nuevo préstamo nace por el monto nominal completo.

Ejemplo con cuota vieja de $132.000:

```text
Monto nominal nuevo: $400.000
Monto compensado:    $132.000
Entrega real:        $268.000
Total nuevo:         $528.000
Cuota nueva:         $132.000
Ganancia:            $128.000
```

### Importante
La compensación **NO modifica** el cálculo financiero del préstamo nuevo.

El nuevo préstamo calcula total, cuota y ganancia sobre `montoNominal`, usando `PrestamoService.calcularPlanPagos()`.

### Metadata del préstamo nuevo
- `origen: 'renovacion'`
- `prestamoOrigenId`
- `renovacionTipo: 'descuento_cuota'`
- `montoNominal`
- `montoEntregado`
- `montoCompensado`
- `cuotasCompensadas`

### Metadata de la cuota vieja
- `estado: 'Pagado'`
- `metodo: 'Renovación'`
- `origenPago: 'renovacion_descuento'`
- `montoEfectivo: 0`
- `montoCompensado`
- `prestamoRenovacionId`

### Vistas donde aparece Renovar
- Detalle Cliente.
- Detalle Préstamo.
- Tarjeta expandida de Préstamos.

---


## 5.6 — Comprobantes profesionales imprimibles

**Estado:** CERRADO

## Cerrado
- Vista previa de pago blanca y responsive.
- Comprobantes sin cabeceras oscuras.
- Importes más grandes, oscuros y legibles.
- PDF de pago optimizado para bajo consumo de tinta.
- PDF de préstamo con columnas corregidas y alto contraste.
- Prenda y observaciones incluidas cuando existen.
- Encabezado de tabla repetido en paginado.
- Estilos `@media print`.
- Header del comprobante de pago corregido para evitar superposición entre título y marca en A6/mobile.
- En renovación con cuota compensada, se muestra el comprobante de la cuota saldada por renovación.
- No se modificaron datos, fórmulas, estados, métricas ni sync.

## 5.7 — Pulido visual de tarjetas, badges y botones

**Estado:** CERRADO

## Cerrado
- Cards más limpias con bordes y sombras suaves.
- Mejor jerarquía visual para títulos, subtítulos e importes.
- Cuotas pagadas más legibles.
- Badges unificados como píldoras.
- Botones principales, secundarios, danger, success y ghost normalizados.
- Mejor foco de teclado y hover en desktop.
- Ajustes mobile de padding, grillas y acciones.
- Comprobantes excluidos para no romper el diseño ya aprobado.
- Sin cambios en JavaScript, datos, estados, importes ni cálculos.

## 5.8 — Vista Cuotas retraída y refresco

**Estado:** CERRADO

## Cerrado
- Vista Cuotas inicia con todos los grupos retraídos.
- Toggle manual sigue funcionando.
- Al volver a entrar se reconstruye desde IndexedDB.
- Pagar desde Cuotas refresca inmediatamente la vista.
- Se agregó `cuotas` al refresco posterior a `confirmarPago()`.
- Sin cambios en Préstamos, Clientes, cálculos, estados ni métricas.

# ETAPA 6 — NOTIFICACIONES PWA

**Estado:** EN PROGRESO

## 6.1 — Base PWA real

**Estado:** CERRADO

## Cerrado
- Manifest estático `manifest.webmanifest`.
- Service worker estático `sw.js`, registrable desde el mismo origen.
- Registro dinámico mediante `blob:` desactivado.
- Errores de registro visibles en consola.
- Caché offline mínimo para el shell local de la aplicación.
- Iconos PNG reales de 192x192 y 512x512.
- Sin Push API, Firebase Messaging ni backend de notificaciones.

## Pendiente de Etapa 6
- Definir e implementar notificaciones push reales con la aplicación cerrada.

## 6.2 — Notificación local coherente

**Estado:** CERRADO

## Cerrado
- Notificaciones locales basadas en la regla canónica `esCuotaCobrable()`.
- Resumen de cuotas vencidas, que vencen hoy y durante los próximos 7 días.
- Un único intervalo activo, cancelado al cerrar sesión.
- Prueba manual independiente de cuotas reales y de `lastNotifDate`.
- Visualización mediante el service worker cuando está disponible.
- Apertura o enfoque de PrestControl al tocar una notificación.
- Sin Push API, Firebase Messaging, VAPID ni backend.

---

# ETAPA 7 — COMANDOS POR VOZ

**Estado:** EN PROGRESO

## 7.1 — Comandos mínimos y seguros

**Estado:** CERRADO

## Cerrado
- Botón de micrófono visible únicamente con soporte de Web Speech API.
- Reconocimiento manual de una frase en español de Argentina (`es-AR`).
- Navegación por voz a Cobros, Préstamos, Clientes y Alertas.
- Búsqueda de clientes reutilizando el filtro existente.
- Apertura automática de cliente sólo ante una coincidencia única.
- Coincidencias ambiguas mostradas para selección manual.
- “Crear cliente” abre únicamente el formulario vacío.
- Errores de soporte, permiso, micrófono, red y frase no reconocida informados en UI.
- Reconocimiento detenido al cerrar sesión, bloquearse por inactividad u ocultarse la app.
- Sin pagos, cuotas, renovaciones, cancelaciones ni guardado automático por voz.

## 7.2 — Voz como super atajo natural

**Estado:** CERRADO

## Cerrado
- Nombres directos y frases naturales para buscar clientes.
- Apertura automática sólo con una coincidencia clara.
- Resultados ambiguos conservados para selección manual.
- Navegación sin exigir el prefijo “ir a”.
- Atajos para préstamos activos, cobros de hoy, cuotas atrasadas y vencimientos de hoy.
- Tolerancia a acentos, mayúsculas, singular, plural y palabras de relleno.
- Órdenes de pago, renovación, cancelación o escritura bloqueadas con confirmación manual.
- Frases desconocidas respondidas con ayuda simple.

## 7.3 — Sinónimos y búsqueda natural

**Estado:** CERRADO

## Cerrado
- Sinónimos para atrasos, agenda, historial, configuración, clientes, préstamos, cobros y alertas.
- Gráficos, estadísticas y números abren la pestaña real de Gráficos del dashboard.
- Resumen, dashboard e inicio restauran la vista global del dashboard.
- Nuevas expresiones de cliente: busca, buscame, encontrame, encuentra a, buscar a y abrime.
- Acentos, singular, plural y palabras de relleno normalizados.
- Rutas inexistentes sustituidas únicamente por vistas reales equivalentes.
- Acciones de escritura continúan bloqueadas.

## 7.4 — Comprensión de frases naturales

**Estado:** CERRADO

## Cerrado
- Navegación detectada antes de interpretar una frase como nombre de cliente.
- Artículos, conectores y expresiones de cortesía eliminados sólo para navegación.
- Prefijos de búsqueda limpian correctamente “a”, “al” y “a la”.
- Frases como “quiero ver los préstamos” y “quiero ver a la agenda” resuelven su vista real.
- “Buscame a”, “encontrame a”, “busca a” y “quiero buscar a” conservan únicamente el nombre.
- La limpieza de navegación y la extracción de nombres permanecen separadas para no dañar nombres reales.
- Acciones financieras o irreversibles continúan bloqueadas.

## 7.5 — Detección de intención flexible

**Estado:** CERRADO

## Cerrado
- “Vamos”, “abrí” y “mostrámelo” reconocidos como palabras de intención.
- Destinos detectados aunque falten conectores entre intención y vista.
- Variantes como “vamos agenda”, “vamos préstamos” y “vamos atrasados” navegan correctamente.
- La limpieza flexible se aplica sólo antes de evaluar destinos conocidos.
- Búsqueda de clientes y bloqueo de acciones riesgosas permanecen intactos.

## 7.6 — Clientes y bitácora

**Estado:** CERRADO

## Cerrado
- Variantes con artículos e intención para Clientes verificadas sin reglas redundantes.
- “Bitácora” y “bitacora” incorporadas como sinónimos de Historial.
- “Ver bitácora” y “abrime bitácora” navegan a Historial.
- Movimientos, registros e historial mantienen la misma ruta real.
- Búsqueda de clientes y bloqueo financiero permanecen intactos.

---

# ETAPA 8 — WHATSAPP / COBRANZA

**Estado:** PARCIAL / ESTABLE

## 8.1 — WhatsApp seguro para cobranza

**Estado:** CERRADO

- Base activa de WhatsApp centralizada para cobranza.
- Validación de cuotas cobrables y bloqueo de estados cerrados.
- Uso manual / semimanual mediante `wa.me`.

## 8.2 — Plantillas WhatsApp humanas y profesionales

**Estado:** CERRADO

- Mensajes diferenciados para cuotas vencidas, que vencen hoy y próximas.
- Textos breves, claros, profesionales y cercanos.

## 8.3 / 8.x — WhatsApp del comprobante

**Estado:** FUNCIONAL

- Funcional con números locales argentinos cargados como `3834...`.
- Recomendación operativa actual: guardar teléfonos argentinos sin `+54` ni `+549`.
- Ejemplo recomendado: `3834381638`.

## Pendiente futuro

- Soporte robusto para números con prefijo internacional.
- Soporte para clientes de otros países.

## Decisión actual

- No continuar todavía con la API oficial de WhatsApp.
- Mantener el flujo manual / semimanual mediante `wa.me`.

---

# ETAPA 9 — SEGURIDAD AVANZADA

**Estado:** EN PROGRESO

## 9.1 — Seguridad mínima de sesión y acceso local

**Estado:** CERRADO

**Fecha:** 2026-06-23

## Cerrado
- Reglas Firestore versionadas para limitar `users/{uid}` y sus subcolecciones al usuario autenticado propietario.
- Configuración local de Firebase preparada sin desplegar reglas automáticamente.
- Logout asíncrono: espera `signOut()`, detiene listeners y limpia memoria/UI de sesión.
- Pérdida de usuario Firebase bloquea el acceso local y devuelve a login.
- Contraseñas locales legacy eliminadas al iniciar y nuevos guardados sanitizados.
- Fallbacks que comparaban contraseñas locales desactivados.
- IndexedDB y operaciones offline conservadas en el logout normal.
- Eliminación de cliente protegida con confirmación escrita `ELIMINAR`.
- Renovación protegida con confirmación escrita `RENOVAR`, sin cambios financieros.

## Pendiente
- Revisar y desplegar manualmente las reglas Firestore versionadas, con aprobación explícita.
- Evaluar una opción separada para cerrar sesión y borrar datos locales sin perder operaciones pendientes.

**Commit asociado:** `57de9f0`

## 9.2 — Biometría vinculada correctamente al usuario

**Estado:** DESACTIVADA / PENDIENTE FUTURO

**Fecha:** 2026-06-24

## Estado actual
- La funcionalidad biométrica queda eliminada/desactivada temporalmente del login y de Configuración.
- No se muestra el botón `Ingresar con huella`.
- No se muestra la opción `Activar huella digital`.
- Las funciones biométricas quedan como bloqueos seguros: informan `Biometría desactivada temporalmente.` y retornan sin invocar WebAuthn.
- Se limpian credenciales biométricas locales legacy (`pc_biometric_*` y `pc_last_biometric_uid`) sin borrar clientes, préstamos, cuotas, pagos, backup ni configuración general.
- El login vigente y seguro es únicamente email + contraseña.

## Motivo
- El flujo biométrico en celular seguía permitiendo acceso con email vacío o distinto.
- Se decidió retirar la biometría para una futura reimplementación limpia, sin arrastrar rutas legacy ni credenciales locales antiguas.

## Pendiente futuro
- Rediseñar biometría desde cero con validación estricta por cuenta, UID Firebase y credencial WebAuthn.
- Auditar en dispositivo móvil real antes de volver a habilitarla.

**Commit asociado:** PENDIENTE

## 9.3 — Seguridad local y respaldo manual

**Estado:** CERRADO

**Fecha:** 2026-06-23

## Cerrado
- Respaldo JSON manual v3 con fecha, hora y zona horaria.
- Clientes, préstamos, cuotas, pagos embebidos, bitácora y configuración no secreta incluidos.
- Registros eliminados conservados para que el respaldo sea completo.
- Contraseñas, API keys, PIN, biometría, tokens, UID internos y metadatos de sincronización excluidos.
- Advertencia visible y confirmación previa por tratarse de datos sensibles.
- Nombre de archivo identificable con fecha y hora local.
- Exportación Excel existente reutilizada como formato legible.
- Sin restauración nueva, borrado de datos ni cambios de schema.

**Commit asociado:** `b177c10`

---

# ETAPA 10 — ORDEN TÉCNICO

**Estado:** COMPLETADA

---

# ETAPA 11 — RESTAURACIÓN COMPLETA Y SINCRONIZACIÓN ENTRE DISPOSITIVOS

**Estado:** COMPLETADA

**Fecha de cierre:** 18/07/2026

## Restauración completa

- Flujo completo de restauración `backup → IndexedDB → Firebase`.
- Previsualización y validación del respaldo antes de reemplazar los datos activos.
- Escritura local completa en IndexedDB, incluidos los registros eliminados necesarios para conservar el estado real del respaldo.
- Publicación del estado restaurado en Firebase para que la restauración converja en todos los dispositivos vinculados.
- Uso de `restorePending` como estado persistente cuando la restauración ya fue aplicada localmente pero todavía no pudo publicarse.

## Seguridad durante `restorePending`

- Activación automática del modo solo lectura mientras exista una restauración pendiente.
- Blindaje de las escrituras generales para impedir pagos, altas, ediciones, eliminaciones y otras mutaciones durante `restorePending`.
- Aviso visible del estado de restauración pendiente y de las acciones permitidas.
- Conservación de la consulta y navegación sobre los datos restaurados sin permitir cambios que puedan divergir del backup.
- Acciones disponibles para **Reintentar publicación** y **Cancelar restauración**.

## Recuperación de conexión y publicación

- Publicación automática a Firebase al recuperar conexión cuando existe `restorePending`.
- Reintento manual de publicación sin volver a importar el archivo.
- Cancelación segura de la restauración local pendiente para abandonar el estado restaurado no publicado y volver a sincronizar desde Firebase.
- Limpieza de `restorePending` únicamente después de completar la publicación o la cancelación correspondiente.

## Tombstones y convergencia

- Publicación de tombstones para los registros que deben quedar eliminados después de restaurar.
- Convergencia del estado completo entre PC, celular, IndexedDB y Firebase, sin resucitar registros ausentes del backup.
- Respeto de `_deleted`, `deletedAt` y metadatos de actualización durante la propagación del estado restaurado.
- Sincronización final verificada en ambos sentidos después de concluir la restauración.

## Reparación y auditoría de sincronización

- Reparación de sincronización local desde Firebase disponible como operación explícita.
- Auditoría completa de las rutas de escritura y sincronización durante una restauración pendiente.
- Revisión de clientes, préstamos, cuotas, pagos, historial, configuración y cola de sincronización.
- Corrección de escrituras residuales que podían ejecutarse fuera del blindaje general.
- Corrección de los dos bloqueos finales detectados en `importarBackup()` y `repararSyncLocalDesdeFirebase()`, permitiendo que ambas operaciones autorizadas completen su trabajo sin ser bloqueadas por el propio `restorePending`.

## Pruebas funcionales realizadas

- Restauración completa iniciada en PC y recepción del estado restaurado en celular.
- Restauración completa iniciada en celular y convergencia posterior en PC.
- Importación del backup con conexión y publicación inmediata a Firebase.
- Importación del backup sin conexión, persistencia local de `restorePending` y activación del modo solo lectura.
- Bloqueo efectivo de escrituras mientras la publicación permanece pendiente.
- Recuperación de conexión y publicación automática sin repetir la importación.
- Reintento manual de publicación después de un fallo de conexión.
- Cancelación de una restauración pendiente y reparación posterior desde Firebase.
- Propagación de tombstones y ausencia de resurrección de registros eliminados.
- Reparación de sincronización local desde Firebase.
- Sincronización final PC ↔ celular y offline ↔ online con los mismos datos en IndexedDB y Firebase.

## Validación real

La funcionalidad quedó validada en pruebas reales entre PC y celular, incluyendo pérdida y recuperación de conexión, restauración local, publicación automática, reintento, cancelación, reparación local y convergencia final entre dispositivos.

## Commits relevantes

- `bd78128` — Agrega previsualización de restauración backup.
- `b439660` — Agrega helpers raw para restauración backup.
- `b3fc211` — Completa restauración segura y sincronización entre dispositivos.

---

# PENDIENTES NUEVOS / FUTUROS

## Comprobantes profesionales
**Estado:** PENDIENTE ETAPA 5

Objetivo:
- Fondo blanco.
- Sin franja negra grande.
- Mejor impresión.
- Menor consumo de tinta.
- Textos legibles.
- Diseño profesional.
- Comprobante de préstamo y comprobante de pago.

## Pago mixto
**Estado:** PENDIENTE FUNCIONAL

Permitir pagar una cuota con más de un método: efectivo, transferencia, MercadoPago u otro.

## Renovación Fase 2
**Estado:** PENDIENTE FUNCIONAL

Separar contablemente: efectivo entregado, capital refinanciado, compensación, interés cobrado y caja real.

## Riesgo automático
**Estado:** PENDIENTE

Calcular riesgo bajo / medio / alto según historial real del cliente.

## Resumen de clientes
**Estado:** PENDIENTE

Mostrar: habilitados, bloqueados, atrasados, sin deuda y con crédito activo.

## Empeños
**Estado:** PENDIENTE FUTURO

Crear módulo propio de empeños: prenda, tasación, dueño / cliente, valor prestado, préstamo asociado, estado, vencimiento y acciones.

---

# ESTADO ACTUAL

**Etapa actual:** ETAPA 11 — Restauración completa y sincronización entre dispositivos — COMPLETADA
**Último bloque cerrado:** ETAPA 11 — Restauración completa y sincronización entre dispositivos
**Validación:** Pruebas reales PC ↔ celular y offline ↔ online completadas correctamente

---

# ÚLTIMOS COMMITS RELACIONADOS A ETAPA 5

```bash
git commit -m "Profesionaliza comprobantes imprimibles"
git commit -m "Muestra comprobante tras renovacion con cuota compensada"
git commit -m "Pulido visual de tarjetas badges y botones"
git commit -m "Corrige vista cuotas retraida y refresco"
```

No usar `git add .` si hay documentos o archivos no relacionados pendientes.

---

# HISTORIAL TÉCNICO

## 18/07/2026 — Restauración completa y convergencia multidispositivo

- Se cerró la implementación `backup → IndexedDB → Firebase`.
- Se incorporó `restorePending`, el modo solo lectura y el blindaje integral de escrituras.
- Se completaron publicación automática, reintento y cancelación de restauraciones pendientes.
- Se auditaron tombstones, cola de sincronización, reparación local y convergencia entre dispositivos.
- Se corrigieron los bloqueos finales de `importarBackup()` y `repararSyncLocalDesdeFirebase()`.
- La funcionalidad fue validada en pruebas reales entre PC y celular, con escenarios online, offline, recuperación de conexión y sincronización final.
