/* =====================================================
   EXPORTAR PDF
===================================================== */
async function exportarPDF() {
  toast('📄 Generando PDF...');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const [cuotas, clientes, prestamos] = await Promise.all([
    dbAll('cuotas'), dbAll('clientes'), dbAll('prestamos')
  ]);
  const hoy = today();
  const fechaStr = hoy.toLocaleDateString('es-AR');

  // Header
  doc.setFillColor(10, 15, 31);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(245, 200, 66);
  doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('PRESTAMOS APP', 14, 12);
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.setTextColor(200, 200, 255);
  doc.text(`Reporte generado: ${fechaStr}`, 14, 20);

  let y = 36;

  // Global stats
  doc.setTextColor(30,30,30); doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text('RESUMEN GLOBAL', 14, y); y += 6;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const totalPrest = prestamos.reduce((s,p)=>s+Number(p.monto||0),0);
  const totalGan   = prestamos.reduce((s,p)=>s+Number(p.ganancia||0),0);
  const cPag       = cuotas.filter(c=>c.estado==='Pagado').length;
  const cAtr       = cuotas.filter(c=>c.estado==='Atrasado').length;
  const mAtr       = cuotas.filter(c=>c.estado==='Atrasado').reduce((s,c)=>s+Number(c.monto||0),0);
  [
    [`Clientes activos: ${clientes.filter(c=>c.estado==='Activo').length}`, `Préstamos activos: ${prestamos.filter(p=>p.estado==='Activo').length}`],
    [`Total prestado: $${totalPrest.toLocaleString('es-AR')}`, `Ganancia esperada: $${totalGan.toLocaleString('es-AR')}`],
    [`Cuotas pagadas: ${cPag}`, `Cuotas atrasadas: ${cAtr} ($${mAtr.toLocaleString('es-AR')})`],
  ].forEach(([a,b]) => {
    doc.text(a, 14, y); doc.text(b, 110, y); y += 6;
  });

  y += 6;

  // Atrasadas section
  const atrasadas = cuotas.filter(c=>c.estado==='Atrasado').sort((a,b)=>{
    const da = parseDate(a.fechaVenc), db = parseDate(b.fechaVenc); return da-db;
  });
  if (atrasadas.length) {
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.setTextColor(192,0,0); doc.text('⚠ CUOTAS ATRASADAS', 14, y); y+=6;
    doc.setTextColor(30,30,30); doc.setFontSize(9); doc.setFont('helvetica','normal');
    atrasadas.forEach(c => {
      if (y > 270) { doc.addPage(); y = 20; }
      const dias = Math.floor((hoy - parseDate(c.fechaVenc)) / 86400000);
      doc.text(`${c.clienteNombre}`, 14, y);
      doc.text(`Cuota ${c.nro}`, 80, y);
      doc.text(fmtDate(c.fechaVenc), 105, y);
      doc.text(`${dias}d atraso`, 135, y);
      doc.text(`$${Number(c.monto||0).toLocaleString('es-AR')}`, 165, y);
      y += 5;
    });
    y += 4;
  }

  // Préstamos activos
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.setTextColor(10,15,31); doc.text('PRÉSTAMOS ACTIVOS', 14, y); y+=6;
  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  prestamos.filter(p=>p.estado==='Activo').forEach(p => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(`${p.clienteNombre}`, 14, y);
    doc.text(p.id, 80, y);
    doc.text(`$${Number(p.cuota||0).toLocaleString('es-AR')}/cuota`, 110, y);
    const cuotasPre = cuotas.filter(c=>c.prestamoId===p.id);
    const pag = cuotasPre.filter(c=>c.estado==='Pagado').length;
    doc.text(`${pag}/${p.nCuotas} pagadas`, 155, y);
    y += 5;
  });

  const d = new Date().toISOString().split('T')[0];
  doc.save(`prestamos_reporte_${d}.pdf`);
  toast('✅ PDF descargado');
}

