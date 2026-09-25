// Копилки (цели накоплений). Копилка — это особый счёт: пополнение = перевод с обычного счёта.
import * as S from '../store.js';
import { openSheet, confirmSheet, emojiPicker, bindEmojiPicker } from '../ui.js';
import { esc, money, parseAmount, toast, today, shortDate, fromISO, CURRENCIES } from '../utils.js';

function monthsLeft(deadline) {
  if (!deadline) return null;
  const now = new Date(), d = fromISO(deadline);
  return Math.max(1, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth());
}

export function renderGoals(el) {
  const goals = S.goalAccounts();
  el.innerHTML = `
    ${goals.length ? goals.map((g) => {
      const saved = S.accountBalance(g.id);
      const r = g.target ? Math.min(1, saved / g.target) : 0;
      const left = Math.max(0, (g.target || 0) - saved);
      const ml = monthsLeft(g.deadline);
      const done = g.target && saved >= g.target;
      return `<button class="card goal" data-goal="${g.id}">
        <div class="goal-head"><span class="goal-ico">${g.icon}</span>
          <span class="goal-name">${esc(g.name)}</span>
          <span class="goal-pct num">${Math.round(r * 100)}%</span></div>
        <div class="progress"><div class="${done ? 'st-good' : 'goal-fill'}" style="width:${Math.max(1, r * 100)}%"></div></div>
        <div class="goal-sub"><span class="num"><b>${money(saved, { cur: g.currency })}</b> из ${money(g.target || 0, { cur: g.currency })}</span>
          <span>${done ? '🎉 Цель достигнута' : g.deadline ? `до ${shortDate(g.deadline)}` : ''}</span></div>
        ${!done && ml ? `<div class="small muted">Откладывай ≈ ${money(Math.ceil(left / ml / 100) * 100, { cur: g.currency })} в месяц</div>` : ''}
      </button>`;
    }).join('') : `<div class="empty">Копилка помогает накопить на цель: отпуск, телефон, подушку безопасности.<br>Деньги в копилке учитываются в общем балансе.</div>`}
    <button class="btn" data-new-goal>Новая копилка</button>`;
  el.querySelectorAll('[data-goal]').forEach((b) => b.onclick = () => openGoalSheet(S.account(b.dataset.goal)));
  el.querySelector('[data-new-goal]').onclick = () => editGoalSheet();
}

function openGoalSheet(g) {
  openSheet(`${g.icon} ${g.name}`, (body, close) => {
    const saved = S.accountBalance(g.id);
    const hist = S.sortedTransactions().filter((t) => t.type === 'transfer' && (t.toAccountId === g.id || t.accountId === g.id)).slice(0, 20);
    body.innerHTML = `
      <div class="hero" style="margin-bottom:12px"><div class="label">Накоплено</div>
        <div class="value" style="margin-bottom:4px">${money(saved, { cur: g.currency })}</div>
        <div class="small muted">Цель: ${money(g.target || 0, { cur: g.currency })}${g.deadline ? ' · до ' + shortDate(g.deadline) : ''}</div></div>
      <div class="meta-row"><button class="btn" data-add>Пополнить</button><button class="btn secondary" data-take>Снять</button></div>
      ${hist.length ? `<div class="section-title">История</div><div class="list">${hist.map((t) => {
        const inn = t.toAccountId === g.id;
        const other = S.account(inn ? t.accountId : t.toAccountId);
        return `<div class="row"><span class="ico">${inn ? '⬇️' : '⬆️'}</span><span class="main"><div class="t1">${inn ? 'Пополнение' : 'Снятие'}</div>
          <div class="t2">${shortDate(t.date)} · ${esc(other?.name || '')}</div></span>
          <span class="amt ${inn ? 'plus' : ''}">${inn ? '+' : '−'}${money(inn ? (t.toAmount ?? t.amount) : t.amount, { cur: g.currency })}</span></div>`;
      }).join('')}</div>` : ''}
      <div style="height:8px"></div>
      <button class="btn secondary" data-edit>Изменить копилку</button>`;
    body.querySelector('[data-add]').onclick = () => { close(); moveSheet(g, 'in'); };
    body.querySelector('[data-take]').onclick = () => { close(); moveSheet(g, 'out'); };
    body.querySelector('[data-edit]').onclick = () => { close(); editGoalSheet(g); };
  });
}

