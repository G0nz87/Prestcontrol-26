# PRESTCONTROL - ROADMAP MAESTRO COMPLETO

## Estado general del proyecto

PrestControl es una aplicación web para gestión de préstamos, clientes, cuotas, cobranzas y control financiero.

El proyecto trabaja con:

- Netlify
- Firebase
- Firestore
- Firebase Auth
- IndexedDB
- GitHub
- VS Code
- Codex como asistente principal de desarrollo

---

# REGLA IMPORTANTE DE TRABAJO CON IA

Cuando el usuario pida un archivo completo, roadmap completo, diagnóstico completo o versión completa, NO entregar versiones resumidas, parciales ni simplificadas.

Regla:

- Si se pide completo, se entrega completo.
- No hacer cosas a medias.
- No reemplazar un documento completo por un resumen.
- Si algo no se puede completar, aclararlo explícitamente.
- No omitir secciones importantes sin avisar.

---

# PROBLEMAS YA RESUELTOS Y CERRADOS

Los siguientes problemas ya fueron detectados, corregidos, probados y validados.

No deben reabrirse en auditorías futuras salvo solicitud explícita del usuario.

## Problemas cerrados

- Reglas de Firestore corregidas y publicadas.
- Problema de clientes que aparecían y desaparecían.
- Ajuste `_deleted:false` y `deletedAt:null` en creación de clientes.
- Diagnóstico inicial Firebase / IndexedDB.
- Dominios autorizados en Firebase Auth configurados.
- Funcionamiento validado con Netlify.
- Funcionamiento validado con localhost.
- Detección del error de prueba usando `file:///` en lugar de servidor local.
- Corrección del comportamiento de alertas probando correctamente con Live Server.
- Visualización de fechas corregida durante pruebas locales.

Estos puntos se consideran CERRADOS.

---

# ESTADO GENERAL DEL ROADMAP

✅ ETAPA 1 — Centro de Alertas Internas — COMPLETADA

⏳ ETAPA 2 — Estabilidad Firebase y Sync — Pendiente

⏳ ETAPA 3 — Métricas Financieras Correctas — Pendiente

⏳ ETAPA 4 — Dashboard Profesional — Pendiente

⏳ ETAPA 5 — Mejora Visual General — Pendiente

⏳ ETAPA 6 — Notificaciones PWA — Pendiente

⏳ ETAPA 7 — Comandos por Voz — Pendiente

⏳ ETAPA 8 — Evaluación WhatsApp — Pendiente

⏳ ETAPA 9 — Seguridad Pro — Pendiente

⏳ ETAPA 10 — Orden Técnico — Pendiente

---

# ETAPA 1 — CENTRO DE ALERTAS INTERNAS

Estado: ✅ COMPLETADA

Fecha de finalización: Junio 2026

## Objetivo

Crear un Centro de Alertas Internas dentro de PrestControl para mejorar el seguimiento diario de la cartera sin depender de WhatsApp, comandos por voz, push notifications ni servicios externos.

## Funcionalidades implementadas

### 1. Cuotas vencidas

Se implementó la detección y visualización automática de cuotas vencidas.

La alerta muestra:

- Cliente
- Monto
- Días de atraso
- Número de cuota
- Préstamo asociado

### 2. Cuotas que vencen hoy

Se implementó la detección de cuotas con vencimiento en la fecha actual.

Esto permite saber rápidamente qué cobros corresponden al día.

### 3. Próximos cobros a 7 días

Se implementó una sección de próximos cobros que muestra cuotas pendientes dentro de los próximos 7 días.

La información incluye:

- Cliente
- Fecha de vencimiento
- Monto
- Número de cuota
- Préstamo relacionado

### 4. Clientes con varias cuotas atrasadas

Se implementó un resumen de clientes que acumulan múltiples cuotas vencidas.

Esto permite detectar clientes con mayor riesgo de mora.

### 5. Estado de sincronización

Se agregó una sección para visualizar errores de sincronización cuando existan.

Si no existen errores, muestra:

- Sin errores de sincronización

### 6. Badge de alertas

Se incorporó una campanita visible en el encabezado principal.

El badge sirve para indicar alertas activas o novedades según el comportamiento definido durante la implementación.

## Alcance técnico

La Etapa 1 usa datos existentes de:

- IndexedDB
- Clientes
- Préstamos
- Cuotas
- Sync Queue

No se implementó:

