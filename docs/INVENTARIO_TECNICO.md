# INVENTARIO TÉCNICO — PRESTCONTROL

**Estado:** Etapa 10.3 — legacy aislado de forma reversible
**Objetivo:** identificar código activo, código legacy probable y zonas sensibles antes de ordenar archivos.  
**Regla:** este inventario no autoriza borrar, mover ni refactorizar código sin aprobación explícita.

**Actualización 10.3:** los archivos legacy confirmados fueron movidos, sin eliminarse, desde `js/` hacia `legacy/js/`, conservando la estructura interna.

---

## 1. Código activo cargado por index.html

`index.html` es el archivo principal activo de la aplicación.

Scripts externos cargados:

- Chart.js
- jsPDF
- xlsx
- Firebase compat:
  - firebase-app-compat
  - firebase-auth-compat
  - firebase-firestore-compat

Archivos locales cargados directamente:

- `core/firebase.js`
- `repositories/index.js`
- `services/index.js`
- `ui/index.js`

También existe un script inline grande dentro de `index.html`, que contiene gran parte de la lógica activa de la app.

---

## 2. Módulos activos importados por esos archivos

### core/

- `core/firebase.js`
  - Inicialización Firebase web.
  - Expone configuración y referencias Firebase al entorno global.

### repositories/

- `repositories/index.js`
  - Importa:
    - `repositories/ClienteRepository.js`
    - `repositories/PrestamoRepository.js`

- `repositories/ClienteRepository.js`
  - Importa:
    - `repositories/Repository.js`

- `repositories/PrestamoRepository.js`
  - Importa:
    - `repositories/Repository.js`

- `repositories/Repository.js`
  - Clase base de repositorio.

### services/

- `services/index.js`
  - Importa:
    - `services/ClienteService.js`
    - `services/PrestamoService.js`
    - `services/AuthService.js`
    - `services/MetricasFinancierasService.js`
    - repositorios desde `repositories/index.js`

- `services/ClienteService.js`
- `services/PrestamoService.js`
- `services/AuthService.js`
- `services/MetricasFinancierasService.js`

### ui/

- `ui/index.js`
  - Importa:
    - `ui/clientes.js`
    - `ui/prestamos.js`

- `ui/clientes.js`
  - Funciones activas relacionadas a clientes.

- `ui/prestamos.js`
  - Funciones activas relacionadas a préstamos, renovación y eliminación.

---

## 3. Código legacy aislado no cargado directamente

El directorio `js/` no aparecía cargado directamente desde `index.html`.

En Etapa 10.3 estos archivos fueron aislados de forma reversible en `legacy/js/`.

Archivos legacy aislados:

### js/auth/

- `legacy/js/auth/auth.js`
- `legacy/js/auth/first-run.js`
- `legacy/js/auth/user-menu.js`
- `legacy/js/auth/webauthn.js`

### js/core/

- `legacy/js/core/bloqueo.js`
- `legacy/js/core/init.js`
- `legacy/js/core/pwa.js`
- `legacy/js/core/utils.js`

### js/db/

- `legacy/js/db/admin.js`
- `legacy/js/db/database.js`

### js/firebase/

- `legacy/js/firebase/firebase.js`

### js/modules/

- `legacy/js/modules/backup.js`
- `legacy/js/modules/bitacora.js`
- `legacy/js/modules/calendario.js`
- `legacy/js/modules/clientes.js`
- `legacy/js/modules/excel.js`
- `legacy/js/modules/graficos.js`
- `legacy/js/modules/historial.js`
- `legacy/js/modules/notificaciones.js`
- `legacy/js/modules/pdf.js`
- `legacy/js/modules/prestamos.js`
- `legacy/js/modules/whatsapp.js`

### js/ui/

- `legacy/js/ui/badges.js`
- `legacy/js/ui/navigation.js`
- `legacy/js/ui/render.js`

### Otros

- `legacy/js/globals.js`
- `css/styles.css`

`css/styles.css` existe, pero no se detectó carga directa desde `index.html`.

---

## 4. Duplicados peligrosos detectados

Estos duplicados no deben eliminarse sin verificación manual previa.

### Firebase

Activo:

- `core/firebase.js`

Legacy probable:

- `js/firebase/firebase.js`

Riesgo:

- Doble configuración Firebase.
- Confusión sobre qué inicialización es la real.

### Auth / login

Activo:

- lógica inline en `index.html`
- `services/AuthService.js`

Legacy probable:

- `js/auth/auth.js`

