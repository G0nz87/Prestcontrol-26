# PrestControl - Plan de evolución a RBAC Multi-Tenant con Permisos Granulares

**Documento de diseño para una futura actualización**
**Proyecto:** PrestControl
**Fecha:** 14/08/2026
**Estado:** Diseño propuesto - no implementar hasta cerrar y estabilizar PrestControl v1

---

## 1. Objetivo

Evolucionar PrestControl desde el modelo actual de **un usuario = una cartera** hacia una plataforma donde una misma organización, financiera o equipo pueda tener varios usuarios trabajando sobre la misma cartera, cada uno con permisos, responsabilidades y alcance de datos controlados.

La solución objetivo será:

> **Multi-tenant + RBAC + permisos granulares + alcance de datos + auditoría por usuario.**

Esto permitirá delegar PrestControl sin compartir contraseñas y sin perder control sobre qué puede ver, crear, modificar, cobrar, renovar, ejecutar o eliminar cada persona.

---

## 2. Caso de uso que debe resolver

Ejemplo de estructura:

- **Propietario / Dueño**
  - Control total de la organización.
  - Ve toda la cartera y todas las métricas.
  - Crea administradores y define permisos.

- **Administrador**
  - Puede tener varios operadores/cobradores a su cargo.
  - Puede administrar una sucursal, equipo o cartera asignada.
  - Sus permisos pueden ser menores que los del propietario.

- **Operador / Cobrador**
  - Ve solamente clientes o cuotas asignadas.
  - Puede registrar cobros si tiene permiso.
  - No necesariamente puede ver ganancias, capital global o datos sensibles.

- **Auditor / Solo lectura**
  - Puede consultar información autorizada.
  - No puede modificar datos.

La estructura debe permitir que un administrador tenga varios usuarios bajo su responsabilidad sin que esos usuarios puedan acceder automáticamente a toda la organización.

---

## 3. Principio clave: RBAC solo no alcanza

RBAC responde principalmente a:

> **¿Qué acciones puede realizar este usuario?**

PrestControl también necesita responder:

> **¿Sobre qué datos puede realizar esas acciones?**

Por eso el diseño recomendado combina tres conceptos:

1. **Rol** - define una base de permisos.
2. **Permisos granulares** - permiten habilitar o deshabilitar capacidades específicas.
3. **Scope / alcance de datos** - define qué registros puede ver o modificar el usuario.

Ejemplos de alcance:

- `own` - solo registros creados/asignados al usuario.
- `assigned` - clientes o préstamos específicamente asignados.
- `team` - registros del equipo administrado.
- `branch` - registros de una sucursal.
- `organization` - toda la organización.

Esto permite casos como:

> Rol: Cobrador
> Registrar cobros: SI
> Crear préstamos: NO
> Ver ganancias: NO
> Alcance: solo clientes asignados

---

## 4. Arquitectura actual y arquitectura objetivo

### Modelo actual simplificado

```text
users/{uid}/clientes
users/{uid}/prestamos
users/{uid}/cuotas
users/{uid}/prendas
```

Este modelo funciona bien para una cartera personal, pero hace difícil compartir la misma cartera de forma segura entre varios usuarios.

### Modelo objetivo recomendado

```text
organizations/{orgId}
  members/{uid}
  roles/{roleId}
  teams/{teamId}
  clientes/{clienteId}
  prestamos/{prestamoId}
  cuotas/{cuotaId}
  prendas/{prendaId}
  audit/{eventId}
  settings/{docId}
```

Cada organización es un **tenant** independiente.

Ejemplo:

```text
organizations/ORG-001
```

puede representar una financiera, negocio o unidad operativa completa.

Los datos operativos dejan de pertenecer al UID de una persona y pasan a pertenecer a una organización.

---

## 5. Modelo de organización

Documento sugerido:

