// Экран «Обзор»: баланс, итоги месяца, подсказки, графики, счета.
import * as S from '../store.js';
import { esc, money, monthLabel, shiftMonth, currentMonth, today, daysInMonth, shortDate, toISO } from '../utils.js';
import { categoryBars, monthlyChart } from '../charts.js';
import { openAccountSheet, exportJSON } from './more.js';

function insights(m) {
  const out = [];
  const { expense } = S.monthTotals(m);
  const isCur = m === currentMonth();
  const day = isCur ? new Date().getDate() : daysInMonth(m);
  const t = today();

  for (const d of S.state.debts) {
    if (!d.closed && d.due && d.due < t && out.length < 1) {
      out.push(`🤝 ${d.direction === 'lent' ? `${esc(d.person)} должен вернуть` : `Пора вернуть долг: ${esc(d.person)},`} ${money(S.debtLeft(d))} — срок прошёл ${shortDate(d.due)}`);
    }
  }
  const soon = toISO(new Date(Date.now() + 3 * 864e5));
  const sub = S.state.subscriptions.filter((s) => s.active && s.nextDate <= soon && (s.type || 'expense') === 'expense')
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
  if (sub && isCur) out.push(`🔁 Скоро спишется: ${esc(sub.name)} — ${money(sub.amount)} (${shortDate(sub.nextDate)})`);

  if (expense > 0 && day >= 3) {
    if (isCur) out.push(`📈 Прогноз расходов на месяц: <b>${money(Math.round(expense / day * daysInMonth(m) / 100) * 100)}</b>`);
    out.push(`📊 В среднем ${money(Math.round(expense / day / 100) * 100)} в день`);
    const prev = shiftMonth(m, -1);
    const prevTo = `${prev}-${String(Math.min(day, daysInMonth(prev))).padStart(2, '0')}`;
    const curMap = S.byCategoryRange(`${m}-01`, `${m}-${String(day).padStart(2, '0')}`);
    const prevMap = S.byCategoryRange(`${prev}-01`, prevTo);
    let up = null, down = null;
    for (const id of new Set([...curMap.keys(), ...prevMap.keys()])) {
      const c = curMap.get(id) || 0, p = prevMap.get(id) || 0;
      const diff = c - p;
      if (p > 0 && diff > 100000 && c > p * 1.25 && (!up || diff > up.diff)) up = { id, diff, pct: Math.round((c / p - 1) * 100) };
      if (p > 100000 && -diff > 100000 && c < p * 0.8 && (!down || diff < down.diff)) down = { id, diff };
    }
    const cn = (id) => { const c = S.category(id); return c ? `${c.icon} ${esc(c.name)}` : 'Без категории'; };
    if (up) out.push(`${cn(up.id)}: на ${money(up.diff)} больше, чем в прошлом месяце к этому числу (+${up.pct}%)`);
    if (down) out.push(`${cn(down.id)}: на ${money(-down.diff)} меньше, чем в прошлом месяце — отлично!`);
  }
  return out.slice(0, 3);
}

const r = (kop) => Math.round(kop / 100) * 100; // в плитках — без копеек

