// Шторка добавления / редактирования операции.
import * as S from '../store.js';
import { openSheet, confirmSheet } from '../ui.js';
import { esc, today, toast, vibrate, monthKey, money } from '../utils.js';

const TYPES = [['expense', 'Расход'], ['income', 'Доход'], ['transfer', 'Перевод']];

function fmtInput(str) {
  if (!str) return '0';
  const [int, dec] = str.split(',');
  const intF = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return dec !== undefined ? `${intF},${dec}` : intF;
}
function strFromKop(kop) {
  const r = kop / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',').replace(/0$/, '');
}

export function openTxSheet({ tx, type = 'expense' } = {}) {
  const editing = !!tx;
  const accounts = S.activeAccounts();
  const lastAcc = S.getMeta('lastAccount');
  const st = {
    type: tx?.type || type,
    amount: tx ? strFromKop(tx.amount) : '',
    categoryId: tx?.categoryId || null,
    accountId: tx?.accountId || (accounts.find((a) => a.id === lastAcc) ? lastAcc : accounts[0]?.id),
    toAccountId: tx?.toAccountId || null,
    date: tx?.date || today(),
    note: tx?.note || '',
  };
  if (!st.toAccountId) st.toAccountId = accounts.find((a) => a.id !== st.accountId)?.id || null;

  openSheet(editing ? 'Операция' : 'Новая операция', (body, close) => {
    const accOptions = (sel, list = accounts) => {
      // при редактировании показываем и архивный счёт, если операция на нём
      const all = sel && !list.some((a) => a.id === sel) && S.account(sel) ? [...list, S.account(sel)] : list;
      return all.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('');
    };

    function render() {
      const cats = st.type === 'transfer' ? [] : S.activeCategories(st.type);
      const curCat = st.categoryId && S.category(st.categoryId);
      if (curCat && curCat.archived && !cats.includes(curCat)) cats.push(curCat);
      body.innerHTML = `
        <div class="seg">${TYPES.map(([k, l]) => `<button type="button" data-type="${k}" class="${st.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="amount-display ${st.type}"><span class="num">${fmtInput(st.amount)}</span> <span class="cur">₽</span></div>
        ${st.type === 'transfer' ? `
          <div class="meta-row">
            <label class="field"><span>Откуда</span><select class="input" data-f="accountId">${accOptions(st.accountId)}</select></label>
            <label class="field"><span>Куда</span><select class="input" data-f="toAccountId">${accOptions(st.toAccountId)}</select></label>
          </div>` : `
          <div class="cat-grid">${cats.map((c) => `
            <button type="button" class="cat-pick ${c.id === st.categoryId ? 'on' : ''}" data-cat="${c.id}">
              <span class="e">${c.icon}</span><span>${esc(c.name)}</span></button>`).join('')}
          </div>`}
        <div class="meta-row">
          ${st.type === 'transfer' ? '' : `<select class="input" data-f="accountId" aria-label="Счёт">${accOptions(st.accountId)}</select>`}
          <input class="input" type="date" data-f="date" value="${st.date}" aria-label="Дата" ${st.type === 'transfer' ? 'style="grid-column:1/3"' : ''}>
        </div>
        <input class="input" data-f="note" placeholder="Комментарий" value="${esc(st.note)}" maxlength="120">
        <div class="keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button type="button" data-key="${k}">${k}</button>`).join('')}
        </div>
        <button class="btn" data-save>${editing ? 'Сохранить' : 'Добавить'}</button>
        ${editing ? `<div style="height:6px"></div><button class="btn danger" data-del>Удалить операцию</button>` : ''}`;
      bind();
      updateSave();
    }

    function valid() {
      const kop = Math.round(parseFloat((st.amount || '0').replace(',', '.')) * 100);
      if (!(kop > 0) || !st.accountId || !st.date) return false;
      if (st.type === 'transfer') return st.toAccountId && st.toAccountId !== st.accountId;
      return !!st.categoryId;
    }
    function updateSave() { body.querySelector('[data-save]').disabled = !valid(); }

    function press(k) {
      let a = st.amount;
      if (k === '⌫') a = a.slice(0, -1);
      else if (k === ',') { if (!a.includes(',')) a = (a || '0') + ','; }
      else {
        const [int, dec] = a.split(',');
        if (dec !== undefined && dec.length >= 2) return;
        if (dec === undefined && int.length >= 9) return;
        a = a === '0' ? k : a + k;
      }
      st.amount = a;
      vibrate();
      body.querySelector('.amount-display .num').textContent = fmtInput(a);
      updateSave();
    }

    function bind() {
      body.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
        if (st.type === b.dataset.type) return;
        st.type = b.dataset.type;
        st.categoryId = null;
        render();
      });
      body.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
        st.categoryId = b.dataset.cat;
        body.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
        updateSave();
      });
      body.querySelectorAll('[data-f]').forEach((el) => {
        el.addEventListener('input', () => { st[el.dataset.f] = el.value; updateSave(); });
        el.addEventListener('change', () => { st[el.dataset.f] = el.value; updateSave(); });
      });
      body.querySelectorAll('[data-key]').forEach((b) => b.onclick = () => press(b.dataset.key));
      body.querySelector('[data-save]').onclick = save;
      const del = body.querySelector('[data-del]');
      if (del) del.onclick = () => confirmSheet('Удалить операцию?', 'Это действие нельзя отменить.', 'Удалить', async () => {
        await S.deleteTransaction(tx.id);
        close();
        toast('Операция удалена');
      });
    }

    async function save() {
      if (!valid()) return;
      const amount = Math.round(parseFloat(st.amount.replace(',', '.')) * 100);
      const item = {
        ...(tx || {}),
        type: st.type, amount, accountId: st.accountId, date: st.date, note: st.note.trim(),
        categoryId: st.type === 'transfer' ? null : st.categoryId,
        toAccountId: st.type === 'transfer' ? st.toAccountId : null,
      };
      await S.saveTransaction(item);
      await S.setMeta('lastAccount', st.accountId);
      close();
      budgetWarning(item) || toast(editing ? 'Сохранено' : 'Операция добавлена');
    }

    render();
  });
}

/** Предупреждение, если трата приблизила или вывела за лимит бюджета. */
function budgetWarning(t) {
  if (t.type !== 'expense') return false;
  const b = S.state.budgets.find((x) => x.categoryId === t.categoryId);
  if (!b) return false;
  const spent = S.spentInCategory(t.categoryId, monthKey(t.date));
  const c = S.category(t.categoryId);
  if (spent > b.limit) { toast(`⚠️ Бюджет «${c.name}» превышен на ${money(spent - b.limit)}`, 3500); return true; }
  if (spent >= b.limit * 0.8) { toast(`Бюджет «${c.name}»: осталось ${money(b.limit - spent)}`, 3000); return true; }
  return false;
}