Riesgo:

- Fallbacks viejos o rutas antiguas de login.
- Posibles diferencias entre login real y login legacy.

### Biometría / WebAuthn

Activo actual:

- biometría desactivada mediante stubs/bloqueos seguros.

Legacy probable:

- `js/auth/webauthn.js`

Riesgo:

- No reactivar.
- No volver a invocar WebAuthn.
- No restaurar botones de huella.

### Render / navegación

Activo:

- `renderPage()` y `goPage()` en `index.html`

Legacy probable:

- `js/ui/render.js`
- `js/ui/navigation.js`

Riesgo:

- Tocar el render equivocado no cambia la app.
- Eliminar sin revisar puede romper referencias futuras.

### WhatsApp

Activo:

- lógica central en `index.html`, incluyendo:
  - `normalizarTelefonoWA`
  - `abrirWhatsAppSeguro`
  - `enviarWACuota`

Legacy probable:

- `js/modules/whatsapp.js`

Riesgo:

- WhatsApp fue una zona sensible.
- No tocar sin etapa específica.

### Backup

Activo:

- `exportarBackup()` en `index.html`
- `importarBackup(input)` en `index.html`

Legacy probable:

- `js/modules/backup.js`

Riesgo:

- Exportación contiene datos sensibles.
- La importación JSON actual funciona como mezcla/merge: conserva datos actuales, agrega registros faltantes y actualiza coincidencias por ID.
- La importación JSON actual no restaura la app completa.
- Restauración completa de backup queda planificada como Etapa 11.1.
- No modificar sin etapa propia.

### Notificaciones / PWA

Activo:

- `sw.js`
- `manifest.webmanifest`
- registro desde `index.html`

Legacy probable:

- `js/core/pwa.js`
- partes blob/dinámicas antiguas dentro de código no activo.

Riesgo:

- Cache local puede confundir pruebas.
- No tocar en orden técnico inicial.

---

## 5. Zonas sensibles que no se deben tocar

No tocar sin etapa explícita:

- pagos
- cuotas
- préstamos
- clientes
- renovación
- comprobantes
- WhatsApp
- métricas
- backup/exportación
- PWA/service worker
- Firebase/Auth/sync
- Firestore rules
- IndexedDB schema
- biometría/WebAuthn

---

## 6. Archivos aislados en legacy/js/

Movidos de forma reversible en Etapa 10.3:

- `legacy/js/auth/auth.js`
- `legacy/js/auth/first-run.js`
- `legacy/js/auth/user-menu.js`
- `legacy/js/auth/webauthn.js`
- `legacy/js/core/bloqueo.js`
- `legacy/js/core/init.js`
- `legacy/js/core/pwa.js`
- `legacy/js/core/utils.js`
- `legacy/js/db/admin.js`
- `legacy/js/db/database.js`
- `legacy/js/firebase/firebase.js`
- `legacy/js/modules/backup.js`
- `legacy/js/modules/bitacora.js`
- `legacy/js/modules/calendario.js`
- `legacy/js/modules/clientes.js`
- `legacy/js/modules/excel.js`
- `legacy/js/modules/graficos.js`
- `legacy/js/modules/historial.js`
- `legacy/js/modules/notificaciones.js`
- `legacy/js/modules/pdf.js`
- `legacy/js/modules/prestamos.js`
- `legacy/js/modules/whatsapp.js`
- `legacy/js/ui/badges.js`
- `legacy/js/ui/navigation.js`
- `legacy/js/ui/render.js`
- `legacy/js/globals.js`
- `css/styles.css`

Antes de moverlos, verificar:

1. que no estén importados por HTML, service worker o módulos activos;
2. que no estén referenciados por documentación operativa;
3. que la app local siga cargando con `npx serve .`;
4. que PC y celular sigan funcionando.

---

## 7. Archivos que NO deben eliminarse

No eliminar:

- `index.html`
- `core/firebase.js`
- `repositories/index.js`
- `repositories/Repository.js`
- `repositories/ClienteRepository.js`
- `repositories/PrestamoRepository.js`
- `services/index.js`
- `services/AuthService.js`
- `services/ClienteService.js`
- `services/PrestamoService.js`
- `services/MetricasFinancierasService.js`
- `ui/index.js`
- `ui/clientes.js`
- `ui/prestamos.js`
- `sw.js`
- `manifest.webmanifest`
- `icons/icon-192.png`
- `icons/icon-512.png`
- `firebase.json`
- `firestore.rules`
- `docs/CODEX_CONTEXT.md`
- `docs/CODEX_RULES.md`
- `docs/CODEX_LOOP.md`
- `docs/ROADMAP_MAESTRO.md`

