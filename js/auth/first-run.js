/* =====================================================
   FIRST RUN — primer ingreso obligatorio
===================================================== */
async function checkFirstRun(username) {
  const u = await getUsuario(username);
  return u && u.firstRun === true;
}

function showFirstRunScreen() {
  document.getElementById('firstrun-screen').classList.add('on');
  setTimeout(() => document.getElementById('fr-user').focus(), 100);
}

async function completarFirstRun() {
  const newUser   = document.getElementById('fr-user').value.trim().toLowerCase();
  const newPass   = document.getElementById('fr-pass').value;
  const newPass2  = document.getElementById('fr-pass2').value;
  const errEl     = document.getElementById('fr-err');

  errEl.style.display = 'none';
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

  if (!newUser || newUser.length < 3)       return showErr('El usuario debe tener al menos 3 caracteres');
  if (!newPass || newPass.length < 6)       return showErr('La contraseña debe tener al menos 6 caracteres');
  if (newPass !== newPass2)                  return showErr('Las contraseñas no coinciden');

  // Si cambió el username, renombrar la entrada
  const oldUser = currentUser;
  const oldPass = (await getUsuario(oldUser))?.pass || DEFAULT_PASS;
  const existing = await getUsuario(oldUser) || { username: oldUser };
  await setUsuario({ ...existing, username: newUser, pass: newPass, firstRun: false });
  if (oldUser !== newUser) await globalDbPut('usuarios', { ...existing, username: newUser, pass: newPass, firstRun: false });

  currentUser = newUser;
  showUserBadge(newUser);
  document.getElementById('firstrun-screen').classList.remove('on');
  toast('✅ Configuración guardada — bienvenido, ' + newUser + '!');
  await logBitacora('config', `Primer ingreso completado: usuario "${newUser}" configurado`, newUser);

  // Actualizar cuenta Firebase (no crear nueva)
  sincronizarCambiandoCredenciales(oldUser, oldPass, newUser, newPass);
}

/* =====================================================
   UTILS
===================================================== */
