/* =====================================================
   BLOQUEO POR INACTIVIDAD
===================================================== */
const INACTIVIDAD_MS = 5 * 60 * 1000; // 5 minutos

function resetInactividad() {
  if (!appDesbloqueada) return;
  clearTimeout(inactividadTimer);
  inactividadTimer = setTimeout(bloquearPorInactividad, INACTIVIDAD_MS);
}

function bloquearPorInactividad() {
  appDesbloqueada = false;
  document.getElementById('lock-err').classList.remove('on');
  document.getElementById('lock-pass').value = '';
  document.getElementById('lock-screen').classList.add('on');
  setTimeout(() => document.getElementById('lock-pass').focus(), 100);
}

async function doUnlock() {
  const inputPass = document.getElementById('lock-pass').value;
  const err = document.getElementById('lock-err');
  const btn = document.querySelector('#lock-screen button.btn-gold, #lock-screen .btn-full');

  if (!inputPass) {
    err.textContent = 'Ingresá tu contraseña';
    err.classList.add('on');
    return;
  }

  // Validar contra Firebase Auth real (la misma contraseña con la que ingresaste)
  if (!_fbUser || !_fbAuth) {
    // Fallback offline: validar contra local si no hay Firebase disponible
    const cred = await authGetCred();
    if (inputPass === cred.pass) {
      err.classList.remove('on');
      document.getElementById('lock-screen').classList.remove('on');
      document.getElementById('lock-pass').value = '';
      appDesbloqueada = true;
      resetInactividad();
    } else {
      err.textContent = 'Contraseña incorrecta';
      err.classList.add('on');
      document.getElementById('lock-pass').value = '';
      document.getElementById('lock-pass').focus();
    }
    return;
  }

  try {
    // Re-autenticar con Firebase usando el email del usuario actual
    const email = _fbUser.email;
    const credential = firebase.auth.EmailAuthProvider.credential(email, inputPass);
    await _fbUser.reauthenticateWithCredential(credential);

    // Éxito
    err.classList.remove('on');
    document.getElementById('lock-screen').classList.remove('on');
    document.getElementById('lock-pass').value = '';
    appDesbloqueada = true;
    resetInactividad();
  } catch(e) {
    console.warn('doUnlock error:', e.code);
    err.textContent = 'Contraseña incorrecta';
    err.classList.add('on');
    document.getElementById('lock-pass').value = '';
    document.getElementById('lock-pass').focus();
  }
}

function iniciarWatchdogInactividad() {
  ['click','keydown','touchstart','mousemove','scroll'].forEach(ev =>
    document.addEventListener(ev, resetInactividad, { passive: true })
  );
  resetInactividad();
}

