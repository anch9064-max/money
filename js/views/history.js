// Экран «Операции»: список по дням, фильтры, поиск.
import * as S from '../store.js';
import { esc, money, dayLabel, monthKey, monthLabel } from '../utils.js';
import { openTxSheet } from './txSheet.js';

export const filters = { type: 'all', query: '', categoryId: null, month: null };

export function txRow(t) {
  let icon, title, sub, amt, cls = '';
  const acc = S.account(t.accountId);
  if (t.type === 'transfer') {
    const to = S.account(t.toAccountId);
    icon = '⇄';
    title = 'Перевод';
    sub = `${acc?.name || '?'} → ${to?.name || '?'}`;
    amt = money(t.amount);
  } else {
    const c = S.category(t.categoryId);
    icon = c?.icon || '❔';
    title = c?.name || 'Без категории';
    sub = [t.note, acc?.name].filter(Boolean).join(' · ');
    amt = t.type === 'income' ? money(t.amount, { sign: true }) : money(-t.amount);
    if (t.type === 'income') cls = 'plus';
  }
  return `<button class="row" data-tx="${t.id}">
    <span class="ico">${icon}</span>
    <span class="main"><div class="t1">${esc(title)}${t.subId ? ' <span class="muted small">🔁</span>' : ''}</div>
      ${sub ? `<div class="t2">${esc(sub)}</div>` : ''}</span>
    <span class="amt ${cls}">${amt}</span>
  </button>`;
}

export function bindTxRows(root) {
  root.querySelectorAll('[data-tx]').forEach((el) => el.addEventListener('click', () => {
    const tx = S.state.transactions.find((t) => t.id === el.dataset.tx);
    if (tx) openTxSheet({ tx });
  }));
}

export function renderHistory(view) {
  view.innerHTML = `
    <input class="search" type="search" placeholder="Поиск по комментарию, категории, сумме" value="${esc(filters.query)}">
    <div class="chips-slot"></div>
    <div class="list-slot"></div>`;
  const search = view.querySelector('.search');
  search.addEventListener('input', () => { filters.query = search.value; renderList(view); });
  renderList(view);
}

function renderList(view) {
  const q = filters.query.trim().toLowerCase();
  const cat = filters.categoryId && S.category(filters.categoryId);
  const list = S.sortedTransactions().filter((t) => {
    if (filters.type !== 'all' && t.type !== filters.type) return false;
    if (filters.categoryId && t.categoryId !== filters.categoryId) return false;
    if (filters.month && monthKey(t.date) !== filters.month) return false;
    if (q) {
      const c = S.category(t.categoryId);
      const hay = `${t.note || ''} ${c?.name || ''} ${S.account(t.accountId)?.name || ''} ${(t.amount / 100)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const shown = list.slice(0, 400);
  const groups = [];
  for (const t of shown) {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
  }
  const dayTotal = (items) => items.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);

  const chip = (k, l) => `<button class="chip ${filters.type === k ? 'on' : ''}" data-ftype="${k}">${l}</button>`;
  view.querySelector('.chips-slot').innerHTML = `<div class="chips">
      ${chip('all', 'Все')}${chip('expense', 'Расходы')}${chip('income', 'Доходы')}${chip('transfer', 'Переводы')}
      ${cat ? `<button class="chip on" data-clear="cat">${cat.icon} ${esc(cat.name)} ✕</button>` : ''}
      ${filters.month ? `<button class="chip on" data-clear="month">${monthLabel(filters.month)} ✕</button>` : ''}
    </div>`;
  const slot = view.querySelector('.list-slot');
  slot.innerHTML = `
    ${groups.length ? groups.map((g) => {
      const tot = dayTotal(g.items);
      return `<div class="day-head"><span>${dayLabel(g.date)}</span><span class="num">${tot ? money(tot, { sign: true }) : ''}</span></div>
        <div class="list">${g.items.map(txRow).join('')}</div>`;
    }).join('') : `<div class="empty">${S.state.transactions.length ? 'Ничего не найдено' : 'Здесь появятся твои операции.<br>Нажми «+», чтобы добавить первую.'}</div>`}
    ${list.length > shown.length ? `<div class="empty small">Показаны последние ${shown.length} из ${list.length}. Уточни поиск.</div>` : ''}`;

  view.querySelectorAll('[data-ftype]').forEach((b) => b.onclick = () => { filters.type = b.dataset.ftype; renderList(view); });
  view.querySelectorAll('[data-clear]').forEach((b) => b.onclick = () => {
    if (b.dataset.clear === 'cat') filters.categoryId = null; else filters.month = null;
    renderList(view);
  });
  bindTxRows(slot);
}