- WhatsApp
- Comandos por voz
- Push notifications
- Firebase Functions
- Cambios grandes de diseño
- Refactor masivo
- Cambios de reglas Firebase
- Cambios profundos de sincronización

## Problemas detectados durante la Etapa 1

Durante las pruebas se detectó que la app se estaba abriendo parcialmente desde:

`file:///`

Eso no era el entorno correcto para probar una aplicación web con Firebase, IndexedDB, rutas y localStorage.

La forma correcta de probar localmente es mediante Live Server o un servidor local:

`http://localhost:5500`

o una URL equivalente.

Al probar correctamente desde localhost, el comportamiento de la app quedó validado.

## Resultado de la Etapa 1

PrestControl ahora cuenta con un Centro de Alertas Internas funcional.

Permite visualizar:

- Cuotas vencidas.
- Cuotas que vencen hoy.
- Próximos cobros.
- Clientes con varias cuotas atrasadas.
- Estado de sincronización.
- Badge de alertas.

La Etapa 1 se considera COMPLETADA y CERRADA.

No debe reabrirse salvo que el usuario solicite explícitamente revisar alertas internas.

---

# ETAPA 2 — ESTABILIDAD FIREBASE Y SYNC

Estado: ⏳ Pendiente

## Objetivo

Fortalecer la consistencia de datos entre:

- IndexedDB
- Firebase Firestore
- Sync Queue

para evitar pérdidas, conflictos, sobrescrituras o desaparición de datos.

## Debe incluir

- Extender `_deleted:false` y `deletedAt:null` a upserts de clientes, préstamos y cuotas.
- Evitar que pull/realtime sobrescriba registros con operaciones pendientes.
- Mostrar errores claros como `permission-denied`.
- Mejorar el estado visible de sincronización.
- Documentar política de conflictos.
- Evitar que datos remotos viejos pisen datos locales pendientes.
- Revisar comportamiento de realtime.
- Mejorar control de errores Firebase.

## No debe reabrir

- El problema ya cerrado de clientes que desaparecían.
- Las reglas Firestore ya publicadas.
- El diagnóstico inicial Firebase / IndexedDB.

Solo avanzar sobre estabilidad nueva o mejoras pendientes.

---

# ETAPA 3 — MÉTRICAS FINANCIERAS CORRECTAS

Estado: ⏳ Pendiente

## Objetivo

Hacer que los números financieros de PrestControl sean confiables, claros y útiles para tomar decisiones.

## Debe incluir

- Capital prestado.
- Capital recuperado.
- Capital pendiente.
- Interés cobrado.
- Interés proyectado.
- Monto vencido.
- Monto atrasado.
- Porcentaje recuperado.
- Mora real.
- Cashflow próximos 7, 15 y 30 días.
- Salud de cartera.
- Diferencia entre monto pendiente y monto vencido.
- Tendencia mensual.
- Cobrado este mes vs mes anterior.
- Préstamos nuevos.
- Pagos recibidos.
- Atraso nuevo.

## Punto importante

Las métricas deben calcularse desde una lógica clara y centralizada para evitar que cada pantalla calcule distinto.

---

# ETAPA 4 — DASHBOARD PROFESIONAL

Estado: ⏳ Pendiente

## Objetivo

Transformar el dashboard en una herramienta financiera profesional.

## Debe incluir

- KPIs financieros claros.
- Mejor jerarquía visual.
- Tarjetas más limpias.
- Comparación mes actual vs mes anterior.
- Ranking de clientes.
- Resumen semanal.
- Indicadores de riesgo.
- Capital activo.
- Mora.
- Interés cobrado.
- Cobros esperados.
- Clientes destacados.
- Alertas resumidas.

## Resultado esperado

Que al abrir PrestControl se vea como un sistema financiero profesional, no solo como una lista de datos.

---

# ETAPA 5 — MEJORA VISUAL GENERAL

Estado: ⏳ Pendiente

## Objetivo

Pulir estética, claridad y experiencia de uso sin romper funciones.

## Debe incluir

- Reducir emojis como iconografía principal.
- Evaluar iconos consistentes, por ejemplo lucide.
- Unificar estilos entre `css/styles.css` e `index.html`.
- Reducir estilos inline.
- Mejorar jerarquía tipográfica.
- Pulir paleta visual.
- Mejorar estados vacíos.
- Mejorar pantalla de configuración.
- Profesionalizar comprobantes PDF.
- Mejorar exportaciones Excel.
- Mejorar orden visual de cards, badges y botones.

