# CODEX_RULES — PRESTCONTROL

## OBJETIVO

Definir las reglas permanentes de trabajo para Codex dentro del proyecto **PrestControl**.

Estas reglas tienen prioridad sobre preferencias implícitas.
Si una tarea contradice estas reglas, Codex debe **detenerse y explicarlo** antes de modificar código.

---

# REGLA MADRE

PrestControl es una **app productiva**.

Por lo tanto:
- la estabilidad del sistema vale más que la velocidad,
- los cambios deben ser **mínimos, trazables y verificables**,
- no se deben introducir refactorizaciones, experimentos ni reestructuraciones innecesarias.

---

# REGLAS GENERALES

## 1) CAMBIO MÍNIMO OBLIGATORIO
Resolver el problema con la **menor cantidad posible de cambios**.

Evitar:
- refactorizaciones no pedidas,
- renombrados masivos,
- mover archivos “por prolijidad”,
- cambios de arquitectura no solicitados,
- cambios visuales no pedidos,
- reemplazar un flujo completo si alcanza con corregir el punto defectuoso.

---

## 2) PROBLEMA CERRADO = NO REABRIR
Todo problema marcado como **CERRADO**:
- no debe reabrirse,
- no debe tocarse de nuevo,
- no debe “mejorarse” por iniciativa propia,

salvo instrucción explícita del usuario.

---

## 3) NO TOCAR OTRAS ETAPAS
Si el usuario está trabajando en una etapa o subtarea concreta:

- no avanzar sobre otras etapas por cuenta propia,
- no mezclar tareas,
- no “aprovechar” para corregir otras áreas,
- no mover el roadmap de etapa salvo que la tarea efectivamente quede cerrada.

---

## 4) NO ASUMIR QUÉ CÓDIGO ESTÁ ACTIVO
PrestControl tiene mezcla de:
- lógica en `index.html`
- módulos en `ui/`, `services/`, `repositories/`, `core/`
- copias o rutas legacy dentro de `js/`

Por lo tanto:
- nunca asumir que un archivo legacy está cargado,
- nunca asumir que un módulo nuevo reemplaza al inline si no se verifica,
- antes de tocar una funcionalidad, identificar la **ruta real activa**.

---

# REGLAS DE ALCANCE

## 5) SI LA TAREA ES PUNTUAL, EL ALCANCE TAMBIÉN
Ejemplos:
- si la tarea es WhatsApp del comprobante, no tocar alertas ni sync,
- si la tarea es biometría, no tocar préstamos ni métricas,
- si la tarea es dashboard, no tocar autenticación.

Codex debe dejar explícito:
- qué archivos va a tocar,
- qué archivos no va a tocar,
- por qué.

---

## 6) SI HAY DOS FLUJOS SIMILARES Y UNO FUNCIONA, USARLO COMO REFERENCIA
Cuando una función falla en una pantalla pero funciona en otra:
1. comparar ambos flujos,
2. detectar diferencias reales,
3. intentar alinear el flujo defectuoso con el que ya funciona,
4. evitar crear un tercer camino paralelo.

---

## 7) NO DUPLICAR LÓGICA
Si ya existe una función canónica para:
- WhatsApp,
- cálculo de cuotas,
- validación de sesión,
- render de comprobantes,
- normalización de teléfonos,
- confirmaciones críticas,

debe reutilizarse esa función, salvo que haya una razón técnica clara para no hacerlo.

Si se necesita una nueva función:
- justificar por qué la existente no sirve,
- dejarla lo más acotada posible.

---

# REGLAS DE SEGURIDAD / DATOS

## 8) NO TOCAR FIREBASE SIN PEDIDO EXPLÍCITO
No modificar por cuenta propia:
- reglas Firestore,
- estructura de colecciones,
- flujo de autenticación,
- persistencia de sesión,
- permisos,
- storage,
- service worker con impacto de sesión,

salvo que la tarea sea justamente de seguridad/autenticación o exista autorización explícita del usuario.

---

## 9) NO PONER EN RIESGO DATOS REALES
PrestControl maneja:
- clientes
- teléfonos
- DNI / datos personales
- préstamos
- cuotas
- pagos
- bitácora
- sincronización offline

Por lo tanto, está prohibido:
- borrar datos locales o remotos por defecto,
- limpiar IndexedDB sin autorización,
- resetear configuración productiva sin pedirlo,
- alterar el schema sin explicar el impacto,
- cambiar el significado de estados o métricas sin validación.

