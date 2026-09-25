// Форматирование, даты и мелкие помощники для DOM.

const rub0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const rub2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rub = { format: (v) => (Number.isInteger(Math.round(v * 100) / 100) ? rub0 : rub2).format(v) };

/** Суммы храним в копейках (целые числа), чтобы не было ошибок округления. */
export function money(kop, { sign = false } = {}) {
  const v = kop / 100;
  const s = rub.format(Math.abs(v)) + ' ₽';
  if (v < 0) return '−' + s;
  if (sign && v > 0) return '+' + s;
  return s;
}

/** Короткий формат для осей графиков: 12,5 тыс., 1,2 млн */
export function moneyShort(kop) {
  const v = Math.abs(kop / 100);
  if (v >= 1e6) return (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн';
  if (v >= 1e3) return (v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' тыс';
  return Math.round(v).toLocaleString('ru-RU');
}

export function parseAmount(str) {
  const n = parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

// ----- Даты (строки YYYY-MM-DD в локальном времени) -----
const pad = (n) => String(n).padStart(2, '0');
export function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function today() { return toISO(new Date()); }
export function monthKey(iso) { return iso.slice(0, 7); }
export function currentMonth() { return today().slice(0, 7); }
export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const cur = currentMonth().slice(0, 4);
  return MONTHS[m - 1] + (String(y) === cur ? '' : ' ' + y);
}
export function monthShort(key) { return MONTHS_SHORT[Number(key.slice(5, 7)) - 1]; }

export function dayLabel(iso) {
  const t = today();
  const y = toISO(new Date(Date.now() - 864e5));
  if (iso === t) return 'Сегодня';
  if (iso === y) return 'Вчера';
  const d = fromISO(iso);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear();
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${year}, ${WEEKDAYS[d.getDay()]}`;
}
export function shortDate(iso) {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** Следующая дата для регулярного платежа. День месяца сохраняется (31 → последний день месяца). */
export function nextDate(iso, period, anchorDay) {
  const d = fromISO(iso);
  if (period === 'week') { d.setDate(d.getDate() + 7); return toISO(d); }
  const day = anchorDay || d.getDate();
  const addM = period === 'year' ? 12 : 1;
  const target = new Date(d.getFullYear(), d.getMonth() + addM, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toISO(target);
}

// ----- DOM -----
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let toastTimer;
export function toast(text, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function vibrate() { try { navigator.vibrate?.(10); } catch { /* iOS не поддерживает */ } }