```json
{
  "id": "ORG-001",
  "name": "PrestControl - Matias",
  "ownerUid": "UID_OWNER",
  "status": "active",
  "createdAt": "timestamp",
  "dataGeneration": 1
}
```

### `dataGeneration`

Este campo puede reutilizar la idea de `resetVersion/generationId` discutida para resets seguros.

Cuando una organización realiza un reset administrativo o una migración incompatible, se incrementa la generación. Un dispositivo con IndexedDB perteneciente a una generación anterior no debe volver a publicar datos obsoletos.

---

## 6. Modelo de miembro

Ruta:

```text
organizations/{orgId}/members/{uid}
```

Ejemplo:

```json
{
  "uid": "UID_USER",
  "email": "usuario@ejemplo.com",
  "displayName": "Juan Perez",
  "roleId": "collector",
  "status": "active",
  "managerUid": "UID_ADMIN",
  "teamId": "TEAM-01",
  "branchId": "BRANCH-01",
  "scope": "assigned",
  "permissionOverrides": {
    "loans.create": false,
    "payments.register": true
  },
  "createdAt": "timestamp",
  "createdBy": "UID_OWNER"
}
```

### Importante

Cada persona debe tener **su propia cuenta Firebase Authentication**.

Nunca se debe delegar PrestControl compartiendo la contraseña del propietario o del administrador.

---

## 7. Modelo de roles

Ruta sugerida:

```text
organizations/{orgId}/roles/{roleId}
```

Roles iniciales recomendados:

- `owner`
- `admin`
- `operator`
- `collector`
- `auditor`
- `readonly`

Los roles son plantillas. Los permisos individuales pueden sobreescribir la plantilla cuando sea necesario.

---

## 8. Catálogo inicial de permisos

### Usuarios y administración

```text
users.view
users.create
users.edit
users.disable
users.delete
users.assign
roles.view
roles.manage
permissions.manage
```

### Clientes

```text
clients.view
clients.create
clients.edit
clients.delete
clients.assign
```

### Préstamos

```text
loans.view
loans.create
loans.edit
loans.delete
loans.renew
loans.execute
loans.assign
```

### Cobros

```text
payments.view
payments.register
payments.bulk_register
payments.reverse
payments.edit_method
```

### Garantías / prendas

```text
collateral.view
collateral.create
collateral.edit
collateral.delete
collateral.execute
collateral.publish
collateral.sell
```

### Dashboard y métricas

```text
dashboard.view
dashboard.view_global
dashboard.view_financials
dashboard.view_profit
dashboard.view_collateral_result
reports.view
reports.export
```

### Historial y auditoría

```text
history.view
audit.view
audit.export
```

### Backup y operaciones sensibles

```text
backup.create
backup.restore
user.reset
organization.reset
settings.manage
security.manage
```

---

## 9. Matriz sugerida de roles

| Capacidad | Owner | Admin | Operador | Cobrador | Auditor |
|---|---:|---:|---:|---:|---:|
| Ver clientes | Si | Si | Si | Asignados | Si |
| Crear clientes | Si | Si | Si | Opcional | No |
| Crear préstamos | Si | Si | Opcional | No | No |
| Editar préstamos | Si | Si | Opcional | No | No |
| Eliminar préstamos | Si | Opcional | No | No | No |
| Renovar préstamos | Si | Si | Opcional | No | No |
| Ejecutar préstamos | Si | Opcional | No | No | No |
| Registrar cobros | Si | Si | Si | Si | No |
| Ver ganancias | Si | Opcional | No | No | Si/No |
| Vender prendas | Si | Opcional | No | No | No |
| Gestionar usuarios | Si | Si limitado | No | No | No |
| Backup/Restore | Si | Opcional | No | No | No |
| Auditoría | Si | Si | Limitada | Propia | Si |

**Nota:** esta tabla es una configuración inicial, no una restricción rígida. El propietario debe poder personalizar permisos.

---

## 10. Alcance de datos y jerarquía

