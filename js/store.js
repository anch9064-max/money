// Состояние приложения: загружаем всё из IndexedDB в память, меняем через функции ниже.
import * as db from './db.js';
import { uid, today, monthKey, nextDate } from './utils.js';

// Фото чеков в память не грузим — берём из базы по требованию
const MEMORY_STORES = db.STORES.filter((s) => s !== 'photos');

export const state = {
  accounts: [], categories: [], transactions: [], budgets: [], subscriptions: [], meta: [], debts: [],
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

// ----- Начальные данные -----
const DEFAULT_ACCOUNTS = [
  { name: 'Карта', icon: '💳' },
  { name: 'Наличные', icon: '💵' },
];
const DEFAULT_CATEGORIES = [
  ['expense', 'Продукты', '🛒'], ['expense', 'Кафе', '☕'], ['expense', 'Транспорт', '🚌'],
  ['expense', 'Жильё', '🏠'], ['expense', 'Связь', '📱'], ['expense', 'Здоровье', '💊'],
  ['expense', 'Одежда', '👕'], ['expense', 'Развлечения', '🎮'], ['expense', 'Подарки', '🎁'],
  ['expense', 'Подписки', '🔁'], ['expense', 'Переводы', '🔄'], ['expense', 'Другое', '📦'],
  ['income', 'Зарплата', '💼'], ['income', 'Подработка', '💻'], ['income', 'Кэшбэк', '💸'],
  ['income', 'Подарки', '🎁'], ['income', 'Переводы', '🔄'], ['income', 'Другое', '💰'],
];

export async function init() {
  for (const name of MEMORY_STORES) state[name] = await db.getAll(name);
  if (!getMeta('seeded')) {
    const accounts = DEFAULT_ACCOUNTS.map((a, i) => ({ id: uid(), ...a, initial: 0, order: i, archived: false, currency: 'RUB', kind: 'regular' }));
    const categories = DEFAULT_CATEGORIES.map(([type, name, icon], i) => ({ id: uid(), type, name, icon, order: i, archived: false }));
    await db.put('accounts', ...accounts);
    await db.put('categories', ...categories);
    state.accounts = accounts;
    state.categories = categories;
    await setMeta('seeded', true);
  }
  await runSubscriptions();
  try { await navigator.storage?.persist?.(); } catch { /* не критично */ }
}

// ----- meta -----
export function getMeta(key) { return state.meta.find((m) => m.id === key)?.value; }
export async function setMeta(key, value) {
  const item = { id: key, value };
  await db.put('meta', item);
  state.meta = state.meta.filter((m) => m.id !== key).concat(item);
}

// ----- Универсальные операции -----
async function save(store, item, silent) {
  await db.put(store, item);
  const list = state[store];
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  if (!silent) emit();
  return item;
}
async function del(store, id) {
  await db.remove(store, id);
  state[store] = state[store].filter((x) => x.id !== id);
  emit();
}

// ===== Валюты и курсы ЦБ =====
export function rates() { return getMeta('rates')?.map || {}; }
export function rateOf(cur) {
  if (!cur || cur === 'RUB') return 1;
  return rates()[cur] ?? null;
}
/** Перевести сумму в рубли. Если курса нет — null. */
export function toRub(kop, cur) {
  const r = rateOf(cur);
  return r == null ? null : Math.round(kop * r);
}
export function usedCurrencies() {
  return [...new Set(state.accounts.filter((a) => !a.archived).map((a) => a.currency || 'RUB'))].filter((c) => c !== 'RUB');
}
/** Обновить курсы, если есть валютные счета и курсы старше 6 часов. */
export async function refreshRates(force = false) {
  if (!usedCurrencies().length && !force) return false;
  const cur = getMeta('rates');
  if (!force && cur && Date.now() - cur.fetchedAt < 6 * 3600e3) return false;
  try {
    const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { cache: 'no-store' });
    const j = await res.json();
    const map = {};
    for (const [code, v] of Object.entries(j.Valute || {})) map[code] = v.Value / v.Nominal;
    await setMeta('rates', { map, date: j.Date, fetchedAt: Date.now() });
    emit();
    return true;
  } catch {
    return false; // нет интернета — используем сохранённые курсы
  }
}

