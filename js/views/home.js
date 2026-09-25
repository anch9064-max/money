// Экран «Обзор»: баланс, итоги месяца, графики, счета.
import * as S from '../store.js';
import { esc, money, monthLabel, shiftMonth, currentMonth } from '../utils.js';
import { categoryBars, monthlyChart } from '../charts.js';
import { openAccountSheet } from './more.js';

export function renderHome(view, ui, go) {
  const m = ui.month;
  const { income, expense } = S.monthTotals(m);
  const net = income - expense;
  const cats = S.byCategory(m, 'expense');
  const accounts = S.activeAccounts();
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(m, i - 5)).map((key) => ({ key, ...S.monthTotals(key) }));

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const showInstall = isIOS && !standalone && !S.getMeta('installHintHidden');

  view.innerHTML = `
    ${showInstall ? `<div class="card banner">
      <div style="font-size:26px">📲</div>
      <div class="t"><b>Установи на экран «Домой»</b><br>
        Нажми <b>Поделиться</b> ⬆️ внизу Safari → <b>«На экран „Домой“»</b>.
        Так приложение откроется без адресной строки и данные будут храниться надёжнее.
        <br><button class="link-btn small" data-hide-install>Скрыть</button></div>
    </div>` : ''}

    <div class="month-switch">
      <button data-m="-1" aria-label="Предыдущий месяц">‹</button>
      <span class="label">${monthLabel(m)}</span>
      <button data-m="1" aria-label="Следующий месяц" ${m >= currentMonth() ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>

    <div class="card hero">
      <div class="label">Всего на счетах</div>
      <div class="value">${money(S.totalBalance())}</div>
      <div class="tiles">
        <div class="tile"><div class="k"><i class="dot" style="background:var(--income)"></i>Доходы</div><div class="v">${money(income)}</div></div>
        <div class="tile"><div class="k"><i class="dot" style="background:var(--expense)"></i>Расходы</div><div class="v">${money(expense)}</div></div>
        <div class="tile"><div class="k">Итог</div><div class="v ${net > 0 ? 'amt plus' : ''}">${money(net, { sign: true })}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>Расходы по категориям</h2>
      ${categoryBars(cats)}
    </div>

    <div class="card">
      <h2>Последние 6 месяцев</h2>
      <div id="monthly"></div>
    </div>

    <div class="section-title">Счета</div>
    <div class="list">
      ${accounts.map((a) => `<button class="row" data-acc="${a.id}">
        <span class="ico">${a.icon}</span>
        <span class="main"><div class="t1">${esc(a.name)}</div></span>
        <span class="amt">${money(S.accountBalance(a.id))}</span>
      </button>`).join('')}
      <button class="row" data-acc-new><span class="ico">＋</span><span class="main"><div class="t1" style="color:var(--accent)">Добавить счёт</div></span></button>
    </div>`;

  monthlyChart(view.querySelector('#monthly'), months, { selected: m });

  view.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    const next = shiftMonth(ui.month, Number(b.dataset.m));
    if (next > currentMonth()) return;
    ui.month = next;
    renderHome(view, ui, go);
  });
  view.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
    if (b.dataset.cat === '__other') return;
    go('history', { categoryId: b.dataset.cat, month: m, type: 'expense' });
  });
  view.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => openAccountSheet(S.account(b.dataset.acc)));
  view.querySelector('[data-acc-new]').onclick = () => openAccountSheet();
  view.querySelector('[data-hide-install]')?.addEventListener('click', async () => {
    await S.setMeta('installHintHidden', true);
    renderHome(view, ui, go);
  });
}
