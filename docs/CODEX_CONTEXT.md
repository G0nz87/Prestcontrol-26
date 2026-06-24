# CODEX_CONTEXT — PRESTCONTROL

## OBJETIVO

Este archivo resume el contexto técnico y operativo real del proyecto **PrestControl** para que Codex no tenga que redescubrir la arquitectura en cada tarea.

No reemplaza al roadmap ni al loop.
Su función es **reducir contexto repetido, evitar falsas suposiciones y bajar consumo de tokens**.

---

# 1) IDENTIDAD DEL PROYECTO

**Proyecto:** PrestControl  
**Tipo:** PWA / app web de gestión de préstamos  
**Stack principal:** Netlify + Firebase + Firestore + Auth + IndexedDB + GitHub  
**Uso:** producción real con datos de clientes, préstamos, cuotas, pagos y bitácora

PrestControl no es un proyecto de laboratorio.
Todo cambio debe tratarse como cambio sobre una app ya operativa.

---

# 2) PRINCIPIO OPERATIVO

PrestControl tiene una base híbrida:
- parte del flujo vive en `index.html`
- parte vive en módulos
- parte del código legacy sigue presente en `js/`

Por eso, ante cualquier bug, el primer paso es siempre:
**identificar la ruta real activa**.

No asumir que un archivo existe = está cargado.
No asumir que un módulo nuevo reemplazó al código inline si no se verifica.

---

# 3) MAPA TÉCNICO DEL PROYECTO

## Núcleo general
- `index.html`
  - sigue siendo el archivo central del proyecto
  - contiene mucho flujo inline real
  - suele alojar UI, sheets, acciones de clientes/préstamos/cuotas, login, comprobantes, WhatsApp y biometría

## Firebase / sesión
- `core/firebase.js`
  - inicialización Firebase
  - sesión base
  - integración Firestore/Auth

- `services/AuthService.js`
  - login / logout / listener de sesión
  - parte de la lógica de acceso y control de usuario

## Datos / persistencia
- `repositories/Repository.js`
  - acceso a Firestore bajo `users/{uid}/...`

- IndexedDB
  - cache local / soporte offline / sincronización
  - puede contener clientes, préstamos, cuotas, bitácora y colas de sync

## UI modular
- `ui/clientes.js`
- `ui/prestamos.js`
- `ui/...`
  - lógica más moderna por secciones
  - pero no reemplazan automáticamente el inline de `index.html`

## Servicios
- `services/MetricasFinancierasService.js`
  - métricas financieras del dashboard

## PWA
- `sw.js`
  - shell offline
  - cache
  - notificaciones locales PWA

## Legacy
- carpeta `js/`
  - puede contener copias antiguas de lógica actual
  - no asumir que está activa
  - solo usarla como referencia si se confirma que participa del flujo

---

# 4) MODELO DE DATOS A NIVEL NEGOCIO

PrestControl trabaja principalmente con:

## Clientes
Campos típicos:
- nombre
- teléfono
- DNI / datos personales
- dirección / notas / referencias

## Préstamos
Campos típicos:
- clienteId
- monto
- interés
- frecuencia
- cuotas
- estado
- fechas
- renovaciones / compensaciones

## Cuotas
Campos típicos:
- préstamo asociado
- monto
- vencimiento
- estado
- pagos
- método
- metadata de compensación o renovación

## Bitácora / historial
Registra operaciones relevantes del sistema.

## Configuración local
Puede incluir preferencias visuales, recordatorios, biometría y datos auxiliares no críticos.

---

# 5) REGLAS IMPORTANTES DEL DOMINIO

## Cuotas
Una cuota puede estar:
- pendiente
- atrasada
- pagada
- cerrada / ejecutada / cancelada según contexto

Las reglas de “cuota cobrable” son sensibles y no deben tocarse sin revisar la lógica canónica ya existente.

## Renovación
La renovación ya tiene una lógica cerrada de Fase 1:
- puede compensar una cuota pendiente
- el nuevo préstamo nace con monto nominal completo
- la compensación no debe romper métricas ni estados históricos

## Comprobantes
Existen comprobantes de pago / préstamo con diseño ya bastante estabilizado.
No tocar su estructura si la tarea no es sobre comprobantes.

