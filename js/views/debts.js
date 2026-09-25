// Долги: кому дал в долг и у кого занял.
import * as S from '../store.js';
import { openSheet, confirmSheet } from '../ui.js';
import { esc, money, parseAmount, toast, today, shortDate } from '../utils.js';

const NO_ACC = '__none';

export function renderDebts(el) {
  const debts = [...S.state.debts].sort((a, b) => (a.closed - b.closed) || (a.due || '9999').localeCompare(b.due || '9999'));
  const open = debts.filter((d) => !d.closed), closed = debts.filter((d) => d.closed);
  const owedToMe = open.filter((d) => d.direction === 'lent').reduce((s, d) => s + S.debtLeft(d), 0);
  const iOwe = open.filter((d) => d.direction === 'borrowed').reduce((s, d) => s + S.debtLeft(d), 0);
  const row = (d) => {
    const left = S.debtLeft(d);
    const overdue = !d.closed && d.due && d.due < today();
    return `<button class="row" data-debt="${d.id}">
      <span class="ico">${d.direction === 'lent' ? '🤝' : '🙏'}</span>
      <span class="main"><div class="t1">${esc(d.person)}</div>
        <div class="t2">${d.closed ? 'Закрыт' : d.direction === 'lent' ? 'Должен мне' : 'Я должен'}${d.due && !d.closed ? ` · до ${shortDate(d.due)}` : ''}</div>
        ${overdue ? '<div class="small" style="color:var(--critical-text)">⛔ Срок прошёл</div>' : ''}</span>
      <span class="amt">${money(d.closed ? d.amount : left)}</span>
    </button>`;
  };
  el.innerHTML = `
    <div class="tiles" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
      <div class="tile"><div class="k">Мне должны</div><div class="v">${money(owedToMe)}</div></div>
      <div class="tile"><div class="k">Я должен</div><div class="v">${money(iOwe)}</div></div>
    </div>
    ${open.length ? `<div class="list">${open.map(row).join('')}</div>` : '<div class="empty">Записывай, кому одолжил и у кого занял, — ничего не забудется.</div>'}
    ${closed.length ? `<details class="closed-debts"><summary class="section-title">Закрытые (${closed.length})</summary><div class="list">${closed.map(row).join('')}</div></details>` : ''}
    <button class="btn" data-new-debt>Записать долг</button>`;
  el.querySelectorAll('[data-debt]').forEach((b) => b.onclick = () => openDebtSheet(S.state.debts.find((d) => d.id === b.dataset.debt)));
  el.querySelector('[data-new-debt]').onclick = () => newDebtSheet();
}

function accOptions(withNone = true) {
  return S.regularAccounts().filter((a) => (a.currency || 'RUB') === 'RUB')
    .map((a) => `<option value="${a.id}">${a.icon} ${esc(a.name)}</option>`).join('') +
    (withNone ? `<option value="${NO_ACC}">Не менять баланс счетов</option>` : '');
}

function newDebtSheet() {
  let direction = 'lent';
  openSheet('Новый долг', (body, close) => {
    const render = () => {
      body.innerHTML = `
        <div class="seg"><button type="button" data-dir="lent" class="${direction === 'lent' ? 'on' : ''}">Я дал в долг</button>
          <button type="button" data-dir="borrowed" class="${direction === 'borrowed' ? 'on' : ''}">Я взял в долг</button></div>
        <label class="field"><span>${direction === 'lent' ? 'Кому' : 'У кого'}</span><input class="input" data-person placeholder="Имя" maxlength="40"></label>
        <label class="field"><span>Сумма, ₽</span><input class="input" inputmode="decimal" data-amount placeholder="0"></label>
        <div class="meta-row">
          <label class="field"><span>Дата</span><input class="input" type="date" data-date value="${today()}"></label>
          <label class="field"><span>Вернуть до (необязательно)</span><input class="input" type="date" data-due></label>
        </div>
        <label class="field"><span>${direction === 'lent' ? 'С какого счёта отдал' : 'На какой счёт получил'}</span>
          <select class="input" data-acc>${accOptions()}</select></label>
        <input class="input" data-note placeholder="Комментарий" maxlength="80" style="margin-bottom:12px">
        <button class="btn" data-save>Сохранить</button>`;
      body.querySelectorAll('[data-dir]').forEach((b) => b.onclick = () => { direction = b.dataset.dir; render(); });
      body.querySelector('[data-save]').onclick = async () => {
        const person = body.querySelector('[data-person]').value.trim();
        const amount = parseAmount(body.querySelector('[data-amount]').value);
        if (!person) return toast('Укажи имя');
        if (amount <= 0) return toast('Укажи сумму');
        const date = body.querySelector('[data-date]').value || today();
        const acc = body.querySelector('[data-acc]').value;
        const d = await S.saveDebt({
          direction, person, amount, date, due: body.querySelector('[data-due]').value || null,
          note: body.querySelector('[data-note]').value.trim(),
        });
        await S.saveTransaction({
          type: 'debt', debtId: d.id, debtStart: true, flow: direction === 'lent' ? 'out' : 'in', amount, date,
          accountId: acc === NO_ACC ? null : acc, note: `Долг: ${person}`,
        });
        close();
        toast('Долг записан');
      };
    };
    render();
  });
}

