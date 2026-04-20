/* =====================================================
   AUTH — MULTI-USUARIO (credenciales en GLOBAL_DB)
===================================================== */
const DEFAULT_USER   = 'admin';
const DEFAULT_PASS   = '1234';
const DEFAULT_MASTER = 'master1234';

// Lee un usuario de la DB global
async function getUsuario(username) {
  return await globalDbGet('usuarios', username);
}

// Guarda / actualiza un usuario en la DB global
async function setUsuario(obj) {
  await globalDbPut('usuarios', obj);
}

// Devuelve las credenciales del usuario activo (o defaults)
async function authGetCred() {
  if (currentUser) {
    const u = await getUsuario(currentUser);
    if (u) return { user: u.username, pass: u.pass };
  }
  // fallback: primer usuario que exista, o defaults
  const todos = await globalDbAll('usuarios');
  if (todos.length) return { user: todos[0].username, pass: todos[0].pass };
  return { user: DEFAULT_USER, pass: DEFAULT_PASS };
}

async function authGetMaster() {
  const m = await getGlobalConfig('master_pass');
  return m || DEFAULT_MASTER;
}

// ── TABS LOGIN/REGISTRO ──────────────────────────────
function showLoginTab() {
  document.getElementById('panel-login').style.display   = '';
  document.getElementById('panel-register').style.display = 'none';
  document.getElementById('tab-login').style.background   = 'var(--accent)';
  document.getElementById('tab-login').style.color        = '#fff';
  document.getElementById('tab-register').style.background = 'transparent';
  document.getElementById('tab-register').style.color     = 'var(--muted)';
  document.getElementById('login-email')?.focus();
}

function showRegisterTab() {
  document.getElementById('panel-login').style.display    = 'none';
  document.getElementById('panel-register').style.display = '';
  document.getElementById('tab-register').style.background = 'var(--accent)';
  document.getElementById('tab-register').style.color     = '#fff';
  document.getElementById('tab-login').style.background   = 'transparent';
  document.getElementById('tab-login').style.color        = 'var(--muted)';
  document.getElementById('reg-nombre')?.focus();
}

