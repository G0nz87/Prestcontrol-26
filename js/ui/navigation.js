/* =====================================================
   NAVIGATION
===================================================== */
const PAGES = ['dashboard','hoy','atrasadas','clientes','prestamos','cuotas','calendario','config','bitacora','historial','cobros'];
const NAV_PAGES = PAGES;
let curPage = 'dashboard';
let pageStack = [];

function goPage(id) {
  pageStack = [];
  closeMasMenu();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  document.getElementById('pg-' + id).classList.add('on');
  // cobros page uses nb-cobros button
  const navId = (id === 'hoy' || id === 'atrasadas') ? 'cobros' : id;
  const nb = document.getElementById('nb-' + navId);
  if (nb) nb.classList.add('on');
  curPage = id;
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('hdr-add-btn').style.display = 'none';
  updateFab(id);
  renderPage(id);
}

function goDetail(id) {
  pageStack.push(curPage);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.getElementById('pg-' + id).classList.add('on');
  curPage = id;
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('hdr-add-btn').style.display = 'none';
  document.getElementById('fab').style.display = 'none';
}

function goBack() {
  if (pageStack.length) {
    const prev = pageStack.pop();
    goPage(prev);
  }
}

function updateFab(id) {
  const fab = document.getElementById('fab');
  if (['clientes','prestamos'].includes(id)) {
    fab.style.display = 'flex';
  } else {
    fab.style.display = 'none';
  }
}
function openFab() {
  if (curPage === 'clientes') openSheetCliente();
  else if (curPage === 'prestamos') openSheetPrestamo();
}

function updateHdrDate() {
  const d = new Date();
  document.getElementById('hdr-sub').textContent =
    d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
}

/* =====================================================
   SHEETS (modals)
===================================================== */
let activeSheet = null;

function openSheet(id) {
  closeSheet();
  activeSheet = id;
  document.getElementById('overlay').classList.add('on');
  document.getElementById(id).classList.add('on');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  if (activeSheet) {
    document.getElementById(activeSheet)?.classList.remove('on');
    activeSheet = null;
  }
  document.getElementById('overlay')?.classList.remove('on');
  // Cerrar también el sheet de comprobante
  document.getElementById('sheet-comprobante')?.classList.remove('on');
  document.getElementById('overlay-comprobante')?.classList.remove('on');
  document.body.style.overflow = '';
}

