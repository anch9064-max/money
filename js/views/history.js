// Экран «Операции»: список по дням или календарь, фильтры, поиск, смахивание для удаления.
import * as S from '../store.js';
import { esc, money, dayLabel, monthKey, monthLabel, shiftMonth, currentMonth, daysInMonth, today, moneyShort } from '../utils.js';
import { openTxSheet, removeWithUndo } from './txSheet.js';
import { openDebtSheet } from './debts.js';

export const filters = { type: 'all', query: '', categoryId: null, month: null, view: 'list', calMonth: null, day: null };

export function txRow(t) {
  let icon, title, sub, amt, cls = '';
  const acc = S.account(t.accountId);
  const cur = acc?.currency;
  if (t.type === 'transfer') {
    const to = S.account(t.toAccountId);
    icon = to?.kind === 'goal' ? to.icon : acc?.kind === 'goal' ? acc.icon : '⇄';
    title = to?.kind === 'goal' ? 'В копилку' : acc?.kind === 'goal' ? 'Из копилки' : 'Перевод';
    sub = `${acc?.name || '?'} → ${to?.name || '?'}`;
    amt = money(t.amount, { cur });
  } else if (t.type === 'debt') {
    const d = S.state.debts.find((x) => x.id === t.debtId);
    icon = '🤝';
    title = t.debtStart ? (d?.direction === 'lent' ? 'Дал в долг' : 'Взял в долг') : 'Возврат долга';
    sub = [d?.person, acc?.name].filter(Boolean).join(' · ');
    amt = money(t.flow === 'in' ? t.amount : -t.amount, { sign: true });
    if (t.flow === 'in') cls = 'plus';
  } else {
    const c = S.category(t.categoryId);
    icon = c?.icon || '❔';
    title = c?.name || 'Без категории';
    sub = [t.note, acc?.name].filter(Boolean).join(' · ');
    amt = t.type === 'income' ? money(t.amount, { sign: true, cur }) : money(-t.amount, { cur });
    if (t.type === 'income') cls = 'plus';
  }
  const badges = (t.subId ? ' 🔁' : '') + (t.receipt ? ' 🧾' : '') + (t.photoId ? ' 🖼' : '');
  return `<div class="swipe" data-swipe="${t.id}">
    <button class="swipe-del" data-del="${t.id}" tabindex="-1">Удалить</button>
    <button class="row" data-tx="${t.id}">
      <span class="ico">${icon}</span>
      <span class="main"><div class="t1">${esc(title)}<span class="muted small">${badges}</span></div>
        ${sub ? `<div class="t2">${esc(sub)}</div>` : ''}</span>
      <span class="amt ${cls}">${amt}</span>
    </button></div>`;
}

/** Нажатие — открыть операцию, смахивание влево — показать «Удалить». */
export function bindTxRows(root) {
  root.querySelectorAll('[data-tx]').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.swiped) { delete el.dataset.swiped; return; }
    const tx = S.state.transactions.find((t) => t.id === el.dataset.tx);
    if (!tx) return;
    if (tx.type === 'debt') {
      const d = S.state.debts.find((x) => x.id === tx.debtId);
      if (d) openDebtSheet(d);
    } else openTxSheet({ tx });
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const tx = S.state.transactions.find((t) => t.id === b.dataset.del);
    if (tx?.type === 'debt') { const d = S.state.debts.find((x) => x.id === tx.debtId); if (d) openDebtSheet(d); return; }
    removeWithUndo(b.dataset.del);
  }));
  const W = 88;
  let open = null;
  root.querySelectorAll('.swipe').forEach((sw) => {
    const row = sw.querySelector('.row');
    let x0 = 0, y0 = 0, dx = 0, dragging = false, decided = false, base = 0;
    row.addEventListener('touchstart', (e) => {
      if (open && open !== row) { open.style.transform = ''; open = null; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; dragging = false; decided = false;
      base = row.style.transform ? -W : 0;
      row.style.transition = 'none';
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!decided) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; decided = true; dragging = Math.abs(mx) > Math.abs(my); }
      if (!dragging) return;
      dx = Math.min(0, Math.max(-W * 1.4, base + mx));
      row.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    row.addEventListener('touchend', () => {
      row.style.transition = '';
      if (!dragging) return;
      row.dataset.swiped = '1';
      setTimeout(() => delete row.dataset.swiped, 350);
      if (dx < -W / 2) { row.style.transform = `translateX(${-W}px)`; open = row; if (!S.getMeta('swipeHintShown')) S.setMeta('swipeHintShown', true); }
      else { row.style.transform = ''; if (open === row) open = null; }
    });
  });
}

