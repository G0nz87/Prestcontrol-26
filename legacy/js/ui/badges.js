/* =====================================================
   BADGES
===================================================== */
function setBadge(id, n) {
  // Update both main nav and mas-menu badges
  ['bd-' + id, 'bd-' + id + '-m'].forEach(elId => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('on', n > 0);
  });
}

async function updateBadges() {
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  let hoyN=0, atrN=0;
  cuotas.forEach(c => {
    if (c.estado === 'Pagado') return;
    const v = parseDate(c.fechaVenc); if (!v) return;
    const dias = Math.floor((hoy - v) / 86400000);
    if (v.getTime() === hoy.getTime()) hoyN++;
    else if (dias > 0) atrN++;
  });
  setBadge('hoy', hoyN);
  setBadge('atr', atrN);
}

/* =====================================================
   PWA MANIFEST (inline)
===================================================== */
/* =====================================================
   DASHBOARD CLIENTE — AUTOCOMPLETE
===================================================== */
function filtrarDashCliente(q) {
  const drop = document.getElementById('dash-cli-drop');
  if (!drop) return;
  const items = drop.querySelectorAll('.ac-item');
  const ql = q.trim().toLowerCase();
  let visible = 0;
  items.forEach(it => {
    const name = it.textContent.toLowerCase();
    const match = !ql || name.includes(ql);
    it.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  drop.classList.toggle('on', visible > 0);
}

// Close dash autocomplete when clicking outside
document.addEventListener('click', e => {
  const wrap = document.querySelector('#pg-dashboard .ac-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const drop = document.getElementById('dash-cli-drop');
    if (drop) drop.classList.remove('on');
  }
});