---

## 10) LOGS TEMPORALES = TEMPORALES
Si se agregan logs, trazas o toasts de diagnóstico:
- deben quedar marcados como temporales,
- no deben modificar la lógica del negocio,
- deben retirarse al cerrar el diagnóstico, salvo pedido contrario.

---

# REGLAS DE IMPLEMENTACIÓN

## 11) PRESERVAR COMPORTAMIENTO EXISTENTE
Si se corrige un bug:
- no romper el flujo ya funcional,
- no cambiar textos, estilos o cálculos salvo que la tarea lo pida,
- no tocar UX aprobada si el bug es interno.

---

## 12) NO CAMBIAR CÁLCULOS FINANCIEROS SIN ORDEN DIRECTA
No modificar por cuenta propia:
- capital activo
- capital pendiente
- capital recuperado
- interés
- ROI
- mora
- cashflow
- compensaciones de renovación
- estados financieros del dashboard

salvo que la tarea sea explícitamente sobre eso.

---

## 13) NO CAMBIAR WHATSAPP / PWA / BIOMETRÍA POR ARRASTRE
Estas zonas ya dieron problemas y deben tocarse con precisión quirúrgica:
- WhatsApp
- service worker / caché / PWA
- biometría / WebAuthn
- logout / sesión / bloqueo local

Si la tarea no es sobre una de estas superficies, no modificarlas.

---

# REGLAS DE ENTREGA

## 14) FORMATO DE RESPUESTA OBLIGATORIO
Al terminar una tarea, responder siempre con:

## Diagnóstico
## Archivos modificados
## Cambios realizados
## Verificaciones realizadas
## Riesgos
## Estado

Estado debe ser:
- **CERRADO**
o
- **PENDIENTE**

---

## 15) NO MARCAR “CERRADO” SIN PRUEBA RAZONABLE
Un problema puede quedar:
- **CERRADO EN CÓDIGO** si se corrigió pero falta validación real,
- **PENDIENTE** si todavía no está demostrado,
- **CERRADO** solo cuando el alcance pedido quedó resuelto.

No vender como “resuelto” algo que sigue sin validación mínima.

---

## 16) SI NO SE PUEDE CONFIRMAR, DECIRLO
Si no es posible verificar:
- porque falta probar en celular,
- porque Netlify no está actualizado,
- porque la PWA puede estar cacheada,
- porque una regla Firebase no fue desplegada,

debe decirse explícitamente.

---

# REGLAS DE DOCUMENTACIÓN

## 17) ROADMAP_MAESTRO SÍ, LOOP/RULES NO
Si una tarea queda cerrada:
- **ROADMAP_MAESTRO.md** puede actualizarse automáticamente.

Pero:
- **CODEX_LOOP.md** no se modifica automáticamente.
- **CODEX_RULES.md** no se modifica automáticamente.

Solo se pueden **proponer mejoras** a LOOP o RULES y deben ser aprobadas por el usuario.

---

## 18) LA DOCUMENTACIÓN DEBE RESPETAR EL ESTADO REAL
Si se actualiza el roadmap:
- reflejar etapa, subtarea, estado y commit real,
- no adelantar etapas que no están terminadas,
- no borrar decisiones previas importantes,
- no reescribir la historia del proyecto.

---

# REGLAS DE DETENCIÓN

## 19) SI ENTRA EN BUCLE, FRENAR
Si después de varios intentos la solución no aparece:
- detener el ciclo,
- explicar qué se intentó,
- explicar por qué no alcanza,
- pedir una validación concreta o un dato puntual.

Nunca seguir cambiando código a ciegas.

---

## 20) SI HAY DUDA ENTRE “TOCAR MÁS” O “CONSERVAR ESTABLE”, GANARÁ CONSERVAR
Ante la duda:
- conservar el comportamiento estable,
- dejar el problema acotado,
- pedir validación antes de ampliar el cambio.

---

# AUTOGESTIÓN DEL SISTEMA

ROADMAP_MAESTRO.md:
Puede actualizarse automáticamente cuando una tarea quede finalizada.

CODEX_LOOP.md:
No puede modificarse automáticamente.
Solo puede proponer mejoras.

CODEX_RULES.md:
No puede modificarse automáticamente.
Solo puede proponer mejoras.

Toda propuesta deberá ser aprobada por el usuario.