export function renderHistory(view) {
  view.innerHTML = `
    <div class="seg view-seg"><button type="button" data-v="list" class="${filters.view === 'list' ? 'on' : ''}">Список</button>
      <button type="button" data-v="cal" class="${filters.view === 'cal' ? 'on' : ''}">Календарь</button></div>
    <div class="hist-body"></div>`;
  view.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { filters.view = b.dataset.v; filters.day = null; renderHistory(view); });
  const body = view.querySelector('.hist-body');
  if (filters.view === 'cal') return renderCalendar(body);
  body.innerHTML = `
    <input class="search" type="search" placeholder="Поиск по комментарию, категории, сумме" value="${esc(filters.query)}">
    <div class="chips-slot"></div>
    <div class="list-slot"></div>`;
  const search = body.querySelector('.search');
  search.addEventListener('input', () => { filters.query = search.value; renderList(body); });
  renderList(body);
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
  const dayTotal = (items) => items.reduce((s, t) => s + (t.type === 'income' ? S.txRub(t) : t.type === 'expense' ? -S.txRub(t) : 0), 0);

  const chip = (k, l) => `<button class="chip ${filters.type === k ? 'on' : ''}" data-ftype="${k}">${l}</button>`;
  view.querySelector('.chips-slot').innerHTML = `<div class="chips">
      ${chip('all', 'Все')}${chip('expense', 'Расходы')}${chip('income', 'Доходы')}${chip('transfer', 'Переводы')}${S.state.debts.length ? chip('debt', 'Долги') : ''}
      ${cat ? `<button class="chip on" data-clear="cat">${cat.icon} ${esc(cat.name)} ✕</button>` : ''}
      ${filters.month ? `<button class="chip on" data-clear="month">${monthLabel(filters.month)} ✕</button>` : ''}
    </div>`;
  const slot = view.querySelector('.list-slot');
  slot.innerHTML = `
    ${groups.length ? groups.map((g) => {
      const tot = dayTotal(g.items);
      return `<div class="day-head"><span>${dayLabel(g.date)}</span><span class="num">${tot ? money(tot, { sign: true }) : ''}</span></div>
        <div class="list">${g.items.map(txRow).join('')}</div>`;
    }).join('') : `<div class="empty">${S.state.transactions.length ? 'Ничего не найдено' : 'Здесь появятся твои операции.<br>Нажми «+», чтобы добавить первую, или загрузи выписку банка в разделе «Ещё».'}</div>`}
    ${list.length > shown.length ? `<div class="empty small">Показаны последние ${shown.length} из ${list.length}. Уточни поиск.</div>` : ''}
    ${groups.length && !S.getMeta('swipeHintShown') ? '<p class="small muted" style="text-align:center">Подсказка: смахни операцию влево, чтобы удалить</p>' : ''}`;

  view.querySelectorAll('[data-ftype]').forEach((b) => b.onclick = () => { filters.type = b.dataset.ftype; renderList(view); });
  view.querySelectorAll('[data-clear]').forEach((b) => b.onclick = () => {
    if (b.dataset.clear === 'cat') filters.categoryId = null; else filters.month = null;
    renderList(view);
  });
  bindTxRows(slot);
}

function renderCalendar(el) {
  const m = filters.calMonth || currentMonth();
  const daily = S.dailyExpenses(m);
  const max = Math.max(1, ...daily.values());
  const dim = daysInMonth(m);
  const [y, mo] = m.split('-').map(Number);
  const offset = (new Date(y, mo - 1, 1).getDay() + 6) % 7; // понедельник — первый
  const t = today();
  const total = [...daily.values()].reduce((s, v) => s + v, 0);
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span></span>');
  for (let d = 1; d <= dim; d++) {
    const iso = `${m}-${String(d).padStart(2, '0')}`;
    const v = daily.get(iso) || 0;
    const a = v ? 0.12 + 0.7 * (v / max) : 0;
    cells.push(`<button class="cal-day ${a > 0.45 ? 'dk' : ''} ${iso === t ? 'today' : ''} ${iso === filters.day ? 'sel' : ''} ${iso > t ? 'future' : ''}" data-day="${iso}"
      style="${v ? `--a:${a.toFixed(2)}` : ''}" aria-label="${d}: ${v ? money(v) : 'нет расходов'}">
      <span class="d">${d}</span>${v ? `<span class="s">${moneyShort(v)}</span>` : ''}</button>`);
  }
  const dayList = filters.day ? S.sortedTransactions().filter((x) => x.date === filters.day) : [];
  el.innerHTML = `
    <div class="month-switch">
      <button data-m="-1" aria-label="Предыдущий месяц">‹</button>
      <span class="label">${monthLabel(m)}</span>
      <button data-m="1" aria-label="Следующий месяц" ${m >= currentMonth() ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>
    <div class="card cal">
      <div class="cal-head">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="small muted" style="margin-top:10px">Расходы за месяц: <b class="num">${money(total)}</b>. Чем темнее день — тем больше потрачено.</div>
    </div>
    ${filters.day ? `<div class="day-head"><span>${dayLabel(filters.day)}</span></div>
      ${dayList.length ? `<div class="list">${dayList.map(txRow).join('')}</div>` : '<div class="empty">В этот день операций нет</div>'}` : '<div class="empty small">Нажми на день, чтобы увидеть операции</div>'}`;
  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    const next = shiftMonth(m, Number(b.dataset.m));
    if (next > currentMonth()) return;
    filters.calMonth = next; filters.day = null;
    renderCalendar(el);
  });
  el.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { filters.day = b.dataset.day; renderCalendar(el); });
  bindTxRows(el);
}