export function renderHome(view, ui, go) {
  const m = ui.month;
  const { income, expense } = S.monthTotals(m);
  const net = income - expense;
  const cats = S.byCategory(m, 'expense');
  const accounts = S.regularAccounts();
  const goals = S.goalAccounts();
  const total = S.totalBalance();
  const inGoals = goals.reduce((s, g) => s + (S.toRub(S.accountBalance(g.id), g.currency) || 0), 0);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(m, i - 5)).map((key) => ({ key, ...S.monthTotals(key) }));
  const tips = insights(m);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const showInstall = isIOS && !standalone && !S.getMeta('installHintHidden');
  const lastBackup = S.getMeta('lastBackup');
  const backupSnooze = S.getMeta('backupSnooze');
  const needBackup = S.state.transactions.length >= 15 && (!lastBackup || (Date.now() - new Date(lastBackup)) > 14 * 864e5) &&
    (!backupSnooze || Date.now() - backupSnooze > 3 * 864e5);

  view.innerHTML = `
    ${showInstall ? `<div class="card banner">
      <div style="font-size:26px">📲</div>
      <div class="t"><b>Установи на экран «Домой»</b><br>
        Нажми <b>Поделиться</b> ⬆️ внизу Safari → <b>«На экран „Домой“»</b>.
        Так приложение откроется без адресной строки и данные будут храниться надёжнее.
        <br><button class="link-btn small" data-hide-install>Скрыть</button></div>
    </div>` : ''}
    ${needBackup ? `<div class="card banner">
      <div style="font-size:26px">💾</div>
      <div class="t"><b>Пора сохранить резервную копию</b><br>
        ${lastBackup ? `Последняя — ${shortDate(lastBackup)}.` : 'Ты ещё ни разу её не делал.'} Данные хранятся только на телефоне — копия защитит их.
        <br><button class="link-btn small" data-backup>Сохранить сейчас</button> &nbsp; <button class="link-btn small muted" data-snooze>Позже</button></div>
    </div>` : ''}

    <div class="month-switch">
      <button data-m="-1" aria-label="Предыдущий месяц">‹</button>
      <span class="label">${monthLabel(m)}</span>
      <button data-m="1" aria-label="Следующий месяц" ${m >= currentMonth() ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>

    <div class="card hero">
      <div class="label">Всего на счетах</div>
      <div class="value">${money(total.sum)}</div>
      ${inGoals ? `<div class="small muted" style="margin:-10px 0 12px">из них в копилках ${money(inGoals)}</div>` : ''}
      ${total.missing ? `<div class="small muted" style="margin:-10px 0 12px">⚠️ Нет курса для валютных счетов — подключись к интернету</div>` : ''}
      <div class="tiles">
        <div class="tile"><div class="k"><i class="dot" style="background:var(--income)"></i>Доходы</div><div class="v">${money(r(income))}</div></div>
        <div class="tile"><div class="k"><i class="dot" style="background:var(--expense)"></i>Расходы</div><div class="v">${money(r(expense))}</div></div>
        <div class="tile"><div class="k">Итог</div><div class="v ${net > 0 ? 'amt plus' : ''}">${money(r(net), { sign: true })}</div></div>
      </div>
    </div>

    ${tips.length ? `<div class="card tips"><h2>Подсказки</h2>${tips.map((t) => `<div class="tip">${t}</div>`).join('')}</div>` : ''}

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
      ${accounts.map((a) => {
        const bal = S.accountBalance(a.id);
        const foreign = a.currency && a.currency !== 'RUB';
        const rub = foreign ? S.toRub(bal, a.currency) : null;
        return `<button class="row" data-acc="${a.id}">
          <span class="ico">${a.icon}</span>
          <span class="main"><div class="t1">${esc(a.name)}</div>${foreign && rub != null ? `<div class="t2">≈ ${money(rub)}</div>` : ''}</span>
          <span class="amt">${money(bal, { cur: a.currency })}</span>
        </button>`;
      }).join('')}
      <button class="row" data-acc-new><span class="ico">＋</span><span class="main"><div class="t1" style="color:var(--accent)">Добавить счёт</div></span></button>
    </div>
    ${goals.length ? `<div class="section-title">Копилки</div><div class="list">${goals.map((g) => {
      const saved = S.accountBalance(g.id);
      return `<button class="row" data-goal><span class="ico">${g.icon}</span><span class="main"><div class="t1">${esc(g.name)}</div>
        <div class="t2">${g.target ? Math.min(100, Math.round(saved / g.target * 100)) + '% от ' + money(g.target, { cur: g.currency }) : ''}</div></span>
        <span class="amt">${money(saved, { cur: g.currency })}</span></button>`;
    }).join('')}</div>` : ''}`;

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
  view.querySelectorAll('[data-goal]').forEach((b) => b.onclick = () => { ui.plansTab = 'goals'; go('plans'); });
  view.querySelector('[data-hide-install]')?.addEventListener('click', async () => {
    await S.setMeta('installHintHidden', true);
    renderHome(view, ui, go);
  });
  view.querySelector('[data-backup]')?.addEventListener('click', exportJSON);
  view.querySelector('[data-snooze]')?.addEventListener('click', async () => {
    await S.setMeta('backupSnooze', Date.now());
    renderHome(view, ui, go);
  });
}
