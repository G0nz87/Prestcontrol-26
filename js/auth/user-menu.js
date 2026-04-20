/* =====================================================
   USER MENU
===================================================== */
function toggleUserMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  const isOpen = menu.classList.contains('on');
  menu.classList.toggle('on', !isOpen);
  if (!isOpen) {
    // Refrescar info del menú
    updateUserMenuInfo();
    setTimeout(() => document.addEventListener('click', closeUserMenuOutside, { once:true }), 50);
  }
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  if (menu) menu.classList.remove('on');
}

function closeUserMenuOutside(e) {
  const menu = document.getElementById('user-menu');
  const badge = document.getElementById('usr-badge');
  if (menu && badge && !menu.contains(e.target) && !badge.contains(e.target)) {
    menu.classList.remove('on');
  }
}

async function updateUserMenuInfo() {
  const nameEl   = document.getElementById('um-name');
  const syncEl   = document.getElementById('um-sync-info');
  if (nameEl) nameEl.textContent = currentUser || '—';
  if (syncEl) {
    const lastSync = await getGlobalConfig('drive_last_sync_' + currentUser);
    syncEl.textContent = lastSync
      ? '☁️ ' + new Date(lastSync).toLocaleString('es-AR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
      : 'Sin sincronizar aún';
  }
}

function showUserBadge(username) {
  const badge = document.getElementById('usr-badge');
  if (!badge) return;
  // Mostrar inicial con color mientras carga la foto
  const inicial = (username || '?')[0].toUpperCase();
  const colors  = ['#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B','#EF4444'];
  const color   = colors[inicial.charCodeAt(0) % colors.length];
  badge.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${inicial}</span> ${username}`;
  badge.style.display = 'inline-flex';
}