const accCur = (id) => account(id)?.currency || 'RUB';
/** Сумма операции в рублях (по валюте её счёта). */
export function txRub(t) { return toRub(t.amount, accCur(t.accountId)) ?? 0; }

// ----- Транзакции -----
export function saveTransaction(t) {
  return save('transactions', { createdAt: Date.now(), ...t, id: t.id || uid() });
}
export async function saveTransactions(list) {
  const items = list.map((t) => ({ createdAt: Date.now(), ...t, id: t.id || uid() }));
  await db.put('transactions', ...items);
  state.transactions.push(...items);
  emit();
  return items;
}
/** Удаляет операцию и возвращает её (для «Отменить»). */
export async function deleteTransaction(id) {
  const t = state.transactions.find((x) => x.id === id);
  await del('transactions', id);
  return t;
}
export async function restoreTransaction(t) { return save('transactions', t); }

// ----- Счета и копилки -----
export function saveAccount(a) {
  return save('accounts', { initial: 0, archived: false, order: state.accounts.length, currency: 'RUB', kind: 'regular', ...a, id: a.id || uid() });
}
export function accountUsed(id) { return state.transactions.some((t) => t.accountId === id || t.toAccountId === id); }
export async function deleteAccount(id) {
  if (accountUsed(id)) {
    const a = state.accounts.find((x) => x.id === id);
    return save('accounts', { ...a, archived: true });
  }
  return del('accounts', id);
}

// ----- Категории -----
export function saveCategory(c) {
  return save('categories', { archived: false, order: state.categories.length, ...c, id: c.id || uid() });
}
export async function ensureCategory(type, name, icon) {
  const c = state.categories.find((x) => x.type === type && x.name === name && !x.archived);
  return c || saveCategory({ type, name, icon });
}
export async function deleteCategory(id) {
  const used = state.transactions.some((t) => t.categoryId === id) || state.subscriptions.some((s) => s.categoryId === id);
  const budgets = state.budgets.filter((b) => b.categoryId === id);
  for (const b of budgets) await db.remove('budgets', b.id);
  state.budgets = state.budgets.filter((b) => b.categoryId !== id);
  if (used) {
    const c = state.categories.find((x) => x.id === id);
    return save('categories', { ...c, archived: true });
  }
  return del('categories', id);
}

// ----- Запоминание категорий (магазин/комментарий → категория) -----
export function normKey(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/gi, ' ')
    .replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
export async function learnCategory(text, categoryId) {
  const k = normKey(text);
  if (!k || !categoryId) return;
  const rules = { ...(getMeta('catRules') || {}) };
  if (rules[k] === categoryId) return;
  rules[k] = categoryId;
  await setMeta('catRules', rules);
}
/** Подобрать категорию по тексту: сначала выученные правила, потом прошлые операции с тем же комментарием. */
export function suggestCategory(text, type) {
  const k = normKey(text);
  if (!k) return null;
  const ok = (id) => { const c = category(id); return c && !c.archived && c.type === type ? id : null; };
  const rules = getMeta('catRules') || {};
  if (rules[k] && ok(rules[k])) return rules[k];
  for (const [rk, id] of Object.entries(rules)) if (rk.length >= 4 && (k.includes(rk) || rk.includes(k)) && ok(id)) return id;
  const prev = sortedTransactions().find((t) => t.type === type && t.note && normKey(t.note) === k && ok(t.categoryId));
  return prev ? prev.categoryId : null;
}

// ----- Бюджеты -----
export function saveBudget(b) { return save('budgets', { ...b, id: b.id || uid() }); }
export const deleteBudget = (id) => del('budgets', id);