// ── CREAR CUENTA NUEVA ───────────────────────────────
async function doRegistro() {
  const nombre  = document.getElementById('reg-nombre')?.value.trim() || '';
  const email   = document.getElementById('reg-email')?.value.trim().toLowerCase() || '';
  const newPass = document.getElementById('reg-pass').value;
  const newPass2= document.getElementById('reg-pass2').value;
  const errEl   = document.getElementById('reg-err');
  const btnReg  = document.getElementById('btn-registro');

  const showErr = (msg) => { errEl.textContent = msg; errEl.classList.add('on'); };
  errEl.classList.remove('on');

  if (!nombre || nombre.length < 2)      return showErr('Ingresá tu nombre (mínimo 2 caracteres)');
  if (!email || !email.includes('@'))    return showErr('Ingresá un email válido');
  if (!newPass || newPass.length < 6)    return showErr('La contraseña debe tener al menos 6 caracteres');
  if (newPass !== newPass2)              return showErr('Las contraseñas no coinciden');

  if (!_fbAuth && !_initFirebase()) {
    return showErr('Sin conexión al servidor. Verificá tu internet.');
  }

  btnReg.disabled = true; btnReg.textContent = '⏳ Creando cuenta...';

  try {
    const cred = await _fbAuth.createUserWithEmailAndPassword(email, newPass);
    await cred.user.updateProfile({ displayName: nombre });
    _fbUser = cred.user;

    // Guardar perfil en Firestore
    await _fbDb.collection('users').doc(cred.user.uid).set({
      nombre, email,
      activo: true,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Guardar en cache local con el nombre como clave
    await setUsuario({ username: nombre, email, uid: cred.user.uid, firstRun: false, creadoEn: new Date().toISOString() });

    if (document.getElementById('remember-me')?.checked) {
      localStorage.setItem('rememberedEmail', email);
    }

    await _entrarALaApp(nombre, newPass, { firstRun: false });
    toast('🎉 ¡Bienvenido/a, ' + nombre + '!');

  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Ese email ya tiene una cuenta. Usá "Ingresar".',
      'auth/invalid-email':        'El email no es válido.',
      'auth/weak-password':        'La contraseña es muy débil.',
    };
    showErr(msgs[e.code] || 'Error: ' + e.message);
  } finally {
    btnReg.disabled = false; btnReg.textContent = '✨ Crear mi cuenta';
  }
}

// Crea el usuario en IndexedDB y entra a la app (compatibilidad)
async function _crearUsuarioLocal(username, password, masterPass) {
  const btnReg = document.getElementById('btn-registro');
  try {
    await setUsuario({ username, pass: password, firstRun: false, creadoEn: new Date().toISOString() });
    await _entrarALaApp(username, password, { firstRun: false });
    toast('🎉 ¡Bienvenido, ' + username + '!');
  } finally {
    if (btnReg) { btnReg.disabled = false; btnReg.textContent = '✨ Crear mi cuenta'; }
  }
}

// LOGIN MULTI-USUARIO
let _loginIntentos = 0;
let _loginBloqueadoHasta = 0;

async function doLogin() {
  const emailRaw = document.getElementById('login-email').value;
  const passRaw  = document.getElementById('login-pass').value;
  const inputEmail = emailRaw.trim().toLowerCase();
  const inputPass  = passRaw;
  const err        = document.getElementById('login-err');

  if (Date.now() < _loginBloqueadoHasta) {
    const seg = Math.ceil((_loginBloqueadoHasta - Date.now()) / 1000);
    err.textContent = `🔒 Bloqueado. Esperá ${seg}s.`;
    err.classList.add('on'); return;
  }

  if (!inputEmail || !inputEmail.includes('@')) {
    err.textContent = 'Ingresá tu email'; err.classList.add('on'); return;
  }
  if (!inputPass) {
    err.textContent = 'Ingresá tu contraseña'; err.classList.add('on'); return;
  }
  if (!_fbAuth && !_initFirebase()) {
    err.textContent = 'Sin conexión. Verificá tu internet.'; err.classList.add('on'); return;
  }

  err.classList.remove('on');

  try {
    const cred = await _fbAuth.signInWithEmailAndPassword(inputEmail, inputPass);
    _fbUser = cred.user;
    _loginIntentos = 0;

    const nombre = cred.user.displayName || inputEmail.split('@')[0];
    currentUser  = nombre;

    // Guardar en cache local
    await setUsuario({ username: nombre, email: inputEmail, uid: cred.user.uid, firstRun: false, creadoEn: new Date().toISOString() });

    if (document.getElementById('remember-me')?.checked) {
      localStorage.setItem('rememberedEmail', inputEmail);
    } else {
      localStorage.removeItem('rememberedEmail');
    }

    await _entrarALaApp(nombre, inputPass, { firstRun: false });

  } catch(e) {
    _loginIntentos++;
    const msgs = {
      'auth/user-not-found':      'No existe una cuenta con ese email',
      'auth/wrong-password':      'Contraseña incorrecta',
      'auth/invalid-credential':  'Email o contraseña incorrectos',
      'auth/invalid-email':       'Email no válido',
      'auth/too-many-requests':   'Demasiados intentos. Esperá unos minutos.',
      'auth/user-disabled':       '⛔ Cuenta suspendida. Contactá al administrador.',
    };
    // Diagnóstico: detectar problemas comunes de celular
    const emailConEspacios = emailRaw !== emailRaw.trim();
    const passConEspacios  = passRaw !== passRaw.trim();
    let mensajeExtra = '';
    if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
      if (passConEspacios) mensajeExtra = ' · ⚠️ Tu contraseña tiene espacios al inicio/final';
      else if (emailConEspacios) mensajeExtra = ' · ⚠️ Tu email tenía espacios';
    }
    if (_loginIntentos >= 5) {
      _loginBloqueadoHasta = Date.now() + 60000;
      _loginIntentos = 0;
      err.textContent = '🔒 5 intentos fallidos. Bloqueado 60 segundos.';
    } else {
      err.textContent = (msgs[e.code] || 'Email o contraseña incorrectos') + mensajeExtra;
    }
    err.classList.add('on');
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }
}