Para representar que un administrador tenga varios usuarios a su cargo, se recomienda incorporar **equipos** y/o `managerUid`.

Ejemplo:

```text
TEAM-01
  Manager: Admin A
  Miembros:
    - Cobrador 1
    - Cobrador 2
    - Operador 1
```

El administrador puede tener alcance `team` y visualizar los datos de los miembros de su equipo.

Un cobrador puede tener alcance `assigned` y ver solamente sus clientes asignados.

### Campos operativos recomendados

En clientes/préstamos/cuotas puede agregarse, según necesidad:

```text
assignedToUid
teamId
branchId
createdByUid
updatedByUid
```

No agregar campos redundantes si una relación puede derivarse de otra de forma segura.

---

## 11. Seguridad Firebase: requisito no negociable

**Ocultar botones no es seguridad.**

Toda restricción importante debe existir también en Firestore Rules.

Ejemplo conceptual:

```text
allow update: if
  isMember(orgId) &&
  hasPermission(orgId, "payments.register") &&
  canAccessRecord(orgId, resource.data);
```

Las reglas deben validar:

- pertenencia a la organización;
- miembro activo;
- permiso requerido;
- alcance del usuario;
- integridad de campos críticos;
- operaciones sensibles;
- aislamiento completo entre organizaciones.

Un usuario de `ORG-001` no debe poder leer ni escribir ningún dato de `ORG-002` aunque conozca IDs o intente llamadas directas a Firestore.

---

## 12. Permisos UI vs permisos reales

PrestControl debe aplicar permisos en dos capas:

### Capa 1 - Interfaz

Si el usuario no tiene permiso:

- ocultar o deshabilitar botón;
- evitar mostrar información sensible;
- explicar cuando una función requiere autorización.

### Capa 2 - Firebase Rules

La escritura o lectura debe ser rechazada aunque el usuario intente saltarse la interfaz.

**La capa de Firebase es la autoridad final.**

---

## 13. Auditoría obligatoria en multiusuario

Cada operación relevante debe registrar quién la realizó.

Campos recomendados:

```text
createdByUid
updatedByUid
paidByUid
renewedByUid
executedByUid
soldByUid
operationId
deviceId
createdAt
updatedAt
```

El historial administrativo debe poder responder:

- ¿Quién creó este préstamo?
- ¿Quién cobró esta cuota?
- ¿Quién modificó el método de pago?
- ¿Quién renovó el préstamo?
- ¿Quién ejecutó la garantía?
- ¿Quién vendió la prenda?
- ¿Quién eliminó o restauró información?

Para operaciones sensibles también conviene guardar:

```text
oldValue
newValue
reason
approvedByUid
```

---

## 14. Acciones que pueden requerir aprobación

PrestControl puede evolucionar después a un esquema de autorización en dos pasos.

Ejemplos:

- bonificación de cuota;
- eliminación de préstamo;
- reversión de pago;
- ejecución de garantía;
- venta por debajo del valor mínimo;
- reset de usuario;
- restauración de backup;
- cambio de tasa fuera de límites.

Ejemplo:

> Cobrador solicita bonificación -> Administrador aprueba -> sistema registra ambos usuarios.

No es obligatorio para la primera versión RBAC, pero la arquitectura no debe impedirlo.

---

## 15. Impacto sobre IndexedDB y funcionamiento offline

Este es uno de los puntos más delicados de la actualización.

Actualmente la base local se organiza alrededor del usuario. En multi-tenant debe quedar vinculada también a la organización.

Nombre sugerido:

```text
PrestamosApp_{orgId}_{uid}
```

o una base por organización con metadatos seguros de miembro.

### Requisitos offline

- guardar `orgId` en cada operación en cola;
- nunca sincronizar una operación hacia otra organización;
- verificar membresía al recuperar conexión;
- invalidar datos locales si el usuario fue deshabilitado;
- invalidar datos locales si cambia `dataGeneration`;
- respetar permisos actuales al volver online;
- no permitir que permisos antiguos guardados en caché autoricen operaciones nuevas.

