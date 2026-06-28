/* =====================================================
   EXCEL — EXPORTAR
===================================================== */
async function exportarExcel() {
  await _exportarXLSX(false);
}

async function exportarGoogleSheets() {
  if (!_fbUser) {
    toast('⚠️ Conectá Google Drive primero en Config');
    return;
  }
  await _exportarXLSX(true);
}

async function _exportarXLSX(subirASheets = false) {
  if (typeof XLSX === 'undefined') { toast('⚠️ SheetJS no disponible'); return; }
  toast(subirASheets ? '📊 Generando Google Sheets...' : '📊 Generando Excel...');

  const [clientes, prestamos, cuotas, bitacora] = await Promise.all([
    dbAllIncludeDeleted('clientes'), dbAllIncludeDeleted('prestamos'),
    dbAllIncludeDeleted('cuotas'),  dbAll('bitacora')
  ]);

  const wb = XLSX.utils.book_new();
  const hoy = new Date().toLocaleDateString('es-AR');

  // Colores del tema (igual que el xlsx de referencia)
  const HDR_BG  = '1F4E79'; // azul oscuro header
  const HDR_FG  = 'FFFFFF'; // blanco texto header
  const ALT_BG  = 'EBF3FB'; // azul muy claro filas pares
  const WHITE   = 'FFFFFF';
  const RED_BG  = 'FFE0E0';
  const GRN_BG  = 'E2EFDA';
  const YEL_BG  = 'FFF2CC';

  const hdrStyle = { font:{ bold:true, color:{rgb:HDR_FG}, sz:11 }, fill:{fgColor:{rgb:HDR_BG}}, alignment:{horizontal:'center',vertical:'center'}, border:{bottom:{style:'medium',color:{rgb:'FFFFFF'}}} };
  const titleStyle = { font:{ bold:true, color:{rgb:HDR_FG}, sz:13 }, fill:{fgColor:{rgb:HDR_BG}}, alignment:{horizontal:'left',vertical:'center'} };

  function applyStyle(ws, ref, style) {
    if (!ws[ref]) ws[ref] = { t:'s', v:'' };
    ws[ref].s = style;
  }

  function buildSheet(title, headers, rows, colorFn) {
    // Fila 1: título
    const aoa = [[title], [], headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Estilos
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    // Fila 1 — título
    for (let c = range.s.c; c <= Math.max(headers.length-1, range.e.c); c++) {
      const ref = XLSX.utils.encode_cell({r:0, c});
      applyStyle(ws, ref, titleStyle);
    }
    // Fila 3 (índice 2) — cabeceras
    headers.forEach((_, c) => {
      const ref = XLSX.utils.encode_cell({r:2, c});
      applyStyle(ws, ref, hdrStyle);
    });
    // Filas de datos
    rows.forEach((row, ri) => {
      const rowBg = colorFn ? colorFn(row, ri) : (ri%2===0 ? ALT_BG : WHITE);
      row.forEach((_, ci) => {
        const ref = XLSX.utils.encode_cell({r:ri+3, c:ci});
        if (!ws[ref]) ws[ref] = { t:'s', v:'' };
        ws[ref].s = { fill:{fgColor:{rgb:rowBg}}, font:{sz:10}, alignment:{vertical:'center'}, border:{right:{style:'thin',color:{rgb:'D0D0D0'}}} };
      });
    });

    // Ancho de columnas
    const colWidths = headers.map((h, ci) => {
      let max = String(h).length + 2;
      rows.forEach(r => { if (r[ci]) max = Math.max(max, String(r[ci]).length + 2); });
      return { wch: Math.min(max, 35) };
    });
    ws['!cols'] = colWidths;

    // Merge fila 1
    if (headers.length > 1) ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:headers.length-1} }];

    // Altura filas
    ws['!rows'] = [{ hpt:24 }, { hpt:4 }, { hpt:20 }];

    return ws;
  }

  // ===== HOJA 1: CLIENTES =====
  const wsClientes = buildSheet(
    `💰 PrestControl · Clientes · ${hoy}`,
    ['ID_CLIENTE','NOMBRE','DNI','TELÉFONO','DIRECCIÓN','RIESGO','ESTADO','NOTAS'],
    clientes.map(c => [c.id, c.nombre||'', c.dni||'', c.telefono||'', c.direccion||'', c.riesgo||'', c.estado||'', c.notas||'']),
    (row, ri) => row[6]==='Activo' ? (ri%2===0 ? ALT_BG : WHITE) : (ri%2===0 ? 'F5F5F5' : WHITE)
  );
  XLSX.utils.book_append_sheet(wb, wsClientes, 'CLIENTES');

  // ===== HOJA 2: PRÉSTAMOS =====
  const wsPrestamos = buildSheet(
    `💰 PrestControl · Préstamos · ${hoy}`,
    ['ID_PRESTAMO','ID_CLIENTE','CLIENTE','FECHA','MONTO','INTERÉS_%','INTERÉS_CUOTA_%','TIPO','N_CUOTAS','TOTAL','CUOTA','GANANCIA','PRENDA','ESTADO','NOTAS'],
    prestamos.map(p => [
      p.id, p.clienteId||'', p.clienteNombre||'', fmtDate(p.fecha),
      Number(p.monto||0), Math.round(Number(p.interes||0)*100),
      p.interesPorCuota||'', p.tipo||'', p.nCuotas||0,
      Number(p.total||0), Number(p.cuota||0), Number(p.ganancia||0),
      p.prenda||'', p.estado||'', p.notas||''
    ]),
    (row, ri) => {
      const estado = row[13];
      if (estado==='Atrasado') return RED_BG;
      if (estado==='Pagado')   return GRN_BG;
      if (estado==='Cancelado') return 'F5F5F5';
      return ri%2===0 ? ALT_BG : WHITE;
    }
  );
  XLSX.utils.book_append_sheet(wb, wsPrestamos, 'PRESTAMOS');

  // ===== HOJA 3: CUOTAS =====
  const wsCuotas = buildSheet(
    `💰 PrestControl · Cuotas · ${hoy}`,
    ['ID_CUOTA','PRESTAMO','CLIENTE','N°','FECHA_VENC','MONTO','ESTADO','FECHA_PAGO','MÉTODO','NOTAS'],
    cuotas.map(c => [
      c.id, c.prestamoId||'', c.clienteNombre||'', c.nro||'',
      fmtDate(c.fechaVenc), Number(c.monto||0), c.estado||'',
      c.fechaPago ? fmtDate(c.fechaPago) : '', c.metodo||'', c.notas||''
    ]),
    (row, ri) => {
      const estado = row[6];
      if (estado==='Pagado')   return GRN_BG;
      if (estado==='Atrasado') return RED_BG;
      if (estado==='Pendiente') return ri%2===0 ? YEL_BG : 'FFFEF0';
      return ri%2===0 ? ALT_BG : WHITE;
    }
  );
  XLSX.utils.book_append_sheet(wb, wsCuotas, 'CUOTAS');

  // ===== HOJA 4: VISTA_CUOTAS (agrupada por cliente) =====
  const vRows = [];
  const clientesMap = {};
  clientes.forEach(c => { clientesMap[c.id] = c; });

  const cuotasPorCliente = {};
  cuotas.forEach(c => {
    if (!cuotasPorCliente[c.clienteNombre]) cuotasPorCliente[c.clienteNombre] = [];
    cuotasPorCliente[c.clienteNombre].push(c);
  });

  Object.entries(cuotasPorCliente).forEach(([nombre, clist]) => {
    const pagadas  = clist.filter(c=>c.estado==='Pagado').length;
    const atrasadas = clist.filter(c=>c.estado==='Atrasado').length;
    const pendientes = clist.filter(c=>c.estado==='Pendiente').length;
    const total = clist.reduce((s,c)=>s+Number(c.monto||0),0);
    const prox = clist.filter(c=>c.estado!=='Pagado').sort((a,b)=>new Date(a.fechaVenc)-new Date(b.fechaVenc))[0];
    vRows.push([`▶ ${nombre}   ✅${pagadas} ⏳${pendientes} ⚠️${atrasadas} | ${fmtMoney(total)}${prox?' | Próx:'+fmtDate(prox.fechaVenc)+' '+fmtMoney(prox.monto):''}`, '','','','','','','','','']);
    clist.sort((a,b)=>a.nro-b.nro).forEach(c => {
      vRows.push([c.id, c.prestamoId||'', nombre, c.nro||'', fmtDate(c.fechaVenc), Number(c.monto||0), c.estado||'', c.fechaPago?fmtDate(c.fechaPago):'', c.metodo||'', c.notas||'']);
    });
  });

  const wsVista = buildSheet(
    `🔍 CUOTAS POR CLIENTE · ${hoy}`,
    ['ID_CUOTA','PRÉSTAMO','CLIENTE','N°','FECHA_VENC','MONTO','ESTADO','FECHA_PAGO','MÉTODO','NOTAS'],
    vRows,
    (row, ri) => row[0]?.toString().startsWith('▶') ? HDR_BG : (row[6]==='Pagado'?GRN_BG:row[6]==='Atrasado'?RED_BG:ri%2===0?ALT_BG:WHITE)
  );
  XLSX.utils.book_append_sheet(wb, wsVista, 'VISTA_CUOTAS');

  // ===== HOJA 5: DASHBOARD =====
  const totalPrestado = prestamos.reduce((s,p)=>s+Number(p.monto||0),0);
  const totalCobrado  = cuotas.filter(c=>c.estado==='Pagado').reduce((s,c)=>s+Number(c.monto||0),0);
  const gananciaReal  = Math.max(0, totalCobrado - totalPrestado);
  const gananciaEsp   = prestamos.reduce((s,p)=>s+Number(p.ganancia||0),0);
  const atrasadas     = cuotas.filter(c=>c.estado==='Atrasado').reduce((s,c)=>s+Number(c.monto||0),0);
  const pendientes    = cuotas.filter(c=>c.estado==='Pendiente').reduce((s,c)=>s+Number(c.monto||0),0);

  const wsDash = XLSX.utils.aoa_to_sheet([
    [`📊 DASHBOARD GLOBAL · ${hoy}`],
    [],
    ['MÉTRICA','VALOR'],
    ['💵 Capital prestado (histórico)', totalPrestado],
    ['💰 Ya cobrado', totalCobrado],
    ['📈 Ganancia real', gananciaReal],
    ['📊 Ganancia proyectada', gananciaEsp],
    ['⚠️ Capital en riesgo (atrasado)', atrasadas],
    ['⏳ Pendiente de cobro', pendientes],
    [],
    ['CONTEOS',''],
    ['👥 Total clientes', clientes.filter(c=>!c._deleted).length],
    ['📋 Préstamos activos', prestamos.filter(p=>!p._deleted&&(p.estado==='Activo'||p.estado==='Atrasado')).length],
    ['✅ Préstamos pagados', prestamos.filter(p=>p.estado==='Pagado').length],
    ['🚫 Préstamos cancelados', prestamos.filter(p=>p.estado==='Cancelado').length],
  ]);
  wsDash['!cols'] = [{wch:35},{wch:20}];
  XLSX.utils.book_append_sheet(wb, wsDash, 'DASHBOARD_GLOBAL');

  // ===== HOJA 6: LOG (Bitácora) =====
  const wsLog = buildSheet(
    `📋 PrestControl · Bitácora · ${hoy}`,
    ['FECHA_HORA','USUARIO','ACCIÓN','ENTIDAD','ID_ENTIDAD','DETALLE'],
    (bitacora||[]).map(b => [
      b.fecha ? new Date(b.fecha).toLocaleString('es-AR') : '',
      currentUser||'', b.tipo||'', b.clienteId?'CLIENTE':'SISTEMA',
      b.clienteId||'', b.detalle||''
    ]).reverse(),
    (row, ri) => ri%2===0 ? ALT_BG : WHITE
  );
  XLSX.utils.book_append_sheet(wb, wsLog, 'LOG');

  // Generar blob
  const xlsxData = XLSX.write(wb, { bookType:'xlsx', type:'array', cellStyles:true });
  const blob = new Blob([xlsxData], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const fecha = new Date().toISOString().split('T')[0];
  const fileName = `PrestControl_${currentUser}_${fecha}.xlsx`;

  if (subirASheets) {
    // Subir a Google Drive como Google Sheets
    toast('☁️ Subiendo a Google Sheets...');
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        // Crear en Drive con conversión automática a Sheets
        const meta = { name: fileName.replace('.xlsx',''), mimeType: 'application/vnd.google-apps.spreadsheet' };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(meta)], {type:'application/json'}));
        form.append('file', blob);

        const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer firebase' },
          body: form
        });
        const data = await resp.json();
        if (data.webViewLink) {
          toast('✅ Google Sheets creado');
          // Abrir en nueva pestaña
          window.open(data.webViewLink, '_blank');
          await logBitacora('export', `Exportado a Google Sheets: ${data.name}`);
        } else {
          toast('⚠️ Error al subir: ' + (data.error?.message || 'Reintentá'));
        }
      };
      reader.readAsDataURL(blob);
    } catch(e) {
      toast('❌ Error: ' + e.message);
    }
  } else {
    // Descargar localmente
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    toast('✅ Excel descargado');
    await logBitacora('export', `Exportado a Excel: ${fileName}`);
  }
}

