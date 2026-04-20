/* =====================================================
   NOTIFICACIONES (Notification API)
===================================================== */
async function initNotificaciones() {
  if (!('Notification' in window)) return;
  const perm = await getConfig('notifPerm');
  if (perm !== 'granted' && Notification.permission !== 'granted') return;
  scheduleNotificaciones();
}

function scheduleNotificaciones() {
  // Revisar cada 30 minutos
  setInterval(async () => {
    if (document.hidden) await checkNotificaciones();
  }, 30 * 60 * 1000);
  // También al iniciar
  setTimeout(checkNotificaciones, 3000);
}

async function checkNotificaciones() {
  if (Notification.permission !== 'granted') return;
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  let vencenHoy = 0, atrasadas = 0;
  cuotas.forEach(c => {
    if (c.estado === 'Pagado') return;
    const v = parseDate(c.fechaVenc); if (!v) return;
    const dias = Math.floor((hoy - v) / 86400000);
    if (v.getTime() === hoy.getTime()) vencenHoy++;
    else if (dias > 0) atrasadas++;
  });
  const lastNotif = await getConfig('lastNotifDate');
  const todayStr = hoy.toISOString().split('T')[0];
  if (lastNotif === todayStr) return; // ya notificamos hoy
  if (vencenHoy === 0 && atrasadas === 0) return;
  let msg = '';
  if (vencenHoy > 0) msg += `📅 ${vencenHoy} cuota${vencenHoy>1?'s':''} vencen hoy. `;
  if (atrasadas > 0) msg += `⚠️ ${atrasadas} cuota${atrasadas>1?'s':''} atrasada${atrasadas>1?'s':''}.`;
  new Notification('💰 PrestControl', { body: msg, icon: '' });
  await setConfig('lastNotifDate', todayStr);
}

async function pedirPermiso() {
  if (!('Notification' in window)) { toast('❌ Notificaciones no soportadas'); return; }
  const perm = await Notification.requestPermission();
  await setConfig('notifPerm', perm);
  if (perm === 'granted') {
    toast('✅ Notificaciones activadas');
    scheduleNotificaciones();
  } else {
    toast('⚠️ Permiso denegado');
  }
  renderConfig();
}