---

## 8. Documentación pendiente

Estado detectado antes de Etapa 10.2:

- `docs/ROADMAP_MAESTRO.md` está modificado.
- `docs/Historial/ROADMAP_MAESTRO2.md` está sin seguimiento.
- `docs/CODEX_CONTEXT.md` está versionado.
- `docs/CODEX_RULES.md` está versionado.
- `docs/CODEX_LOOP.md` está versionado y no debe modificarse automáticamente.

Recomendación:

- resolver primero el estado documental antes de mover código;
- no mezclar cambios documentales con cambios técnicos;
- evitar `git add .`.

---

## 9. Plan seguro para Etapa 10.2

Propuesta mínima:

1. Mantener el inventario como referencia.
2. Confirmar con búsqueda que `js/` no está cargado por `index.html`.
3. Confirmar que `sw.js` no cachea archivos de `js/`.
4. No borrar archivos todavía.
5. Crear, si se aprueba, una carpeta `legacy/` o `docs/legacy/` con criterio claro.
6. Mover primero solo archivos 100% no cargados.
7. Probar local:
   - abrir app con sesión activa;
   - login normal;
   - dashboard;
   - clientes;
   - préstamos;
   - cuotas;
   - cobros;
   - backup;
   - WhatsApp manual;
   - PWA básica si corresponde.
8. Hacer commit separado y reversible.

---

## 10. Estado

PENDIENTE — inventario propuesto, esperando aprobación para crear `docs/INVENTARIO_TECNICO.md`.

---

# Reglas de la Etapa 10

1. Ningún archivo podrá eliminarse únicamente por no estar cargado.
2. Todo archivo legacy deberá clasificarse primero.
3. Todo movimiento deberá realizarse en una subetapa independiente.
4. Toda eliminación requerirá validación local PC + celular.
5. No modificar index.html durante 10.1.
6. No tocar biometría.
7. No tocar WhatsApp.
8. No tocar Firebase.
9. No tocar PWA.
10. Mantener siempre un working tree limpio antes de iniciar cada subetapa.

---

# Etapa 11 planificada — Backup y restauración profesional

La restauración completa de backups JSON no se implementa dentro de Etapa 10.
Queda planificada como una etapa funcional separada para evitar mezclar orden técnico con cambios de datos sensibles.

## 11.1 — Importar y mezclar JSON

**Estado:** existente como flujo actual aclarado.

- Conserva los datos actuales.
- Agrega registros faltantes.
- Actualiza coincidencias por ID según la regla actual.
- No restaura la app completa.
- No debe confundirse con restauración total.

## 11.2 — Restaurar backup completo local

**Estado:** pendiente.

- Debe reemplazar localmente los datos actuales por los datos del backup.
- Debe restaurar:
  - clientes;
  - préstamos;
  - cuotas;
  - bitácora, si está disponible en el backup.
- No debe restaurar:
  - contraseñas;
  - PIN;
  - tokens;
  - biometría;
  - sync interno.
- No debe usar `dbPut()` para la restauración completa porque modifica `updatedAt`.
- Debe usar un helper raw tipo `dbPutRaw()` para preservar IDs, timestamps y contenido del backup.
- Debe exigir confirmación escrita `RESTAURAR`.
- Debe advertir que se reemplazarán los datos locales actuales.
- No debe subir automáticamente a Firebase.

## 11.3 — Sincronizar restauración con Firebase

**Estado:** pendiente futuro.

- Debe ser una acción separada de la restauración local.
- No debe ejecutarse automáticamente.
- Debe requerir confirmación explícita.
- Debe resolver cuidadosamente altas, modificaciones y eliminaciones remotas.

## 11.4 — Comparador / previsualización avanzada de backups

**Estado:** pendiente.

- Comparar datos actuales contra datos del backup antes de aplicar cambios.
- Mostrar cantidades de clientes, préstamos, cuotas y bitácora.
- Detectar posibles duplicados o diferencias relevantes.
- Permitir decidir con información clara antes de importar o restaurar.

## 11.5 — Historial de backups

**Estado:** pendiente.

- Registrar fecha/hora de backups generados o restaurados.
- Mostrar historial operativo de respaldos.
- Mantener trazabilidad sin guardar contraseñas, tokens, PIN, biometría ni sync interno.
