# ROADMAP MAESTRO — PRESTCONTROL

**Proyecto:** PrestControl  
**Stack:** Netlify + Firebase + GitHub + IndexedDB  
**Última actualización:** 20/06/2026  
**Estado general:** Etapa 5 cerrada

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

**Estado:** CERRADO

**Fecha:** 2026-06-23

## Cerrado
- Credenciales biométricas asociadas al email normalizado y UID de Firebase.
- El email escrito en login limita la biometría exclusivamente a esa cuenta.
- Un email distinto bloquea el acceso antes de solicitar la credencial del dispositivo.
- Con email vacío se usa solamente el último UID biométrico guardado y se muestra su cuenta en el login.
- WebAuthn recibe una única credencial seleccionada, no todas las registradas en el dispositivo.
- Cambiar de usuario Firebase invalida la credencial de otra cuenta y exige registrarla nuevamente.
- Registro, eliminación y estado visual de biometría resueltos por UID.

**Commit asociado:** `09df84d`

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

**Commit asociado:** PENDIENTE

---

# ETAPA 10 — ORDEN TÉCNICO

**Estado:** PENDIENTE

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

**Etapa actual:** ETAPA 9 — Seguridad avanzada — EN PROGRESO
**Último bloque cerrado:** ETAPA 9.3 — Seguridad local y respaldo manual
**Próximo bloque recomendado:** Validar y desplegar manualmente las reglas Firestore con aprobación explícita

---

# ÚLTIMOS COMMITS RELACIONADOS A ETAPA 5

```bash
git commit -m "Profesionaliza comprobantes imprimibles"
git commit -m "Muestra comprobante tras renovacion con cuota compensada"
git commit -m "Pulido visual de tarjetas badges y botones"
git commit -m "Corrige vista cuotas retraida y refresco"
```

No usar `git add .` si hay documentos o archivos no relacionados pendientes.
