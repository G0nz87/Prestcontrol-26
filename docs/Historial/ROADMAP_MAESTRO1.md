# ROADMAP MAESTRO — PRESTCONTROL

**Proyecto:** PrestControl  
**Stack:** Netlify + Firebase + GitHub + IndexedDB  
**Última actualización:** 20/06/2026  
**Estado general:** Etapa 5 en progreso

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

**Estado:** EN PROGRESO  
**Etapa actual.**

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

# ETAPA 6 — NOTIFICACIONES PWA

**Estado:** PENDIENTE

---

# ETAPA 7 — COMANDOS POR VOZ

**Estado:** PENDIENTE

---

# ETAPA 8 — WHATSAPP / COBRANZA

**Estado:** PENDIENTE

---

# ETAPA 9 — SEGURIDAD AVANZADA

**Estado:** PENDIENTE

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

**Etapa actual:** ETAPA 5 — Mejoras visuales / UX operativa  
**Bloque cerrado:** 5.5 UX de Préstamos + Renovación Fase 1  
**Próximo bloque recomendado:** Comprobantes profesionales imprimibles

---

# COMMIT SUGERIDO PARA EL BLOQUE CERRADO

```bash
git add index.html ui/index.js ui/prestamos.js
git commit -m "Agrega renovacion fase 1 y mejoras UX prestamos"
git push origin main
git status
```

No usar `git add .` si hay documentos o archivos no relacionados pendientes.
