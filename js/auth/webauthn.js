/* =====================================================
   BIOMETRÍA / WEBAUTHN — DESACTIVADO
===================================================== */

const BIOMETRIC_PREFIX = 'pc_biometric_';
const BIOMETRIA_LOGIN_HABILITADA = false;

function limpiarCredencialesBiometricasLocales() {
  try {
    Object.keys(localStorage)
      .filter(key => key === 'pc_last_biometric_uid' || key.startsWith(BIOMETRIC_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  } catch(e) {
    console.warn('No se pudieron limpiar credenciales biométricas locales', e);
  }
}

function biometriaDesactivada() {
  limpiarCredencialesBiometricasLocales();
  toast('Biometría desactivada temporalmente.');
}

function webAuthnDisponible() {
  return false;
}

function credencialesBiometricasGuardadas() {
  limpiarCredencialesBiometricasLocales();
  return [];
}

async function registrarHuella() {
  biometriaDesactivada();
}

async function loginConHuella() {
  if (typeof loginConPasswordConfirmado !== 'undefined') loginConPasswordConfirmado = false;
  biometriaDesactivada();
}

function eliminarHuella() {
  limpiarCredencialesBiometricasLocales();
  toast('Biometría desactivada temporalmente.');
}

function actualizarUIHuella() {
  limpiarCredencialesBiometricasLocales();
  const card = document.getElementById('card-huella');
  if (card) card.style.display = 'none';
}

function actualizarBotonHuella() {
  limpiarCredencialesBiometricasLocales();
  const btn = document.getElementById('btn-huella');
  if (!btn) return;
  btn.disabled = true;
  btn.setAttribute('aria-hidden', 'true');
  btn.style.display = 'none';
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
