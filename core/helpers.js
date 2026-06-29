export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) { const d = new Date(v); d.setHours(0,0,0,0); return d; }
  const d = new Date(v); d.setHours(0,0,0,0); return isNaN(d) ? null : d;
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = parseDate(d);
  if (!dt) return '';
  return dt.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

export function fmtMoney(n) {
  return '$' + Number(n||0).toLocaleString('es-AR', { minimumFractionDigits:0, maximumFractionDigits:0 });
}

export function round2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }

export function addMonths(date, n) {
  const d = new Date(date), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, last)); return d;
}

export function addWeeks(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + 7*n); return d;
}

export function calcVenc(base, tipo, i) {
  return tipo === 'Semanal' ? addWeeks(base, i) : addMonths(base, i);
}

export function nextId(prefix, list) {
  const nums = list.map(x => {
    const m = String(x.id||'').match(new RegExp(`^${prefix}-(\\d+)$`));
    return m ? parseInt(m[1]) : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max+1).padStart(3,'0')}`;
}

export function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

Object.assign(window, {
  uid,
  today,
  parseDate,
  fmtDate,
  fmtMoney,
  round2,
  addMonths,
  addWeeks,
  calcVenc,
  nextId,
  esc
});
