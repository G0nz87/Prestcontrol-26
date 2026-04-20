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

async function registrarHuella() {
  if (!webAuthnDisponible()) {
    toast('⚠️ Tu dispositivo no soporta huella digital');
    return;
  }
  if (!currentUser) { toast('⚠️ Necesitás estar logueado'); return; }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = strToBuffer(currentUser);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'PrestControl', id: location.hostname || 'localhost' },
        user: { id: userId, name: currentUser, displayName: currentUser },
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
      createdAt: new Date().toISOString()
    };
    localStorage.setItem('pc_biometric_' + currentUser, JSON.stringify(credData));

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
  if (!webAuthnDisponible()) return;

  // Buscar credenciales guardadas
  const keys = Object.keys(localStorage).filter(k => k.startsWith('pc_biometric_'));
  if (!keys.length) {
    toast('⚠️ No hay huella registrada');
    return;
  }

  // Obtener credenciales disponibles
  const creds = keys.map(k => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  }).filter(Boolean);

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname || 'localhost',
        allowCredentials: creds.map(c => ({
          id: b64ToBuffer(c.rawId),
          type: 'public-key'
        })),
        userVerification: 'required',
        timeout: 60000
      }
    });

    // Identificar qué usuario corresponde
    const matched = creds.find(c => c.id === assertion.id);
    if (!matched) { toast('⚠️ Huella no reconocida'); return; }

    const username = matched.username;

    // Verificar que el usuario existe en la DB
    const usuario = await getUsuario(username);
    const isDefault = username === DEFAULT_USER;
    if (!usuario && !isDefault) { toast('⚠️ Usuario no encontrado'); return; }

    // Login exitoso
    currentUser = username;
    if (!usuario) {
      await setUsuario({ username, pass: DEFAULT_PASS, creadoEn: new Date().toISOString(), firstRun: true });
    }
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
    toast('👆 Bienvenido, ' + username);

  } catch(e) {
    if (e.name === 'NotAllowedError') {
      toast('⚠️ Autenticación cancelada');
    } else {
      toast('⚠️ Error de huella: ' + e.message);
    }
  }
}

function eliminarHuella() {
  if (!currentUser) return;
  localStorage.removeItem('pc_biometric_' + currentUser);
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

  const tiene = currentUser && localStorage.getItem('pc_biometric_' + currentUser);
  if (!webAuthnDisponible()) {
    estEl.textContent = '⚫ No disponible';
    estEl.style.color = 'var(--muted)';
    if (infoEl) infoEl.textContent = 'Tu dispositivo o navegador no soporta autenticación biométrica.';
    if (btnReg) btnReg.style.display = 'none';
    if (btnDel) btnDel.style.display = 'none';
    return;
  }
  if (tiene) {
    const data = JSON.parse(tiene);
    estEl.textContent = '✅ Activa';
    estEl.style.color = 'var(--grn)';
    if (infoEl) infoEl.textContent = `Registrada el ${new Date(data.createdAt).toLocaleDateString('es-AR')}. Al ingresar aparece el botón de huella.`;
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
  if (!btn || !webAuthnDisponible()) return;
  // Mostrar botón si hay alguna huella registrada
  const hayHuella = Object.keys(localStorage).some(k => k.startsWith('pc_biometric_'));
  btn.style.display = hayHuella ? 'flex' : 'none';
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