// ----- Регулярные платежи -----
export async function saveSubscription(s) {
  const item = await save('subscriptions', { active: true, ...s, id: s.id || uid() });
  await runSubscriptions();
  return item;
}
export const deleteSubscription = (id) => del('subscriptions', id);

export async function runSubscriptions() {
  const t = today();
  let created = 0;
  for (const s of state.subscriptions) {
    if (!s.active) continue;
    let guard = 0;
    const tx = [];
    while (s.nextDate <= t && guard++ < 120) {
      tx.push({
        id: uid(), type: s.type || 'expense', amount: s.amount, accountId: s.accountId,
        categoryId: s.categoryId, date: s.nextDate, note: s.name, subId: s.id, createdAt: Date.now(),
      });
      s.nextDate = nextDate(s.nextDate, s.period, s.anchorDay);
    }
    if (tx.length) {
      await db.put('transactions', ...tx);
      await db.put('subscriptions', s);
      state.transactions.push(...tx);
      created += tx.length;
    }
  }
  if (created) emit();
  return created;
}

// ----- Долги -----
export function saveDebt(d) { return save('debts', { closed: false, ...d, id: d.id || uid() }); }
export async function deleteDebt(id) {
  const txs = state.transactions.filter((t) => t.debtId === id).map((t) => t.id);
  if (txs.length) await db.remove('transactions', ...txs);
  state.transactions = state.transactions.filter((t) => t.debtId !== id);
  await del('debts', id);
}
export function debtPaid(d) {
  // «возвраты»: по моему займу деньги приходят (in), по взятому — уходят (out)
  const back = d.direction === 'lent' ? 'in' : 'out';
  return state.transactions.filter((t) => t.debtId === d.id && t.flow === back && !t.debtStart)
    .reduce((s, t) => s + t.amount, 0) + (d.paidOffline || 0);
}
export const debtLeft = (d) => Math.max(0, d.amount - debtPaid(d));

// ----- Фото чеков -----
export async function savePhoto(blob) {
  const id = uid();
  await db.put('photos', { id, blob, createdAt: Date.now() });
  return id;
}
export async function getPhoto(id) { return (await db.get('photos', id))?.blob || null; }
export async function deletePhoto(id) { await db.remove('photos', id); }

// ----- Выборки -----
export const regularAccounts = () => state.accounts.filter((a) => !a.archived && a.kind !== 'goal').sort((a, b) => a.order - b.order);
export const goalAccounts = () => state.accounts.filter((a) => !a.archived && a.kind === 'goal').sort((a, b) => a.order - b.order);
export const activeAccounts = () => state.accounts.filter((a) => !a.archived).sort((a, b) =>
  ((a.kind === 'goal') - (b.kind === 'goal')) || a.order - b.order);
export const activeCategories = (type) =>
  state.categories.filter((c) => !c.archived && (!type || c.type === type)).sort((a, b) => a.order - b.order);
export const category = (id) => state.categories.find((c) => c.id === id);
export const account = (id) => state.accounts.find((a) => a.id === id);

/** Баланс счёта в его собственной валюте. */
export function accountBalance(id) {
  const a = account(id);
  let bal = a?.initial || 0;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === id) bal += t.amount;
    else if (t.type === 'expense' && t.accountId === id) bal -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === id) bal -= t.amount;
      if (t.toAccountId === id) bal += t.toAmount ?? t.amount;
    } else if (t.type === 'debt' && t.accountId === id) {
      bal += t.flow === 'in' ? t.amount : -t.amount;
    }
  }
  return bal;
}
/** Общий баланс в рублях. missing — есть ли счета без курса. */
export function totalBalance({ goals = true } = {}) {
  let sum = 0, missing = false;
  for (const a of state.accounts) {
    if (a.archived || (!goals && a.kind === 'goal')) continue;
    const r = toRub(accountBalance(a.id), a.currency);
    if (r == null) missing = true; else sum += r;
  }
  return { sum, missing };
}

const counts = (t) => t.type === 'income' || t.type === 'expense';