/* =====================================================
   EXCEL — IMPORTAR
===================================================== */
async function importarExcel(input) {
  const file = input.files[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') { toast('⚠️ SheetJS no disponible'); return; }

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });

      // Validar hojas mínimas
      const tieneClientes  = wb.SheetNames.some(n => n.toLowerCase().includes('cliente'));
      const tienePrestamos = wb.SheetNames.some(n => n.toLowerCase().includes('pr'));
      if (!tieneClientes && !tienePrestamos) {
        toast('❌ El Excel no tiene hojas reconocibles (Clientes / Préstamos)'); return;
      }

      let importados = { clientes: 0, prestamos: 0, cuotas: 0 };

      // Importar Clientes
      const sheetCli = wb.SheetNames.find(n => n.toLowerCase().includes('cliente'));
      if (sheetCli) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetCli]);
        for (const row of rows) {
          const id = String(row['ID'] || row['id'] || '').trim();
          if (!id) continue;
          const existing = await dbGet('clientes', id).catch(() => null);
          const cli = {
            id,
            nombre:    String(row['Nombre'] || row['nombre'] || '').trim(),
            telefono:  String(row['Teléfono'] || row['telefono'] || ''),
            direccion: String(row['Dirección'] || row['direccion'] || ''),
            riesgo:    String(row['Riesgo'] || row['riesgo'] || 'Bajo'),
            estado:    String(row['Estado'] || row['estado'] || 'Activo'),
            notas:     String(row['Notas'] || row['notas'] || ''),
            ...(existing || {})  // mantiene campos existentes no mapeados
          };
          if (!cli.nombre) continue;
          await dbPut('clientes', cli);
          importados.clientes++;
        }
      }

      // Importar Préstamos
      const sheetPre = wb.SheetNames.find(n => /pr[eé]/i.test(n));
      if (sheetPre) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetPre]);
        for (const row of rows) {
          const id = String(row['ID'] || row['id'] || '').trim();
          if (!id) continue;
          const existing = await dbGet('prestamos', id).catch(() => null);
          if (existing) continue; // No sobreescribir préstamos existentes
          const pre = {
            id,
            clienteNombre: String(row['Cliente'] || ''),
            clienteId:     String(row['ClienteID'] || row['clienteId'] || ''),
            fecha:         row['Fecha'] || new Date().toISOString(),
            monto:         Number(row['Monto ($)'] || row['monto'] || 0),
            interes:       Number(row['Interés (%)'] || row['interes'] || 0) / 100,
            nCuotas:       Number(row['Cuotas'] || row['nCuotas'] || 1),
            tipo:          String(row['Tipo'] || 'Mensual'),
            total:         Number(row['Total ($)'] || row['total'] || 0),
            cuota:         Number(row['Cuota ($)'] || row['cuota'] || 0),
            ganancia:      Number(row['Ganancia ($)'] || row['ganancia'] || 0),
            estado:        String(row['Estado'] || 'Activo'),
            notas:         String(row['Notas'] || '')
          };
          await dbPut('prestamos', pre);
          importados.prestamos++;
        }
      }

      // Importar Cuotas
      const sheetCuo = wb.SheetNames.find(n => /cuota/i.test(n));
      if (sheetCuo) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetCuo]);
        for (const row of rows) {
          const id = String(row['ID'] || row['id'] || '').trim();
          if (!id) continue;
          const existing = await dbGet('cuotas', id).catch(() => null);
          if (existing) continue;
          const cuo = {
            id,
            prestamoId:    String(row['Préstamo'] || row['prestamoId'] || ''),
            clienteId:     String(row['ClienteID'] || row['clienteId'] || ''),
            clienteNombre: String(row['Cliente'] || ''),
            nro:           Number(row['N° Cuota'] || row['nro'] || 0),
            monto:         Number(row['Monto ($)'] || row['monto'] || 0),
            fechaVenc:     row['Vencimiento'] || '',
            estado:        String(row['Estado'] || 'Pendiente'),
            fechaPago:     row['Fecha Pago'] || null,
            metodo:        String(row['Método Pago'] || '')
          };
          await dbPut('cuotas', cuo);
          importados.cuotas++;
        }
      }

      toast(`✅ Importado: ${importados.clientes} clientes, ${importados.prestamos} préstamos, ${importados.cuotas} cuotas`);
      await renderPage('dashboard');
      await updateBadges();
    } catch(err) {
      console.error(err);
      toast('❌ Error al leer el Excel. Verificá el formato.');
    }
    input.value = '';
  };
  reader.readAsArrayBuffer(file);
}

