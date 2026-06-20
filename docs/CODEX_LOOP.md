# CODEX_LOOP.md

## OBJETIVO

Trabajar mediante un ciclo de análisis, implementación, verificación y corrección continua.

No realizar cambios impulsivos ni modificaciones masivas sin validación.

---

# CICLO OBLIGATORIO

Para cada tarea seguir estrictamente el siguiente flujo:

## FASE 1 - COMPRENDER

Antes de modificar cualquier archivo:

1. Leer la tarea completa.
2. Identificar el problema exacto.
3. Identificar la causa raíz probable.
4. Enumerar los archivos afectados.
5. Explicar el plan de acción.

No escribir código todavía.

---

## FASE 2 - ALCANCE

Definir:
- Qué archivos serán modificados.
- Qué archivos NO deben modificarse.
- Riesgos potenciales.

Mantener el cambio lo más pequeño posible.

---

## FASE 3 - IMPLEMENTACIÓN

Realizar únicamente los cambios necesarios para resolver el problema.

Evitar:
- Refactorizaciones innecesarias.
- Cambios visuales no solicitados.
- Cambios de arquitectura no solicitados.
- Renombrados masivos.

---

## FASE 4 - VERIFICACIÓN

Verificar obligatoriamente:
- Funcionalidad nueva.
- Funcionalidad existente.
- Casos límite.

---

## FASE 5 - AUTO CORRECCIÓN

Si se detecta cualquier error:

1. Analizar la causa.
2. Corregir.
3. Volver a verificar.

Máximo:
5 ciclos consecutivos.

Si después de 5 ciclos el problema persiste:

DETENERSE.

Informar:
- Qué se intentó.
- Qué falló.
- Qué información adicional se necesita.

Nunca entrar en bucles infinitos.

---

# REGLAS PRESTCONTROL

## PROBLEMAS CERRADOS

Un problema marcado como CERRADO:
NO debe reabrirse.

Salvo instrucción explícita del usuario.

---

## ETAPAS

Etapa 1: COMPLETADA
Etapa 2: COMPLETADA
Etapa 3: COMPLETADA / ESTABLE
Etapa 4: PARCIAL / ESTABLE
Etapa 5: COMPLETADA / ESTABLE
Etapa 6: EN PROGRESO
Etapa 7: PENDIENTE
Etapa 8: PENDIENTE
Etapa 9: PENDIENTE
Etapa 10: PENDIENTE

No trabajar sobre otras etapas salvo indicación explícita.

---

## FIREBASE

No modificar:
- reglas
- autenticación
- estructura de colecciones

sin autorización explícita.

---

## CAMBIOS MÍNIMOS

Prioridad absoluta:
Resolver el problema con la menor cantidad posible de cambios.

---

# ACTUALIZACIÓN DE ROADMAP

Si una tarea queda resuelta:

Actualizar:
ROADMAP_MAESTRO.md

registrando:
- fecha
- tarea
- resultado
- commit asociado
- estado

---

# FORMATO DE ENTREGA

Al finalizar responder siempre:

## Diagnóstico
## Archivos modificados
## Cambios realizados
## Verificaciones realizadas
## Riesgos
## Estado

CERRADO o PENDIENTE

---

# REGLA PRINCIPAL

Es preferible modificar 10 líneas correctas que 500 líneas innecesarias.

La estabilidad del sistema tiene prioridad sobre la velocidad de implementación.

---

## AUTOGESTIÓN DEL SISTEMA

ROADMAP_MAESTRO.md:
Puede actualizarse automáticamente cuando una tarea quede finalizada.

CODEX_LOOP.md:
No puede modificarse automáticamente.
Solo puede proponer mejoras.

CODEX_RULES.md:
No puede modificarse automáticamente.
Solo puede proponer mejoras.

Toda propuesta deberá ser aprobada por el usuario.