/* =====================================================
   COMPROBANTE — CUOTA PAGADA (PDF)
===================================================== */
async function imprimirComprobante(cuotaId) {
  const cuota = await dbGet('cuotas', cuotaId);
  if (!cuota) { toast('⚠️ Cuota no encontrada'); return; }
  const prestamo = await dbGet('prestamos', cuota.prestamoId);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a6' }); // A6 = tamaño recibo

  const W = doc.internal.pageSize.getWidth();
  let y = 10;

  // Header
  doc.setFillColor(10, 15, 31);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(192, 38, 211);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('COMPROBANTE DE PAGO', W/2, 12, { align: 'center' });
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('Sistema de Gestión de Préstamos', W/2, 20, { align: 'center' });
  doc.text(new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' }), W/2, 25, { align: 'center' });

  y = 35;
  // Línea divisoria
  doc.setDrawColor(192, 38, 211);
  doc.setLineWidth(0.5);
  doc.line(8, y, W-8, y);
  y += 7;

  const addRow = (label, value, colorVal = [30, 30, 30]) => {
    doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(label, 10, y);
    doc.setTextColor(...colorVal); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(String(value || '—'), W-10, y, { align: 'right' });
    y += 7;
  };

  addRow('Cliente',        cuota.clienteNombre || '—');
  addRow('Préstamo N°',    cuota.prestamoId || '—');
  addRow('Cuota',          `${cuota.nro} de ${prestamo?.nCuotas || '?'}`);
  addRow('Vencimiento',    fmtDate(cuota.fechaVenc));
  addRow('Fecha de pago',  fmtDate(cuota.fechaPago));
  addRow('Método',         cuota.metodo || '—');

  y += 2;
  doc.setDrawColor(100, 100, 100); doc.setLineWidth(0.3);
  doc.line(8, y, W-8, y);
  y += 8;

  // Monto destacado
  doc.setFillColor(192, 38, 211, 0.1);
  doc.roundedRect(8, y-5, W-16, 14, 3, 3, 'F');
  doc.setTextColor(148, 163, 184); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('MONTO PAGADO', W/2, y+1, { align: 'center' });
  doc.setTextColor(103, 232, 249); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(fmtMoney(cuota.monto), W/2, y+9, { align: 'center' });
  y += 20;

  // Footer
  doc.setTextColor(100, 100, 100); doc.setFontSize(7); doc.setFont('helvetica', 'italic');
  doc.text('Este comprobante es válido como constancia de pago.', W/2, y, { align: 'center' });

  doc.save(`comprobante_${cuota.clienteNombre?.replace(/\s/g,'_')}_C${cuota.nro}_${cuota.prestamoId}.pdf`);
  toast('✅ Comprobante descargado');
}

/* =====================================================
   COMPROBANTE — PRÉSTAMO COMPLETO (PDF)
===================================================== */
async function imprimirComprobantePrestamo(prestamoId) {
  const [prestamo, todasCuotas] = await Promise.all([
    dbGet('prestamos', prestamoId), dbAll('cuotas')
  ]);
  if (!prestamo) { toast('⚠️ Préstamo no encontrado'); return; }
  const cuotas = todasCuotas.filter(c => c.prestamoId === prestamoId).sort((a,b) => a.nro - b.nro);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  let y = 10;

  // Header
  doc.setFillColor(10, 15, 31);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(192, 38, 211);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('RESUMEN DE PRÉSTAMO', W/2, 13, { align: 'center' });
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(`Generado: ${new Date().toLocaleDateString('es-AR')}`, W/2, 21, { align: 'center' });
  doc.text(`Préstamo: ${prestamo.id}`, W/2, 27, { align: 'center' });

  y = 38;
  doc.setDrawColor(192, 38, 211); doc.setLineWidth(0.5);
  doc.line(8, y, W-8, y);
  y += 7;

  const row = (lbl, val, color=[248,250,252]) => {
    doc.setTextColor(148,163,184); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(lbl, 10, y);
    doc.setTextColor(...color); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text(String(val), W-10, y, { align:'right' });
    y += 6.5;
  };

  row('Cliente',       prestamo.clienteNombre || '—');
  row('Fecha',         fmtDate(prestamo.fecha));
  row('Monto prestado', fmtMoney(prestamo.monto), [103,232,249]);
  row('Interés',       `${Math.round(Number(prestamo.interes||0)*100)}%`);
  row('N° de cuotas',  `${prestamo.nCuotas} (${prestamo.tipo})`);
  row('Cuota',         fmtMoney(prestamo.cuota), [34,197,94]);
  row('Total a cobrar', fmtMoney(prestamo.total), [251,191,36]);
  row('Ganancia',      fmtMoney(prestamo.ganancia), [34,197,94]);
  row('Estado',        prestamo.estado);

  y += 3;
  doc.setDrawColor(100,100,100); doc.setLineWidth(0.3);
  doc.line(8, y, W-8, y);
  y += 6;

  // Tabla de cuotas
  doc.setTextColor(148,163,184); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text('N°', 10, y); doc.text('Vencimiento', 28, y);
  doc.text('Monto', 80, y); doc.text('Estado', 108, y); doc.text('Pago', 138, y);
  y += 4;
  doc.setLineWidth(0.2); doc.line(8, y, W-8, y);
  y += 4;

  const stColor = { Pagado:[34,197,94], Pendiente:[251,191,36], Atrasado:[239,68,68] };

  for (const c of cuotas) {
    if (y > 185) { doc.addPage(); y = 15; }
    const col = stColor[c.estado] || [148,163,184];
    doc.setTextColor(30,30,30); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
    doc.text(String(c.nro), 10, y);
    doc.text(fmtDate(c.fechaVenc), 28, y);
    doc.text(fmtMoney(c.monto), 80, y);
    doc.setTextColor(...col);
    doc.text(c.estado, 108, y);
    doc.setTextColor(148,163,184);
    doc.text(c.fechaPago ? fmtDate(c.fechaPago) : '—', 138, y);
    y += 6;
  }

  doc.save(`prestamo_${prestamo.clienteNombre?.replace(/\s/g,'_')}_${prestamo.id}.pdf`);
  toast('✅ Comprobante del préstamo descargado');
}