export function openDebtSheet(d) {
  openSheet(d.direction === 'lent' ? `${d.person} должен мне` : `Я должен: ${d.person}`, (body, close) => {
    const left = S.debtLeft(d);
    const pays = S.sortedTransactions().filter((t) => t.debtId === d.id);
    body.innerHTML = `
      <div class="hero" style="margin-bottom:12px"><div class="label">${d.closed ? 'Долг закрыт' : 'Осталось вернуть'}</div>
        <div class="value" style="margin-bottom:4px">${money(d.closed ? 0 : left)}</div>
        <div class="small muted">Всего ${money(d.amount)} · с ${shortDate(d.date)}${d.due ? ' · до ' + shortDate(d.due) : ''}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
      ${d.closed ? '' : `<button class="btn" data-pay>${d.direction === 'lent' ? 'Мне вернули' : 'Я вернул'}</button><div style="height:8px"></div>`}
      <div class="section-title">История</div>
      <div class="list">${pays.map((t) => `<div class="row"><span class="ico">${t.flow === 'in' ? '⬇️' : '⬆️'}</span>
        <span class="main"><div class="t1">${t.debtStart ? (d.direction === 'lent' ? 'Дал в долг' : 'Взял в долг') : 'Возврат'}</div>
        <div class="t2">${shortDate(t.date)}${t.accountId ? ' · ' + esc(S.account(t.accountId)?.name || '') : ''}</div></span>
        <span class="amt ${t.flow === 'in' ? 'plus' : ''}">${t.flow === 'in' ? '+' : '−'}${money(t.amount)}</span></div>`).join('')}</div>
      ${d.closed ? '<button class="btn secondary" data-reopen>Открыть снова</button><div style="height:6px"></div>' : ''}
      <button class="btn danger" data-del>Удалить долг</button>`;
    body.querySelector('[data-pay]')?.addEventListener('click', () => { close(); paySheet(d); });
    body.querySelector('[data-reopen]')?.addEventListener('click', async () => { await S.saveDebt({ ...d, closed: false }); close(); });
    body.querySelector('[data-del]').onclick = () => confirmSheet('Удалить долг?', 'Долг и все связанные с ним операции будут удалены, балансы счетов пересчитаются.', 'Удалить',
      async () => { await S.deleteDebt(d.id); close(); toast('Долг удалён'); });
  });
}

function paySheet(d) {
  const left = S.debtLeft(d);
  openSheet(d.direction === 'lent' ? 'Мне вернули' : 'Я вернул', (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Сумма, ₽ (осталось ${money(left)})</span><input class="input big-input" inputmode="decimal" data-amount value="${left / 100}"></label>
      <label class="field"><span>${d.direction === 'lent' ? 'На какой счёт' : 'С какого счёта'}</span><select class="input" data-acc>${accOptions()}</select></label>
      <button class="btn" data-save>Сохранить</button>`;
    body.querySelector('[data-save]').onclick = async () => {
      const amount = Math.min(parseAmount(body.querySelector('[data-amount]').value), left);
      if (amount <= 0) return toast('Укажи сумму');
      const acc = body.querySelector('[data-acc]').value;
      await S.saveTransaction({
        type: 'debt', debtId: d.id, flow: d.direction === 'lent' ? 'in' : 'out', amount, date: today(),
        accountId: acc === NO_ACC ? null : acc, note: `Возврат долга: ${d.person}`,
      });
      const closedNow = S.debtLeft(d) === 0;
      if (closedNow) await S.saveDebt({ ...d, closed: true });
      close();
      toast(closedNow ? '✅ Долг полностью закрыт' : `Осталось ${money(S.debtLeft(d))}`);
    };
  });
}
