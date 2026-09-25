// Состояние приложения: загружаем всё из IndexedDB в память, меняем через функции ниже.
import * as db from './db.js';
import { uid, today, monthKey, nextDate } from './utils.js';

export const state = {
  accounts: [],
  categories: [],
  transactions: [],
  budgets: [],
  subscriptions: [],
  meta: [],
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

// ----- Начальные данные -----
const DEFAULT_ACCOUNTS = [
  { name: 'Карта', icon: '💳' },
  { name: 'Наличные', icon: '💵' },
];
const DEFAULT_CATEGORIES = [
  ['expense', 'Продукты', '🛒'], ['expense', 'Кафе', '☕'], ['expense', 'Транспорт', '🚌'],
  ['expense', 'Жильё', '🏠'], ['expense', 'Связь', '📱'], ['expense', 'Здоровье', '💊'],
  ['expense', 'Одежда', '👕'], ['expense', 'Развлечения', '🎮'], ['expense', 'Подарки', '🎁'],
  ['expense', 'Подписки', '🔁'], ['expense', 'Другое', '📦'],
  ['income', 'Зарплата', '💼'], ['income', 'Подработка', '💻'], ['income', 'Кэшбэк', '💸'],
  ['income', 'Подарки', '🎁'], ['income', 'Другое', '💰'],
];

export async function init() {
  for (const name of db.STORES) state[name] = await db.getAll(name);
  if (!getMeta('seeded')) {
    const accounts = DEFAULT_ACCOUNTS.map((a, i) => ({ id: uid(), ...a, initial: 0, order: i, archived: false }));
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
async function save(store, item) {
  await db.put(store, item);
  const list = state[store];
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  emit();
  return item;
}
async function del(store, id) {
  await db.remove(store, id);
  state[store] = state[store].filter((x) => x.id !== id);
  emit();
}

// ----- Транзакции -----
export function saveTransaction(t) {
  return save('transactions', { createdAt: Date.now(), ...t, id: t.id || uid() });
}
export const deleteTransaction = (id) => del('transactions', id);

// ----- Счета -----
export function saveAccount(a) {
  return save('accounts', { initial: 0, archived: false, order: state.accounts.length, ...a, id: a.id || uid() });
}
export function accountUsed(id) { return state.transactions.some((t) => t.accountId === id || t.toAccountId === id); }
export async function deleteAccount(id) {
  // Если по счёту есть операции — архивируем, чтобы не потерять историю.
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

// ----- Бюджеты -----
export function saveBudget(b) { return save('budgets', { ...b, id: b.id || uid() }); }
export const deleteBudget = (id) => del('budgets', id);

// ----- Подписки / регулярные платежи -----
export async function saveSubscription(s) {
  const item = await save('subscriptions', { active: true, ...s, id: s.id || uid() });
  await runSubscriptions();
  return item;
}
export const deleteSubscription = (id) => del('subscriptions', id);

/** Создаёт операции для всех наступивших платежей и двигает дату следующего. */
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

// ----- Выборки -----
export const activeAccounts = () => state.accounts.filter((a) => !a.archived).sort((a, b) => a.order - b.order);
export const activeCategories = (type) =>
  state.categories.filter((c) => !c.archived && (!type || c.type === type)).sort((a, b) => a.order - b.order);
export const category = (id) => state.categories.find((c) => c.id === id);
export const account = (id) => state.accounts.find((a) => a.id === id);

export function accountBalance(id) {
  const a = account(id);
  let bal = a?.initial || 0;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === id) bal += t.amount;
    else if (t.type === 'expense' && t.accountId === id) bal -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === id) bal -= t.amount;
      if (t.toAccountId === id) bal += t.amount;
    }
  }
  return bal;
}
export function totalBalance() {
  return state.accounts.filter((a) => !a.archived).reduce((s, a) => s + accountBalance(a.id), 0);
}

export function monthTotals(key) {
  let income = 0, expense = 0;
  for (const t of state.transactions) {
    if (monthKey(t.date) !== key) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense };
}

/** Расходы (или доходы) по категориям за месяц, по убыванию. */
export function byCategory(key, type = 'expense') {
  const map = new Map();
  for (const t of state.transactions) {
    if (t.type !== type || monthKey(t.date) !== key) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  }
  return [...map.entries()]
    .map(([id, sum]) => ({ category: category(id) || { name: 'Без категории', icon: '❔' }, id, sum }))
    .sort((a, b) => b.sum - a.sum);
}

export function spentInCategory(categoryId, key) {
  let s = 0;
  for (const t of state.transactions) {
    if (t.type === 'expense' && t.categoryId === categoryId && monthKey(t.date) === key) s += t.amount;
  }
  return s;
}

export function sortedTransactions() {
  return [...state.transactions].sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt));
}

// ----- Бэкап -----
export function exportData() {
  const out = { app: 'money-tracker', version: 1, exportedAt: new Date().toISOString() };
  for (const name of db.STORES) out[name] = state[name];
  return out;
}
export async function importData(data) {
  if (!data || data.app !== 'money-tracker' || !Array.isArray(data.transactions)) {
    throw new Error('Это не файл резервной копии «Мои деньги»');
  }
  await db.replaceAll(data);
  for (const name of db.STORES) state[name] = data[name] || [];
  if (!getMeta('seeded')) await setMeta('seeded', true);
  await runSubscriptions();
  emit();
}