export function monthTotals(key) {
  let income = 0, expense = 0;
  for (const t of state.transactions) {
    if (!counts(t) || monthKey(t.date) !== key) continue;
    if (t.type === 'income') income += txRub(t); else expense += txRub(t);
  }
  return { income, expense };
}

/** Сумма расходов по категориям за период [from, to] (даты ISO включительно). */
export function byCategoryRange(from, to, type = 'expense') {
  const map = new Map();
  for (const t of state.transactions) {
    if (t.type !== type || t.date < from || t.date > to) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + txRub(t));
  }
  return map;
}
export function byCategory(key, type = 'expense') {
  const map = byCategoryRange(`${key}-01`, `${key}-31`, type);
  return [...map.entries()]
    .map(([id, sum]) => ({ category: category(id) || { name: 'Без категории', icon: '❔' }, id, sum }))
    .sort((a, b) => b.sum - a.sum);
}

export function spentInCategory(categoryId, key) {
  let s = 0;
  for (const t of state.transactions) {
    if (t.type === 'expense' && t.categoryId === categoryId && monthKey(t.date) === key) s += txRub(t);
  }
  return s;
}

/** Расходы по дням месяца: Map('YYYY-MM-DD' → рубли в копейках) */
export function dailyExpenses(key) {
  const map = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense' || monthKey(t.date) !== key) continue;
    map.set(t.date, (map.get(t.date) || 0) + txRub(t));
  }
  return map;
}

export function sortedTransactions() {
  return [...state.transactions].sort((a, b) =>
    (b.date.localeCompare(a.date)) || ((b.time || '').localeCompare(a.time || '')) || (b.createdAt - a.createdAt));
}

/** Частые операции для шаблонов «в один тап». */
export function frequentTemplates(type, limit = 6) {
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const map = new Map();
  for (const t of state.transactions) {
    if (t.type !== type || t.date < since || !t.categoryId || t.subId) continue;
    const c = category(t.categoryId);
    if (!c || c.archived) continue;
    const key = `${t.categoryId}|${t.amount}|${normKey(t.note)}`;
    const e = map.get(key) || { categoryId: t.categoryId, amount: t.amount, note: t.note || '', accountId: t.accountId, n: 0, last: '' };
    e.n++;
    if (t.date > e.last) { e.last = t.date; e.accountId = t.accountId; }
    map.set(key, e);
  }
  return [...map.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, limit);
}

// ----- Бэкап -----
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
export async function exportData({ photos = true } = {}) {
  const out = { app: 'money-tracker', version: 2, exportedAt: new Date().toISOString() };
  for (const name of MEMORY_STORES) out[name] = state[name];
  out.meta = state.meta.filter((m) => !['pinHash', 'pinSalt', 'faceId'].includes(m.id));
  out.photos = [];
  if (photos) {
    for (const p of await db.getAll('photos')) out.photos.push({ id: p.id, createdAt: p.createdAt, data: await blobToDataURL(p.blob) });
  }
  return out;
}
export async function importData(data) {
  if (!data || data.app !== 'money-tracker' || !Array.isArray(data.transactions)) {
    throw new Error('Это не файл резервной копии «Мои деньги»');
  }
  const keepMeta = state.meta.filter((m) => ['pinHash', 'pinSalt', 'faceId', 'onboarded'].includes(m.id));
  const photos = [];
  for (const p of data.photos || []) {
    try { photos.push({ id: p.id, createdAt: p.createdAt, blob: await (await fetch(p.data)).blob() }); } catch { /* пропускаем битое фото */ }
  }
  const full = { ...data, photos, meta: [...(data.meta || []).filter((m) => !keepMeta.some((k) => k.id === m.id)), ...keepMeta] };
  await db.replaceAll(full);
  for (const name of MEMORY_STORES) state[name] = full[name] || [];
  if (!getMeta('seeded')) await setMeta('seeded', true);
  await runSubscriptions();
  emit();
}