### Caso crítico

Un cobrador registra una operación offline. Mientras está desconectado, un administrador le revoca el permiso.

Al reconectar:

- Firebase Rules debe rechazar la operación si ya no está autorizada;
- PrestControl debe conservar el evento como rechazado/conflicto y no perderlo silenciosamente;
- debe mostrarse al administrador para resolución si corresponde.

---

## 16. Cambios en `sync_queue`

Cada operación deberá contener como mínimo:

```json
{
  "orgId": "ORG-001",
  "uid": "UID_USER",
  "entity": "cuotas",
  "recordId": "C-001",
  "operation": "update",
  "operationId": "...",
  "createdAt": "..."
}
```

Opcionalmente:

```text
requiredPermission
scopeSnapshot
```

El permiso nunca debe confiarse solamente al snapshot local; Firestore debe volver a validarlo.

---

## 17. Dashboard multiusuario

El Dashboard debe soportar distintos niveles de visibilidad.

Ejemplos:

### Owner

- cartera total;
- ganancia total;
- resultado por garantías;
- cobros por usuario;
- atrasos por equipo;
- flujo completo.

### Admin

- organización completa o solo su equipo, según scope.

### Cobrador

- cobros del día asignados;
- atrasos asignados;
- clientes a visitar;
- sin mostrar necesariamente capital global o ganancias.

### Auditor

- métricas permitidas en solo lectura.

---

## 18. Métricas por usuario y equipo

Una vez que las operaciones registran autor, PrestControl podrá calcular:

- monto cobrado por cobrador;
- cantidad de pagos registrados;
- cartera originada por operador;
- mora de clientes asignados;
- recuperaciones por equipo;
- ejecuciones autorizadas;
- ventas de garantías;
- productividad por período.

Estas métricas deben diferenciar **quién es responsable del cliente** de **quién ejecutó una operación puntual**.

---

## 19. Flujo de alta de usuarios

Recomendación:

1. Owner/Admin crea invitación.
2. Se define rol inicial y alcance.
3. Usuario recibe invitación.
4. Usuario crea/inicia su propia cuenta Firebase Authentication.
5. Se vincula su UID a `organizations/{orgId}/members/{uid}`.
6. El usuario entra únicamente a la organización autorizada.

No guardar contraseñas de empleados en Firestore o IndexedDB.

---

## 20. Multi-organización futura

La arquitectura debe permitir que un mismo UID pueda pertenecer a más de una organización.

Ejemplo:

- Usuario trabaja en Financiera A.
- También tiene acceso de auditor a Financiera B.

Al iniciar sesión, PrestControl puede mostrar:

> Seleccionar organización

Esto no es necesario para la primera versión, pero el modelo de membresía debe evitar bloquear esta posibilidad.

---

## 21. Migración de PrestControl actual

La migración no debe hacerse directamente sobre producción sin una fase de compatibilidad y backup.

### Situación actual

Los datos pertenecen a:

```text
users/{uid}/...
```

### Objetivo

Moverlos a:

```text
organizations/{orgId}/...
```

### Estrategia recomendada

1. Cerrar PrestControl v1 estable.
2. Crear backup completo verificado.
3. Crear organización para el propietario actual.
4. Crear membresía owner.
5. Copiar datos a estructura `organizations`.
6. Validar conteos y hashes/consistencia.
7. Mantener temporalmente datos antiguos en modo read-only o backup.
8. Actualizar cliente web para trabajar por `orgId`.
9. Actualizar reglas Firebase.
10. Probar con usuario secundario de prueba.
11. Probar offline/online.
12. Recién después retirar la estructura anterior.

Nunca eliminar la estructura antigua hasta tener validación completa del nuevo modelo.

---

## 22. Plan de implementación por etapas