function moveSheet(g, dir) {
  const accounts = S.regularAccounts().filter((a) => (a.currency || 'RUB') === (g.currency || 'RUB'));
  if (!accounts.length) { toast('Нет счёта в той же валюте, что и копилка'); return; }
  openSheet(dir === 'in' ? `Пополнить «${g.name}»` : `Снять из «${g.name}»`, (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Сумма</span><input class="input big-input" inputmode="decimal" data-amount placeholder="0"></label>
      <label class="field"><span>${dir === 'in' ? 'С какого счёта' : 'На какой счёт'}</span>
        <select class="input" data-acc>${accounts.map((a) => `<option value="${a.id}">${a.icon} ${esc(a.name)} · ${money(S.accountBalance(a.id), { cur: a.currency })}</option>`).join('')}</select></label>
      <button class="btn" data-save>${dir === 'in' ? 'Пополнить' : 'Снять'}</button>`;
    const inp = body.querySelector('[data-amount]');
    setTimeout(() => inp.focus(), 300);
    body.querySelector('[data-save]').onclick = async () => {
      const amount = parseAmount(inp.value);
      if (amount <= 0) return toast('Укажи сумму');
      const acc = body.querySelector('[data-acc]').value;
      await S.saveTransaction({
        type: 'transfer', amount, date: today(), note: dir === 'in' ? `Копилка «${g.name}»` : `Из копилки «${g.name}»`,
        accountId: dir === 'in' ? acc : g.id, toAccountId: dir === 'in' ? g.id : acc,
      });
      close();
      const saved = S.accountBalance(g.id);
      toast(dir === 'in' && g.target && saved >= g.target ? '🎉 Цель достигнута!' : 'Готово');
    };
  });
}

export function editGoalSheet(g) {
  let icon = g?.icon || '🐷';
  openSheet(g ? 'Изменить копилку' : 'Новая копилка', (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Название</span><input class="input" data-name value="${esc(g?.name || '')}" placeholder="Например, Отпуск" maxlength="40"></label>
      <label class="field"><span>Сколько нужно накопить</span><input class="input" inputmode="decimal" data-target value="${g?.target ? g.target / 100 : ''}" placeholder="100000"></label>
      <div class="meta-row">
        <label class="field"><span>К какой дате (необязательно)</span><input class="input" type="date" data-deadline value="${g?.deadline || ''}"></label>
        <label class="field"><span>Валюта</span><select class="input" data-cur ${g && S.accountUsed(g.id) ? 'disabled' : ''}>
          ${Object.entries(CURRENCIES).map(([k, v]) => `<option value="${k}" ${k === (g?.currency || 'RUB') ? 'selected' : ''}>${v.sym} ${k}</option>`).join('')}</select></label>
      </div>
      ${g ? '' : `<label class="field"><span>Уже отложено (необязательно)</span><input class="input" inputmode="decimal" data-initial placeholder="0"></label>`}
      <div class="field"><span>Иконка</span>${emojiPicker(icon)}</div>
      <button class="btn" data-save>Сохранить</button>
      ${g ? '<div style="height:6px"></div><button class="btn danger" data-del>Удалить копилку</button>' : ''}`;
    bindEmojiPicker(body, (e) => { icon = e; });
    body.querySelector('[data-save]').onclick = async () => {
      const name = body.querySelector('[data-name]').value.trim();
      const target = parseAmount(body.querySelector('[data-target]').value);
      if (!name) return toast('Введи название');
      if (target <= 0) return toast('Укажи сумму цели');
      await S.saveAccount({
        ...(g || {}), kind: 'goal', name, icon, target,
        deadline: body.querySelector('[data-deadline]').value || null,
        currency: body.querySelector('[data-cur]').value,
        initial: g ? g.initial : parseAmount(body.querySelector('[data-initial]').value || '0'),
      });
      close();
      toast(g ? 'Сохранено' : 'Копилка создана');
    };
    body.querySelector('[data-del]')?.addEventListener('click', () => {
      const bal = S.accountBalance(g.id);
      confirmSheet('Удалить копилку?', bal > 0 ? `В копилке ${money(bal, { cur: g.currency })}. Сначала сними деньги на обычный счёт, иначе они пропадут из баланса.` : 'Копилка будет удалена.',
        'Удалить', async () => { await S.deleteAccount(g.id); close(); });
    });
  });
}