// Función interna: entrar a la app con usuario validado
async function _entrarALaApp(username, password, usuarioObj) {
  _loginIntentos = 0;
  currentUser = username;

  // Recordarme
  if (document.getElementById('remember-me')?.checked) {
    localStorage.setItem('rememberedEmail', inputEmail);
  } else {
    localStorage.removeItem('rememberedEmail');
  }

  // Abrir DB específica del usuario
  await initDB(username);
  await autoUpdateEstados();
  await updateBadges();
  await updateSyncPendingBadge();
  await setSyncMeta('currentUser',   username);
  await setSyncMeta('deviceId',      DEVICE_ID);
  await setSyncMeta('schemaVersion', String(DB_VER));
  await setSyncMeta('lastLoginAt',   new Date().toISOString());

  showUserBadge(username);
  document.getElementById('login-screen').classList.add('hidden');
  appDesbloqueada = true;
  resetInactividad();

  // Sync inicial en segundo plano (no bloquea la UI)
  setTimeout(async () => {
    if (!_fbUser || !navigator.onLine) return;
    await _pullFromFirebase();
    await _pushToFirebase();
    // Iniciar listeners en tiempo real
    iniciarSyncRealtime();
    // Cargar foto de perfil
    cargarFotoPerfil();
  }, 800);

  await renderPage('dashboard');

  if (usuarioObj?.firstRun === true) {
    setTimeout(showFirstRunScreen, 500);
  }
}

// Función interna: registrar intento fallido
function _falloLogin(err, passField) {
  _loginIntentos++;
  const restantes = 5 - _loginIntentos;
  if (_loginIntentos >= 5) {
    _loginBloqueadoHasta = Date.now() + 60000;
    _loginIntentos = 0;
    err.textContent = '🔒 5 intentos fallidos. Bloqueado por 60 segundos.';
    const iv = setInterval(() => {
      const seg = Math.ceil((_loginBloqueadoHasta - Date.now()) / 1000);
      if (seg <= 0) { clearInterval(iv); err.textContent = 'Usuario o contraseña incorrectos'; }
      else err.textContent = `🔒 Bloqueado. Esperá ${seg} segundo${seg!==1?'s':''}.`;
    }, 1000);
  } else {
    err.textContent = `Usuario o contraseña incorrectos · ${restantes} intento${restantes!==1?'s':''} restante${restantes!==1?'s':''}`;
  }
  err.classList.add('on');
  document.getElementById('login-pass').value = '';
  document.getElementById('login-pass').focus();
}

function openReset() {
  document.getElementById('rst-err1').classList.remove('on');
  document.getElementById('rst-ok').style.display = 'none';
  const emailEl = document.getElementById('rst-email');
  if (emailEl) emailEl.value = '';
  document.getElementById('reset-screen').classList.add('on');
  setTimeout(() => document.getElementById('rst-email')?.focus(), 100);
}

function closeReset() {
  document.getElementById('reset-screen').classList.remove('on');
}

async function enviarRecuperacion() {
  const email = document.getElementById('rst-email')?.value?.trim();
  const errEl  = document.getElementById('rst-err1');
  const okEl   = document.getElementById('rst-ok');
  const btn    = document.getElementById('btn-rst-send');
  errEl.classList.remove('on');
  okEl.style.display = 'none';

  if (!email || !email.includes('@')) {
    errEl.textContent = 'Ingresá un email válido';
    errEl.classList.add('on'); return;
  }
  if (!_fbAuth && !_initFirebase()) {
    errEl.textContent = 'Sin conexión. Verificá tu internet.';
    errEl.classList.add('on'); return;
  }

  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  try {
    await _fbAuth.sendPasswordResetEmail(email);
    okEl.style.display = 'block';
    document.getElementById('rst-email').value = '';
  } catch(e) {
    errEl.textContent = e.code === 'auth/user-not-found'
      ? 'No existe una cuenta con ese email'
      : 'Error: ' + e.message;
    errEl.classList.add('on');
  } finally {
    btn.disabled = false; btn.textContent = '📧 Enviar link';
  }
}