### RBAC-0 - Auditoría y congelamiento

- Cerrar PrestControl v1.
- Backup completo.
- Documentar stores, colecciones y reglas actuales.
- Congelar cambios funcionales grandes durante la migración.

### RBAC-1 - Organización y membresía

- Crear `organizations`.
- Crear `members`.
- Propietario actual pasa a ser `owner`.
- Sin cambiar todavía la lógica operativa.

### RBAC-2 - Roles y motor de permisos

- Catálogo de permisos.
- Roles predeterminados.
- Función central `hasPermission()`.
- Overrides individuales.

### RBAC-3 - Alcance de datos

- `own`, `assigned`, `team`, `organization`.
- Equipos y manager.
- Asignación de clientes/préstamos.

### RBAC-4 - UI condicionada

- Navegación según permisos.
- Botones/acciones condicionados.
- Ocultar métricas sensibles.
- Mensajes de acceso denegado.

### RBAC-5 - Firestore Rules

- Aislamiento tenant.
- Validación de membresía.
- Validación de permisos.
- Validación de scope.
- Pruebas negativas obligatorias.

### RBAC-6 - Auditoría por usuario

- `createdBy`, `paidBy`, `renewedBy`, etc.
- Audit log.
- Historial administrativo.

### RBAC-7 - IndexedDB y Sync multi-tenant

- `orgId` en contexto local.
- `orgId` en cola.
- revocación de permisos;
- dataGeneration;
- conflictos offline.

### RBAC-8 - Migración de datos existentes

- Crear ORG del propietario.
- Migrar clientes/préstamos/cuotas/prendas.
- Verificar integridad.
- Rollback disponible.

### RBAC-9 - Administración de usuarios

- Pantalla Usuarios.
- Roles.
- Permisos.
- Equipos.
- Asignaciones.
- Activar/desactivar usuario.

### RBAC-10 - Pruebas y despliegue

- Owner.
- Admin.
- Cobrador.
- Auditor.
- PC/celular.
- Offline/online.
- revocación de permisos;
- pruebas entre tenants;
- backup/restore.

---

## 23. Casos de prueba obligatorios

### Aislamiento

- Usuario ORG-A intenta leer ORG-B -> DENEGADO.
- Usuario ORG-A intenta modificar ORG-B -> DENEGADO.

### Roles

- Cobrador sin `loans.create` intenta crear préstamo -> DENEGADO.
- Auditor intenta registrar pago -> DENEGADO.
- Admin autorizado registra pago -> OK.

### Alcance

- Cobrador 1 no ve clientes de Cobrador 2 si scope=`assigned`.
- Admin del Team A ve miembros del Team A, no del Team B si scope=`team`.

### UI + backend

- Botón oculto si no hay permiso.
- Llamada manual a Firestore también rechazada.

### Offline

- Usuario crea pago offline con permiso válido -> sincroniza.
- Permiso revocado antes de reconectar -> Firebase rechaza; app reporta conflicto.

### Auditoría

- Cada cobro identifica `paidByUid`.
- Cada renovación identifica `renewedByUid`.
- Cada venta identifica `soldByUid`.

### Reset

- Reset incrementa `dataGeneration`.
- Dispositivo viejo no repuebla datos borrados.

---

## 24. Reglas de diseño no negociables

1. **Cada empleado usa su propia cuenta.**
2. **No compartir contraseñas.**
3. **No confiar en botones ocultos como seguridad.**
4. **Firestore Rules debe validar permisos.**
5. **Todo documento operativo pertenece a un `orgId`.**
6. **Todo cambio importante registra autor.**
7. **Permisos y scope se verifican de nuevo al sincronizar.**
8. **Un tenant nunca puede acceder a otro tenant.**
9. **La migración debe tener backup y rollback.**
10. **No romper el funcionamiento offline existente sin una estrategia explícita.**
11. **No borrar datos antiguos hasta validar la migración.**
12. **Operaciones destructivas requieren reautenticación y confirmación.**

