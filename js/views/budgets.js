// Экран «Бюджеты»: лимиты по категориям на месяц.
import * as S from '../store.js';
import { openSheet, confirmSheet } from '../ui.js';
import { esc, money, monthLabel, shiftMonth, currentMonth, parseAmount, toast } from '../utils.js';

function statusOf(spent, limit) {
  const r = limit ? spent / limit : 0;
  if (r > 1) return { cls: 'st-crit', icon: '⛔', text: `<span class="crit">Превышен на ${money(spent - limit)}</span>` };
  if (r >= 0.8) return { cls: 'st-warn', icon: '⚠️', text: `Почти исчерпан · осталось ${money(limit - spent)}` };
  return { cls: 'st-good', icon: '✅', text: `Осталось ${money(limit - spent)}` };
}

export function renderBudgets(view, ui) {
  const m = ui.month;
  const budgets = S.state.budgets
    .map((b) => ({ ...b, cat: S.category(b.categoryId), spent: S.spentInCategory(b.categoryId, m) }))
    .filter((b) => b.cat && !b.cat.archived)
    .sort((a, b) => (b.spent / b.limit) - (a.spent / a.limit));
  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);

  // Сколько можно тратить в день до конца месяца (только для текущего месяца)
  let perDay = '';
  if (m === currentMonth() && totalLimit > totalSpent) {
    const now = new Date();
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
    perDay = `<div class="small muted" style="margin-top:8px">Можно тратить ≈ ${money(Math.floor((totalLimit - totalSpent) / daysLeft / 100) * 100)} в день, дней осталось: ${daysLeft}</div>`;
  }

  view.innerHTML = `
    <div class="month-switch">
      <button data-m="-1" aria-label="Предыдущий месяц">‹</button>
      <span class="label">${monthLabel(m)}</span>
      <button data-m="1" aria-label="Следующий месяц" ${m >= currentMonth() ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>
    ${budgets.length ? `
      <div class="card">
        <h2>Всего по бюджетам</h2>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <b class="num" style="font-size:22px">${money(totalSpent)}</b><span class="muted num">из ${money(totalLimit)}</span>
        </div>
        ${bar(totalSpent, totalLimit)}
        ${perDay}
      </div>
      <div class="list">${budgets.map((b) => {
        const s = statusOf(b.spent, b.limit);
        return `<button class="budget row" style="display:block" data-budget="${b.id}">
          <div class="head"><span style="font-size:20px">${b.cat.icon}</span><span class="n">${esc(b.cat.name)}</span>
            <span class="v">${money(b.spent)} / ${money(b.limit)}</span></div>
          ${bar(b.spent, b.limit)}
          <div class="status"><span aria-hidden="true">${s.icon}</span>${s.text}</div>
        </button>`;
      }).join('')}</div>` : `<div class="empty">Бюджеты помогают не тратить лишнего.<br>Задай лимит на категорию — например, «Кафе: 5 000 ₽ в месяц».</div>`}
    <button class="btn" data-new>Добавить бюджет</button>`;

  view.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    const next = shiftMonth(ui.month, Number(b.dataset.m));
    if (next > currentMonth()) return;
    ui.month = next;
    renderBudgets(view, ui);
  });
  view.querySelector('[data-new]').onclick = () => openBudgetSheet();
  view.querySelectorAll('[data-budget]').forEach((el) => el.onclick = () =>
    openBudgetSheet(S.state.budgets.find((b) => b.id === el.dataset.budget)));
}

function bar(spent, limit) {
  const r = limit ? spent / limit : 0;
  const cls = r > 1 ? 'st-crit' : r >= 0.8 ? 'st-warn' : 'st-good';
  return `<div class="progress" role="progressbar" aria-valuenow="${Math.round(r * 100)}" aria-valuemin="0" aria-valuemax="100">
    <div class="${cls}" style="width:${Math.min(100, Math.max(r * 100, 1))}%"></div></div>`;
}

function openBudgetSheet(budget) {
  const used = new Set(S.state.budgets.map((b) => b.categoryId));
  const cats = S.activeCategories('expense').filter((c) => !used.has(c.id) || c.id === budget?.categoryId);
  if (!cats.length) { toast('Бюджеты уже заданы для всех категорий'); return; }
  let catId = budget?.categoryId || cats[0].id;

  openSheet(budget ? 'Бюджет' : 'Новый бюджет', (body, close) => {
    body.innerHTML = `
      <div class="field"><span>Категория</span>
        <div class="cat-grid">${cats.map((c) => `<button type="button" class="cat-pick ${c.id === catId ? 'on' : ''}" data-cat="${c.id}">
          <span class="e">${c.icon}</span><span>${esc(c.name)}</span></button>`).join('')}</div></div>
      <label class="field"><span>Лимит на месяц, ₽</span>
        <input class="input" inputmode="decimal" data-limit placeholder="Например, 5000" value="${budget ? budget.limit / 100 : ''}"></label>
      <button class="btn" data-save>Сохранить</button>
      ${budget ? '<div style="height:6px"></div><button class="btn danger" data-del>Удалить бюджет</button>' : ''}`;
    body.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
      catId = b.dataset.cat;
      body.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
    });
    body.querySelector('[data-save]').onclick = async () => {
      const limit = parseAmount(body.querySelector('[data-limit]').value);
      if (limit <= 0) { toast('Укажи сумму лимита'); return; }
      await S.saveBudget({ ...(budget || {}), categoryId: catId, limit });
      close();
      toast('Бюджет сохранён');
    };
    body.querySelector('[data-del]')?.addEventListener('click', () =>
      confirmSheet('Удалить бюджет?', 'Операции останутся, удалится только лимит.', 'Удалить', async () => {
        await S.deleteBudget(budget.id); close();
      }));
  });
}
