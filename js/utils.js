// Форматирование, даты и мелкие помощники для DOM.

const rub0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const rub2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rub = { format: (v) => (Number.isInteger(Math.round(v * 100) / 100) ? rub0 : rub2).format(v) };

export const CURRENCIES = {
  RUB: { sym: '₽', name: 'Рубль' }, USD: { sym: '$', name: 'Доллар США' }, EUR: { sym: '€', name: 'Евро' },
  CNY: { sym: '¥', name: 'Юань' }, KZT: { sym: '₸', name: 'Тенге' }, BYN: { sym: 'Br', name: 'Белорусский рубль' },
  TRY: { sym: '₺', name: 'Турецкая лира' }, AMD: { sym: '֏', name: 'Драм' }, GEL: { sym: '₾', name: 'Лари' },
  AED: { sym: 'AED', name: 'Дирхам ОАЭ' }, THB: { sym: '฿', name: 'Бат' }, UZS: { sym: 'сум', name: 'Узбекский сум' },
  KGS: { sym: 'сом', name: 'Киргизский сом' }, GBP: { sym: '£', name: 'Фунт' }, JPY: { sym: '¥', name: 'Иена' },
};
export const curSym = (cur) => CURRENCIES[cur || 'RUB']?.sym || cur;

/** Суммы храним в копейках (целые числа), чтобы не было ошибок округления. */
export function money(kop, { sign = false, cur = 'RUB' } = {}) {
  const v = kop / 100;
  const s = rub.format(Math.abs(v)) + '\u00a0' + curSym(cur);
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
/** Всплывающее сообщение. action = { label, onClick } — например, «Отменить». */
export function toast(text, ms = 2200, action) {
  const el = document.getElementById('toast');
  el.innerHTML = '';
  el.append(document.createTextNode(text));
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove('show'); action.onClick(); };
    el.append(b);
    ms = Math.max(ms, 5000);
  }
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Простой хэш строки (для ключей дублей) */
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function vibrate() { try { navigator.vibrate?.(10); } catch { /* iOS не поддерживает */ } }