---

## 25. Mejoras relacionadas que conviene aprovechar

La evolución RBAC es un buen momento para incorporar posteriormente:

- Reset administrativo seguro con `dataGeneration`.
- Cambio de usuario desde pantalla bloqueada.
- Bonificaciones con autorización.
- Reversión de pagos con permiso especial.
- Aprobación de ventas de garantías por debajo de mínimo.
- Métrica separada de **Resultado por garantías vendidas**.
- Estado visual **Vendida** en verde.
- Auditoría automática de integridad.
- Sucursales.
- Equipos de cobranza.
- Caja por empleado.
- Reportes por usuario.

---

## 26. Decisiones que deben tomarse antes de implementar

Antes de comenzar la actualización se debe definir:

1. ¿Una organización puede tener varias sucursales desde la primera versión?
2. ¿Los clientes se asignan a una persona, un equipo o ambos?
3. ¿Un administrador ve siempre a todos sus subordinados?
4. ¿Qué métricas se consideran sensibles?
5. ¿Quién puede ver ganancias?
6. ¿Quién puede borrar o revertir pagos?
7. ¿Se permitirá que un usuario pertenezca a varias organizaciones desde el inicio?
8. ¿Se necesitan aprobaciones en dos pasos en la primera versión?
9. ¿Qué operaciones offline se permiten a roles limitados?
10. ¿Qué debe pasar con operaciones offline si el permiso fue revocado?

---

## 27. Criterios para considerar terminada la actualización

La actualización RBAC Multi-Tenant se considerará terminada solamente si:

- la cartera existente fue migrada sin pérdida;
- owner conserva control completo;
- admin puede gestionar usuarios dentro de su alcance;
- permisos granulares funcionan en UI y Firebase;
- cobradores solo acceden a datos permitidos;
- dos organizaciones están completamente aisladas;
- todas las acciones sensibles quedan auditadas;
- PC y celular sincronizan respetando `orgId`;
- offline/online respeta permisos actuales;
- backup y restore funcionan con organización y miembros;
- reset no permite resurrección desde dispositivos viejos;
- las reglas Firebase tienen pruebas positivas y negativas;
- existe rollback documentado.

---

## 28. Recomendación de implementación para PrestControl

**No implementar esta actualización en medio de las pruebas finales actuales.**

Orden recomendado:

1. Terminar PrestControl v1.
2. Completar pruebas PC/celular/offline/backup.
3. Hacer un único cierre estable de la versión actual.
4. Crear una rama/etapa dedicada para RBAC Multi-Tenant.
5. Usar este documento como especificación base.
6. Implementar por fases pequeñas y verificables.

La migración a multiusuario debe tratarse como una **evolución de arquitectura**, no como un simple agregado de botones o roles.

---

## 29. Resumen ejecutivo

La solución recomendada para delegar PrestControl es:

> **Organización (tenant) -> Miembros -> Roles -> Permisos granulares -> Alcance de datos -> Auditoría.**

Esto permite que un propietario delegue operaciones a administradores, operadores y cobradores sin perder control ni privacidad.

La arquitectura debe asegurar que:

- los datos pertenecen a la organización, no a una persona;
- cada usuario tiene cuenta propia;
- los permisos se controlan en UI y Firebase;
- el alcance limita qué cartera puede ver cada miembro;
- cada operación queda atribuida a una persona;
- el sistema offline no puede saltarse permisos ni revivir datos antiguos.

Con esta evolución, PrestControl pasa de ser una herramienta personal a una plataforma preparada para equipos, sucursales y eventualmente comercialización a otras financieras.

---

**Nombre sugerido de la futura etapa:**
### PrestControl Multiusuario - RBAC Multi-Tenant y Permisos Granulares

**Estado actual:** PLANIFICADO / NO INICIADO