---

# ETAPA 6 — NOTIFICACIONES PWA

Estado: ⏳ Pendiente

## Objetivo

Agregar avisos dentro del navegador o la app instalada.

## Debe incluir

- Notificaciones locales.
- Permiso del navegador.
- Avisos de cuotas vencidas.
- Avisos de cuotas de hoy.
- Avisos de próximos cobros.
- Preferencias de usuario.
- Evitar duplicados.

## No implementar todavía sin aprobación

- Push real con backend.
- Firebase Functions.
- Netlify Functions.
- WhatsApp.

---

# ETAPA 7 — COMANDOS POR VOZ

Estado: ⏳ Pendiente

## Objetivo

Permitir carga rápida mediante voz, sin reemplazar los formularios tradicionales.

## Debe incluir

- Botón micrófono.
- Crear cliente por voz.
- Crear préstamo por voz.
- Buscar cliente por voz.
- Vista previa obligatoria.
- Confirmación manual antes de guardar.
- Nunca guardar directamente sin revisión.
- Manejo de errores de interpretación.
- Fallback manual.

## Regla crítica

Todo comando de voz debe mostrar una vista previa antes de guardar.

---

# ETAPA 8 — EVALUACIÓN WHATSAPP

Estado: ⏳ Pendiente

## Objetivo

Evaluar si realmente conviene integrar WhatsApp.

## Debe incluir

- WhatsApp Business API.
- Costos.
- Límites.
- Plantillas.
- Restricciones.
- Beneficio real.
- Alternativas internas dentro de PrestControl.

## Regla

No implementar WhatsApp sin aprobación explícita.

---

# ETAPA 9 — SEGURIDAD PRO

Estado: ⏳ Pendiente

## Objetivo

Endurecer seguridad general del sistema.

## Debe incluir

- Versionar `firestore.rules`.
- Verificar dominios autorizados.
- Revisar export/import.
- Proteger acciones destructivas.
- Evaluar Firebase App Check.
- Evitar datos sensibles en localStorage o IndexedDB.
- Validar permisos desde Firestore Rules.
- Revisar operaciones administrativas.

---

# ETAPA 10 — ORDEN TÉCNICO

Estado: ⏳ Pendiente

## Objetivo

Mejorar mantenibilidad del proyecto.

## Debe incluir

- Reducir tamaño de `index.html`.
- Separar cálculos financieros en módulo único.
- Reducir duplicación entre `index.html` y carpetas `js/`.
- Reducir estado global en `window`.
- Agregar pruebas básicas.
- Revisar service worker/cache.
- Ordenar módulos.
- Evitar duplicación de lógica.
- Documentar arquitectura.

---

# REGLA DE TRABAJO

- Trabajar una etapa a la vez.
- No hacer todas las etapas juntas.
- Antes de modificar archivos, mostrar plan exacto.
- Mostrar archivos a tocar.
- Mostrar riesgos.
- Esperar aprobación.
- Hacer cambios mínimos y seguros.
- Mostrar diff al finalizar.
- No hacer commit sin aprobación.
- No hacer push sin aprobación.
- No hacer deploy sin aprobación.
- No refactorizar masivamente.
- No mezclar etapas.
- Mantener Firebase, IndexedDB, GitHub y Netlify funcionando.

---

# REGLA DE AUDITORÍA DEL PROYECTO

Todo problema que haya sido:

1. Detectado.
2. Corregido.
3. Probado.
4. Validado por el usuario.

se considera CERRADO.

Los problemas cerrados no deben volver a aparecer en auditorías, diagnósticos, planes de mejora o recomendaciones futuras, salvo que el usuario solicite explícitamente revisarlos nuevamente.

Las auditorías futuras deben enfocarse únicamente en:

- Problemas nuevos.
- Riesgos nuevos.
- Funcionalidades pendientes del roadmap vigente.
- Mejoras aún no implementadas.

No reabrir temas cerrados por defecto.

---

# PRÓXIMO PASO

La siguiente etapa recomendada es:

## ETAPA 2 — ESTABILIDAD FIREBASE Y SYNC

Antes de implementarla, Codex debe presentar:

1. Archivos que tocaría.
2. Funciones que modificaría.
3. Riesgos.
4. Pruebas necesarias.
5. Plan exacto.
6. Confirmación de que no reabrirá problemas ya cerrados.

