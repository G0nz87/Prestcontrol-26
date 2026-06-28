/* =====================================================
   WHATSAPP
===================================================== */
async function saveWhatsApp() {
  const phone  = document.getElementById('wa-phone').value.trim().replace(/[\s+\-()]/g,'');
  const apikey = document.getElementById('wa-apikey').value.trim();
  if (!phone || !apikey) { toast('⚠️ Ingresá teléfono y API Key'); return; }
  await setConfig('waPhone', phone);
  await setConfig('waApikey', apikey);
  toast('✅ WhatsApp guardado');
}

async function enviarWA(msg) {
  const phone  = await getConfig('waPhone');
  const apikey = await getConfig('waApikey');
  if (!phone || !apikey) { toast('⚠️ Configurá WhatsApp primero'); return false; }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const r = await fetch(url, { mode:'no-cors' });
    return true;
  } catch(e) { return false; }
}

async function testWA() {
  toast('📤 Enviando mensaje de prueba...');
  const ok = await enviarWA('✅ *PrestControl* conectada.\nNotificaciones WhatsApp funcionando correctamente 🎉');
  toast(ok ? '✅ Mensaje enviado — revisá tu WhatsApp' : '⚠️ Enviado (verificá tu WhatsApp)');
}

async function enviarResumenWA() {
  const cuotas = await dbAll('cuotas');
  const hoy = today();
  const vHoy = [], atrasadas = [];

  cuotas.forEach(c => {
    if (c.estado === 'Pagado') return;
    const v = parseDate(c.fechaVenc); if (!v) return;
    const dias = Math.floor((hoy - v) / 86400000);
    const item = `• ${c.clienteNombre} (C${c.nro}): ${fmtMoney(c.monto)}`;
    if (v.getTime() === hoy.getTime()) vHoy.push(item);
    else if (dias > 0) atrasadas.push(`${item} — ${dias}d`);
  });

  if (!vHoy.length && !atrasadas.length) { toast('ℹ️ Sin cobros urgentes hoy'); return; }

  const fecha = hoy.toLocaleDateString('es-AR');
  let msg = `💰 *PRÉSTAMOS — ${fecha}*`;
  if (vHoy.length) msg += `\n\n📅 *COBRAR HOY (${vHoy.length}):*\n${vHoy.join('\n')}`;
  if (atrasadas.length) {
    msg += `\n\n⚠️ *ATRASADAS (${atrasadas.length}):*\n${atrasadas.slice(0,10).join('\n')}`;
    if (atrasadas.length>10) msg += `\n_...y ${atrasadas.length-10} más_`;
  }
  toast('📤 Enviando resumen...');
  await enviarWA(msg);
  toast('✅ Resumen enviado');
}

/* =====================================================
   WHATSAPP DIRECTO — desde cliente / cuota
===================================================== */
async function abrirWACliente(clienteId) {
  const [cliente, prestamos, cuotas] = await Promise.all([
    dbGet('clientes', clienteId), dbAll('prestamos'), dbAll('cuotas')
  ]);
  if (!cliente) { toast('Cliente no encontrado'); return; }
  if (!cliente.telefono) { toast('⚠️ El cliente no tiene teléfono'); return; }

  const hoy    = today();
  const misCuo = cuotas.filter(c => c.clienteId === clienteId && c.estado !== 'Pagado');
  const vHoy   = misCuo.filter(c => { const v=parseDate(c.fechaVenc); return v && v.getTime()===hoy.getTime(); });
  const atr    = misCuo.filter(c => { const v=parseDate(c.fechaVenc); return v && v<hoy; });

  let msg = `Hola ${cliente.nombre.split(' ')[0]} 👋\n`;

  if (vHoy.length) {
    msg += `\n📅 *Vence HOY:*\n`;
    vHoy.forEach(c => { msg += `  • Cuota ${c.nro} · ${fmtMoney(c.monto)}\n`; });
  }
  if (atr.length) {
    msg += `\n⚠️ *Cuotas atrasadas (${atr.length}):*\n`;
    atr.slice(0,3).forEach(c => {
      const dias = Math.floor((hoy - parseDate(c.fechaVenc)) / 86400000);
      msg += `  • Cuota ${c.nro} · ${fmtMoney(c.monto)} · ${dias}d de atraso\n`;
    });
  }
  if (!vHoy.length && !atr.length) {
    msg += `\nTe recordamos que tenés cuotas pendientes con nosotros 🙏`;
  }
  msg += `\n_PrestControl_`;

  const tel = cliente.telefono.replace(/\D/g,'');
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

async function enviarWACuota(cuotaId) {
  const c = await dbGet('cuotas', cuotaId);
  if (!c) return;
  const cliente = await dbGet('clientes', c.clienteId);
  if (!cliente?.telefono) { toast('⚠️ El cliente no tiene teléfono'); return; }

  const dias = c.estado === 'Atrasado'
    ? Math.floor((today() - parseDate(c.fechaVenc)) / 86400000)
    : null;

  let msg = `Hola ${cliente.nombre.split(' ')[0]} 👋\n\n`;
  if (dias !== null) {
    msg += `⚠️ Tu cuota *${c.nro}* lleva *${dias} días de atraso*.\n`;
  } else {
    msg += `📅 Tu cuota *${c.nro}* vence el *${fmtDate(c.fechaVenc)}*.\n`;
  }
  msg += `💰 Monto: *${fmtMoney(c.monto)}*\n\n`;
  msg += `Comunicate con nosotros para coordinar el pago 🙏\n_PrestControl_`;

  const tel = cliente.telefono.replace(/\D/g,'');
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

