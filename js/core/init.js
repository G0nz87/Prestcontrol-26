/* =====================================================
   INIT
===================================================== */
async function init() {
  // Bloquear pull-to-refresh del navegador en PWA
  let startY = 0;
  document.addEventListener('touchstart', e => { startY = e.touches[0].pageY; }, { passive: true });
  document.addEventListener('touchmove', e => {
    const dy = e.touches[0].pageY - startY;
    if (dy > 0 && window.scrollY === 0) e.preventDefault();
  }, { passive: false });

  _initFirebase();
  instalarPWA();
  await initGlobalDB();
  updateHdrDate();
  initNotificaciones();
  iniciarWatchdogInactividad();

  // Sincronizar al volver a la pestaña/app (cambio de dispositivo)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && appDesbloqueada && _fbUser) {
      drivePullAndMerge().then(() => {
        if (drivePendingSync) driveSave();
      });
    }
  });

  // Mostrar botón huella si hay credencial registrada
  actualizarBotonHuella();

  // Indicadores de conexión
  window.addEventListener('online',  () => driveSetStatus('ok', 'Conexión restaurada'));
  window.addEventListener('offline', () => driveSetStatus('err', 'Sin internet — modo offline'));

  setTimeout(() => {
    const savedUser = localStorage.getItem('rememberedEmail');
    const u = document.getElementById('login-email');
    const p = document.getElementById('login-pass');
    const chk = document.getElementById('remember-me');
    if (savedUser && u) {
      u.value = savedUser;
      if (chk) chk.checked = true;
      if (p) p.focus();
    } else if (u) {
      u.focus();
    }

    // Si no hay usuarios registrados → mostrar pestaña de registro
    (async () => {
      const todosUsuarios = await globalDbAll('usuarios').catch(() => []);
      const hayUsuarios = todosUsuarios.length > 0;
      if (!hayUsuarios) {
        showRegisterTab();
      }
      // Migrar admin/1234 si existe: forzar que vaya al first-run para cambiar credenciales
      const adminUser = await getUsuario('admin').catch(() => null);
      if (adminUser && adminUser.pass === '1234') {
        // Tiene la clave por defecto — marcar como firstRun para que cambie
        await setUsuario({ ...adminUser, firstRun: true });
      }
    })();
  }, 200);
}

async function autoUpdateEstados() {
  if (!DB) return;
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  for (const c of cuotas) {
    if (c.estado === 'Pagado') continue;
    const v = parseDate(c.fechaVenc); if (!v) continue;
    const diasAtr = Math.floor((hoy - v) / 86400000);
    const nuevoEst = diasAtr > 0 ? 'Atrasado' : 'Pendiente';
    if (c.estado !== nuevoEst) { c.estado = nuevoEst; await dbPut('cuotas', c); }
  }
  // Sync loan states
  const prestamos = await dbAll('prestamos');
  for (const p of prestamos) await syncEstadoPrestamo(p.id);
  await updateBadges();
}

// Actualizar estados automáticamente cada minuto mientras la app está abierta
setInterval(() => {
  if (appDesbloqueada && DB) autoUpdateEstados();
}, 60000);

init();
