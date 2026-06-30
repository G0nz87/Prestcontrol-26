/* Ojito para campos de contraseña */
const EYE_OPEN  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_SHUT  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function toggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  btn.innerHTML = isPass ? EYE_SHUT : EYE_OPEN;
}

let toastT;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2600);
}

export function setLoading(id) {
  document.getElementById(id).innerHTML = '<div class="loader"><div class="spin"></div></div>';
}

export function emptyHTML(ic, t, s='') {
  return `<div class="empty"><div class="empty-ic">${ic}</div><div class="empty-t">${t}</div>${s?`<div class="empty-s">${s}</div>`:''}`;
}

Object.assign(window, {
  toggleEye,
  toast,
  setLoading,
  emptyHTML
});