## WhatsApp
Hay flujos de WhatsApp de:
- cuotas / cobranza
- comprobantes

Históricamente el WhatsApp del comprobante dio problemas por rutas paralelas y normalización de teléfonos.

## Biometría
La biometría usa WebAuthn y está vinculada a la sesión del usuario.
Es una zona sensible y no debe tocarse por arrastre.

---

# 6) ZONAS SENSIBLES DEL PROYECTO

Estas superficies deben tocarse con extremo cuidado:

## A) Autenticación / sesión
- login
- logout
- persistencia Firebase
- bloqueo por inactividad
- reautenticación
- biometría / WebAuthn

## B) Datos locales / sync
- IndexedDB
- cola de sincronización
- merge local/remoto
- `_deleted`
- `updatedAt`
- conflictos entre PC y celular

## C) WhatsApp
- normalización de teléfonos
- `wa.me`
- flujo de cobranza
- flujo de comprobante

## D) Renovación / compensación
- marca de cuota compensada
- creación de nuevo préstamo
- cálculo financiero y metadata

## E) Dashboard / métricas
- capital activo
- capital pendiente
- interés
- cashflow
- mora
- riesgo

## F) Service worker / PWA
- caché
- shell
- notificaciones locales
- diferencias entre versión instalada y Netlify

---

# 7) QUÉ YA SE SABE DEL PROYECTO

## Etapas cerradas / bastante estables
- Etapa 1: Alertas internas
- Etapa 2: Estabilidad Firebase / Sync
- Etapa 3: Métricas financieras
- Etapa 5: Mejoras visuales / UX operativa
- gran parte de Etapa 7 (voz)
- Etapa 8 parcial / estable
- Etapa 9 en progreso

## Etapas con más cuidado histórico
- Etapa 6 PWA / cache
- Etapa 8 WhatsApp
- Etapa 9 seguridad / biometría / sesión

---

# 8) REGLAS PRÁCTICAS PARA CODEX DENTRO DE PRESTCONTROL

## Si algo funciona en una pantalla y falla en otra:
comparar ambos flujos y buscar si hay una implementación paralela.

## Si un cambio parece “misteriosamente ignorado”:
considerar:
- Netlify viejo
- service worker cacheado
- PWA instalada
- ruta inline distinta a la esperada
- archivo legacy no cargado

## Si un bug toca sesión / huella / WhatsApp / PWA:
no asumir; auditar el flujo real activo.

## Si una tarea es puntual:
no tocar métricas, sync, dashboard, voz o seguridad salvo que sea necesario y esté justificado.

---

# 9) ESTADO DOCUMENTAL ESPERADO

PrestControl trabaja con estos archivos de control:

## `ROADMAP_MAESTRO.md`
Estado vivo del proyecto.
Puede actualizarse automáticamente al cerrar una tarea.

## `CODEX_LOOP.md`
Método de trabajo de Codex.
No se modifica automáticamente.

## `CODEX_RULES.md`
Reglas permanentes del proyecto.
No se modifica automáticamente.

## `CODEX_CONTEXT.md`
Mapa técnico resumido del proyecto.
No se modifica automáticamente salvo aprobación del usuario.

---

# 10) CÓMO DEBE USARSE ESTE CONTEXTO

Cuando se le asigne una tarea a Codex:
1. leer `ROADMAP_MAESTRO.md`
2. respetar `CODEX_LOOP.md`
3. respetar `CODEX_RULES.md`
4. usar este `CODEX_CONTEXT.md` para entender rápido:
   - qué archivo puede estar activo
   - qué superficies son peligrosas
   - qué partes del sistema no conviene tocar

---

# 11) LÍMITES DE ESTE ARCHIVO

Este archivo:
- no reemplaza el análisis puntual de una tarea,
- no prueba qué ruta está cargada en este momento,
- no reemplaza una verificación real en navegador / celular,
- no autoriza cambios sobre etapas cerradas.

Su propósito es **dar contexto estable** y ahorrar tiempo/token.

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

CODEX_CONTEXT.md:
No debe modificarse automáticamente salvo aprobación del usuario.

Toda propuesta deberá ser aprobada por el usuario.