// Compatibilidad con código viejo que llame verificarMaestra/guardarNuevasCred
function verificarMaestra() { openReset(); }
async function guardarNuevasCred() { closeReset(); }

async function guardarSeguridad() {
  const passActual = document.getElementById('sec-pass-actual').value;
  const newUser    = document.getElementById('sec-user').value.trim().toLowerCase();
  const newPass    = document.getElementById('sec-pass').value;
  const newPass2   = document.getElementById('sec-pass2').value;
  const errEl      = document.getElementById('sec-err');
  errEl.classList.remove('on');

  if (!passActual) {
    errEl.textContent = 'Ingresá tu contraseña actual para confirmar';
    errEl.classList.add('on'); return;
  }

  // Verificar contraseña actual
  const cred = await authGetCred();
  if (passActual !== cred.pass) {
    errEl.textContent = 'Contraseña actual incorrecta';
    errEl.classList.add('on');
    document.getElementById('sec-pass-actual').value = '';
    return;
  }

  if (!newUser) {
    errEl.textContent = 'El usuario no puede estar vacío';
    errEl.classList.add('on'); return;
  }
  if (newPass && newPass.length < 6) {
    errEl.textContent = 'La nueva contraseña debe tener al menos 6 caracteres';
    errEl.classList.add('on'); return;
  }
  if (newPass && newPass !== newPass2) {
    errEl.textContent = 'Las contraseñas nuevas no coinciden';
    errEl.classList.add('on'); return;
  }

  const existing = await getUsuario(currentUser) || { username: currentUser };
  await setUsuario({ ...existing, username: newUser, pass: newPass || existing.pass });
  if (newUser !== currentUser) {
    currentUser = newUser;
    const badge = document.getElementById('usr-badge');
    if (badge) badge.textContent = '👤 ' + newUser;
  }
  document.getElementById('sec-pass-actual').value = '';
  document.getElementById('sec-pass').value = '';
  document.getElementById('sec-pass2').value = '';
  toast('✅ Credenciales guardadas correctamente');
}

// Legacy: contraseña maestra eliminada. Stub conservado por compatibilidad.
async function guardarMaestra() {
  toast('ℹ️ Esta función fue eliminada. Usá "Cambiar contraseña" arriba.');
}

function cerrarSesion() {
  appDesbloqueada  = false;
  currentUser      = null;
  DB               = null;
  driveAccessToken = null;
  _fbUser          = null;
  clearTimeout(inactividadTimer);
  clearTimeout(_syncDebounce);
  clearInterval(driveSyncTimer);
  if (typeof detenerSyncRealtime === 'function') detenerSyncRealtime();
  drivePendingSync = false;

  // Cerrar sesión Firebase
  if (_fbAuth) _fbAuth.signOut().catch(() => {});

  const badge = document.getElementById('usr-badge');
  if (badge) { badge.style.display = 'none'; }
  document.getElementById('sync-pending-badge').classList.remove('on');
  document.getElementById('drive-status').classList.remove('on');
  const _savedUser   = localStorage.getItem('rememberedEmail');
  const _loginUserEl = document.getElementById('login-email');
  const _loginPassEl = document.getElementById('login-pass');
  const _rememberEl  = document.getElementById('remember-me');
  _loginUserEl.value = _savedUser || '';
  _loginPassEl.value = '';
  if (_rememberEl) _rememberEl.checked = !!_savedUser;
  document.getElementById('login-screen').classList.remove('hidden');
  setTimeout(() => (_savedUser ? _loginPassEl : _loginUserEl).focus(), 50);
  closeUserMenu();
  toast('👋 Sesión cerrada');
}

