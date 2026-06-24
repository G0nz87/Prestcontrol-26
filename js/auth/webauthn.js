function webAuthnDisponible() {
  return window.PublicKeyCredential && navigator.credentials;
}

// Convierte string a Uint8Array para WebAuthn
function strToBuffer(str) {
  return new TextEncoder().encode(str);
}

// Convierte ArrayBuffer a base64url
function bufferToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Convierte base64url a Uint8Array
function b64ToBuffer(b64) {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

const BIOMETRIC_PREFIX = 'pc_biometric_';
const BIOMETRIA_LOGIN_HABILITADA = true;
const BIOMETRIA_DEBUG = false;

function normalizarEmailBiometrico(email) {
  return String(email || '').trim().toLowerCase();
}

function logBiometria(evento, detalle = {}) {
  if (BIOMETRIA_DEBUG) console.info(`[Biometría 9.2] ${evento}`, detalle);
}

function credencialesBiometricasGuardadas() {
  return Object.keys(localStorage)
    .filter(key => key.startsWith(BIOMETRIC_PREFIX))
    .map(key => {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        return data?.id && data?.rawId && data?.uid ? { key, ...data } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function registrarHuella() {
  if (!BIOMETRIA_LOGIN_HABILITADA) {
    toast('Biometría desactivada temporalmente. Ingresá con email y contraseña.');
    return;
  }
  if (!webAuthnDisponible()) {
    toast('⚠️ Tu dispositivo no soporta huella digital');
    return;
  }
  if (!appDesbloqueada || !loginConPasswordConfirmado || !currentUser || !_fbUser) {
    toast('Ingresá con email y contraseña antes de registrar la huella.');
    return;
  }

  try {
    const email = normalizarEmailBiometrico(_fbUser.email);
    if (!email) { toast('⚠️ La cuenta Firebase no tiene un email válido'); return; }
    logBiometria('registro_inicio', { email, uidEsperado: _fbUser.uid });
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = strToBuffer(_fbUser.uid);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'PrestControl', id: location.hostname || 'localhost' },
        user: { id: userId, name: email, displayName: currentUser },
        pubKeyCredParams: [
          { alg: -7,  type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' } // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // solo huella/face del dispositivo
          requireResidentKey: false,
          userVerification: 'required'
        },
        timeout: 60000
      }
    });

    // Guardar credencial en localStorage (por usuario)
    const credData = {
      id: credential.id,
      rawId: bufferToB64(credential.rawId),
      username: currentUser,
      uid: _fbUser.uid,
      email,
      createdAt: new Date().toISOString()
    };
    credencialesBiometricasGuardadas()
      .filter(item => item.uid === _fbUser.uid)
      .forEach(item => localStorage.removeItem(item.key));
    localStorage.setItem(BIOMETRIC_PREFIX + _fbUser.uid, JSON.stringify(credData));
    logBiometria('registro_guardado', {
      email,
      credentialId: credential.id,
      uidResuelto: _fbUser.uid
    });

    toast('✅ Huella registrada correctamente');
    actualizarUIHuella();
    actualizarBotonHuella();

  } catch(e) {
    if (e.name === 'NotAllowedError') {
      toast('⚠️ Cancelado o huella no reconocida');
    } else if (e.name === 'NotSupportedError') {
      toast('⚠️ Este dispositivo no tiene sensor biométrico');
    } else {
      toast('⚠️ Error: ' + e.message);
    }
  }
}

async function loginConHuella() {
  if (!BIOMETRIA_LOGIN_HABILITADA) {
    logBiometria('bloqueo', { motivo: 'biometria_desactivada_temporalmente' });
    toast('Biometría desactivada temporalmente. Ingresá con email y contraseña.');
    return;
  }
  loginConPasswordConfirmado = false;
  if (!webAuthnDisponible()) return;

  const emailInput = document.getElementById('login-email');
  const emailVisible = emailInput?.value || '';
  const emailSolicitado = normalizarEmailBiometrico(emailVisible);
  const emailFirebase = normalizarEmailBiometrico(_fbUser?.email);
  logBiometria('intento_login', {
    emailVisible,
    emailNormalizado: emailSolicitado,
    uidEsperado: _fbUser?.uid || null
  });

  // Política A: nunca invocar WebAuthn sin un email visible explícito.
  if (!emailSolicitado) {
    logBiometria('bloqueo', { motivo: 'email_vacio' });
    toast('Ingresá tu email para usar la huella.');
    emailInput?.focus();
    return;
  }
  if (!_fbUser) {
    logBiometria('bloqueo', { motivo: 'sesion_firebase_ausente' });
    toast('⚠️ La biometría requiere una sesión Firebase vigente');
    return;
  }
  if (emailSolicitado !== emailFirebase) {
    logBiometria('bloqueo', {
      motivo: 'email_no_coincide_con_firebase',
      emailNormalizado: emailSolicitado,
      emailFirebase,
      uidEsperado: _fbUser.uid
    });
    toast('La biometría registrada corresponde a otra cuenta.');
    return;
  }

  const creds = credencialesBiometricasGuardadas();
  const seleccionada = creds.find(item =>
    item.uid === _fbUser.uid
    && normalizarEmailBiometrico(item.email) === emailSolicitado
  );
  if (!seleccionada) {
    logBiometria('bloqueo', {
      motivo: 'credencial_no_coincide',
      emailNormalizado: emailSolicitado,
      uidEsperado: _fbUser.uid,
      credencialesDisponibles: creds.map(item => ({
        credentialId: item.id,
        email: normalizarEmailBiometrico(item.email),
        uidResuelto: item.uid
      }))
    });
    toast('No hay huella registrada para esta cuenta.');
    return;
  }
  logBiometria('credencial_seleccionada', {
    emailNormalizado: emailSolicitado,
    credentialId: seleccionada.id,
    uidEsperado: _fbUser.uid,
    uidResuelto: seleccionada.uid
  });

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    logBiometria('webauthn_inicio', { credentialId: seleccionada.id, uidEsperado: _fbUser.uid });

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname || 'localhost',
        allowCredentials: [{
          id: b64ToBuffer(seleccionada.rawId),
          type: 'public-key'
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    logBiometria('webauthn_respuesta', {
      credentialIdDevuelto: assertion.id,
      credentialIdEsperado: seleccionada.id,
      uidEsperado: _fbUser.uid,
      uidResuelto: seleccionada.uid
    });

    // Identificar qué usuario corresponde
    const matched = assertion?.type === 'public-key' && assertion.id === seleccionada.id
      ? seleccionada
      : null;
    if (!matched) { toast('⚠️ Huella no reconocida'); return; }
    const emailAlResolver = normalizarEmailBiometrico(emailInput?.value);
    if (!_fbUser
      || matched.uid !== _fbUser.uid
      || normalizarEmailBiometrico(matched.email) !== emailSolicitado
      || normalizarEmailBiometrico(_fbUser.email) !== emailSolicitado
      || emailAlResolver !== emailSolicitado) {
      logBiometria('bloqueo', {
        motivo: 'validacion_posterior_fallida',
        credentialIdDevuelto: assertion.id,
        credentialIdEsperado: seleccionada.id,
        emailVisibleActual: emailInput?.value || '',
        emailNormalizadoActual: emailAlResolver,
        emailAsociado: normalizarEmailBiometrico(matched.email),
        uidEsperado: _fbUser?.uid || null,
        uidResuelto: matched.uid
      });
      toast('La biometría registrada corresponde a otra cuenta.');
      return;
    }

    const username = matched.username;

    // Verificar que el usuario existe en la DB
    const usuario = await getUsuario(username);
    if (!usuario) { toast('⚠️ Usuario no encontrado'); return; }

    // Login exitoso
    currentUser = username;
    await initDB(username);
    await autoUpdateEstados();
    await updateBadges();
    await updateSyncPendingBadge();
    await setSyncMeta('currentUser', username);
    await setSyncMeta('lastLoginAt', new Date().toISOString());
    showUserBadge(username);
    document.getElementById('login-screen').classList.add('hidden');
    appDesbloqueada = true;
    resetInactividad();
    driveAutoSync();
    await renderPage('dashboard');
    logBiometria('login_exitoso', {
      email: emailSolicitado,
      credentialId: matched.id,
      uidResuelto: matched.uid
    });
    toast('👆 Bienvenido, ' + username);

  } catch(e) {
    logBiometria('error', { nombre: e.name, mensaje: e.message });
    if (e.name === 'NotAllowedError') {
      toast('⚠️ Autenticación cancelada');
    } else {
      toast('⚠️ Error de huella: ' + e.message);
    }
  }
}

function eliminarHuella() {
  if (!currentUser || !_fbUser) return;
  credencialesBiometricasGuardadas()
    .filter(item => item.uid === _fbUser.uid)
    .forEach(item => localStorage.removeItem(item.key));
  toast('🗑️ Huella eliminada');
  actualizarUIHuella();
  actualizarBotonHuella();
}

function actualizarUIHuella() {
  const estEl  = document.getElementById('huella-estado');
  const infoEl = document.getElementById('huella-info');
  const btnReg = document.getElementById('btn-reg-huella');
  const btnDel = document.getElementById('btn-del-huella');
  if (!estEl) return;

  const tiene = _fbUser && credencialesBiometricasGuardadas().find(item => item.uid === _fbUser.uid);
  if (!BIOMETRIA_LOGIN_HABILITADA) {
    estEl.textContent = '⏸️ Desactivada';
    estEl.style.color = 'var(--muted)';
    if (infoEl) infoEl.textContent = 'La biometría está desactivada temporalmente. Ingresá con email y contraseña.';
    if (btnReg) {
      btnReg.disabled = true;
      btnReg.style.display = 'none';
    }
    if (btnDel) btnDel.style.display = tiene ? 'block' : 'none';
    return;
  }
  if (!loginConPasswordConfirmado && !tiene) {
    estEl.textContent = '🔒 Requiere contraseña';
    estEl.style.color = 'var(--muted)';
    if (infoEl) infoEl.textContent = 'Ingresá con email y contraseña para registrar la huella de esta cuenta.';
    if (btnReg) btnReg.style.display = 'none';
    if (btnDel) btnDel.style.display = 'none';
    return;
  }
  if (!webAuthnDisponible()) {
    estEl.textContent = '⚫ No disponible';
    estEl.style.color = 'var(--muted)';
    if (infoEl) infoEl.textContent = 'Tu dispositivo o navegador no soporta autenticación biométrica.';
    if (btnReg) btnReg.style.display = 'none';
    if (btnDel) btnDel.style.display = 'none';
    return;
  }
  if (tiene) {
    const data = tiene;
    estEl.textContent = '✅ Activa';
    estEl.style.color = 'var(--grn)';
    if (infoEl) infoEl.textContent = `Cuenta ${data.email || currentUser} · registrada el ${new Date(data.createdAt).toLocaleDateString('es-AR')}.`;
    if (btnReg) btnReg.style.display = 'none';
    if (btnDel) btnDel.style.display = 'block';
  } else {
    estEl.textContent = '⚪ Inactiva';
    estEl.style.color = 'var(--muted)';
    if (infoEl) infoEl.textContent = 'Activá la huella para ingresar sin escribir contraseña. Solo funciona en este dispositivo.';
    if (btnReg) btnReg.style.display = 'block';
    if (btnDel) btnDel.style.display = 'none';
  }
}

function actualizarBotonHuella() {
  const btn = document.getElementById('btn-huella');
  if (!btn) return;
  if (!BIOMETRIA_LOGIN_HABILITADA) {
    btn.disabled = true;
    btn.setAttribute('aria-hidden', 'true');
    btn.style.display = 'none';
    return;
  }
  const emailSolicitado = normalizarEmailBiometrico(document.getElementById('login-email')?.value);
  const disponible = webAuthnDisponible() && !!_fbUser && !!emailSolicitado;
  btn.disabled = !disponible;
  btn.setAttribute('aria-hidden', String(!disponible));
  btn.style.display = disponible ? 'flex' : 'none';
}

/* Ojito para campos de contraseña */
const EYE_OPEN  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_SHUT  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function toggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  btn.innerHTML = isPass ? EYE_SHUT : EYE_OPEN;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) { const d = new Date(v); d.setHours(0,0,0,0); return d; }
  const d = new Date(v); d.setHours(0,0,0,0); return isNaN(d) ? null : d;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = parseDate(d);
  if (!dt) return '';
  return dt.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtMoney(n) {
  return '$' + Number(n||0).toLocaleString('es-AR', { minimumFractionDigits:0, maximumFractionDigits:0 });
}

function round2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }

function addMonths(date, n) {
  const d = new Date(date), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, last)); return d;
}

function addWeeks(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + 7*n); return d;
}

function calcVenc(base, tipo, i) {
  return tipo === 'Semanal' ? addWeeks(base, i) : addMonths(base, i);
}

function nextId(prefix, list) {
  const nums = list.map(x => {
    const m = String(x.id||'').match(new RegExp(`^${prefix}-(\\d+)$`));
    return m ? parseInt(m[1]) : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max+1).padStart(3,'0')}`;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2600);
}

function setLoading(id) {
  document.getElementById(id).innerHTML = '<div class="loader"><div class="spin"></div></div>';
}

function emptyHTML(ic, t, s='') {
  return `<div class="empty"><div class="empty-ic">${ic}</div><div class="empty-t">${t}</div>${s?`<div class="empty-s">${s}</div>`:''}`;
}
