// Шторка добавления / редактирования операции.
import * as S from '../store.js';
import { openSheet } from '../ui.js';
import { esc, today, toast, vibrate, monthKey, money, curSym, toISO, shortDate } from '../utils.js';
import { resizeImage, openPhotoViewer } from './photo.js';

const TYPES = [['expense', 'Расход'], ['income', 'Доход'], ['transfer', 'Перевод']];

function fmtInput(str) {
  if (!str) return '0';
  const [int, dec] = str.split(',');
  const intF = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return dec !== undefined ? `${intF},${dec}` : intF;
}
export function strFromKop(kop) {
  const r = kop / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',').replace(/0$/, '');
}
const yesterday = () => toISO(new Date(Date.now() - 864e5));

/**
 * @param {object} o
 * @param {object} [o.tx] — операция для редактирования
 * @param {string} [o.type] — тип новой операции
 * @param {object} [o.prefill] — предзаполнение (из чека): amount, date, time, note, categoryId, receipt, receiptFn
 */
export function openTxSheet({ tx, type = 'expense', prefill } = {}) {
  const editing = !!tx;
  const accounts = S.activeAccounts();
  const lastAcc = S.getMeta('lastAccount');
  const p = prefill || {};
  const st = {
    type: tx?.type || p.type || type,
    amount: tx ? strFromKop(tx.amount) : p.amount ? strFromKop(p.amount) : '',
    toAmount: tx?.toAmount != null ? strFromKop(tx.toAmount) : '',
    categoryId: tx?.categoryId || p.categoryId || null,
    categoryManual: !!(tx?.categoryId || p.categoryId),
    accountId: tx?.accountId || (accounts.find((a) => a.id === lastAcc) ? lastAcc : S.regularAccounts()[0]?.id || accounts[0]?.id),
    toAccountId: tx?.toAccountId || null,
    date: tx?.date || p.date || today(),
    note: tx?.note || p.note || '',
    photoId: tx?.photoId || null,
    newPhoto: null,
  };
  if (!st.toAccountId) st.toAccountId = accounts.find((a) => a.id !== st.accountId)?.id || null;

  openSheet(editing ? 'Операция' : p.receipt ? 'Покупка по чеку' : 'Новая операция', (body, close) => {
    const accOptions = (sel) => {
      const base = st.type === 'transfer' ? accounts : S.regularAccounts();
      const list = sel && !base.some((a) => a.id === sel) && S.account(sel) ? [...base, S.account(sel)] : base;
      return list.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.icon} ${esc(a.name)}${a.currency && a.currency !== 'RUB' ? ' · ' + a.currency : ''}</option>`).join('');
    };
    const cur = () => S.account(st.accountId)?.currency || 'RUB';
    const toCur = () => S.account(st.toAccountId)?.currency || 'RUB';
    const crossCur = () => st.type === 'transfer' && cur() !== toCur();

    function render() {
      const cats = st.type === 'transfer' ? [] : S.activeCategories(st.type);
      const curCat = st.categoryId && S.category(st.categoryId);
      if (curCat && curCat.archived && !cats.includes(curCat)) cats.push(curCat);
      const templates = !editing && !p.receipt && st.type !== 'transfer' ? S.frequentTemplates(st.type) : [];
      const isToday = st.date === today(), isYest = st.date === yesterday();

      body.innerHTML = `
        <div class="tx-top">
          <div class="seg">${TYPES.map(([k, l]) => `<button type="button" data-type="${k}" class="${st.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          ${editing ? '' : '<button type="button" class="scan-btn" data-scan aria-label="Сканировать чек">📷</button>'}
        </div>
        <div class="amount-display ${st.type}"><span class="num">${fmtInput(st.amount)}</span> <span class="cur">${curSym(cur())}</span></div>
        ${templates.length ? `<div class="chips tpl">${templates.map((t, i) => {
          const c = S.category(t.categoryId);
          return `<button type="button" class="chip" data-tpl="${i}">${c.icon} ${esc(t.note || c.name)} · ${money(t.amount, { cur: S.account(t.accountId)?.currency })}</button>`;
        }).join('')}</div>` : ''}
        ${st.type === 'transfer' ? `
          <div class="meta-row">
            <label class="field"><span>Откуда</span><select class="input" data-f="accountId">${accOptions(st.accountId)}</select></label>
            <label class="field"><span>Куда</span><select class="input" data-f="toAccountId">${accOptions(st.toAccountId)}</select></label>
          </div>
          ${crossCur() ? `<label class="field"><span>Зачислено, ${curSym(toCur())}</span>
            <input class="input" inputmode="decimal" data-f="toAmount" value="${esc(st.toAmount)}" placeholder="Сумма в валюте счёта «Куда»"></label>` : ''}` : `
          <div class="cat-grid">${cats.map((c) => `
            <button type="button" class="cat-pick ${c.id === st.categoryId ? 'on' : ''}" data-cat="${c.id}">
              <span class="e">${c.icon}</span><span>${esc(c.name)}</span></button>`).join('')}
          </div>`}
        <div class="date-row">
          <button type="button" class="chip ${isToday ? 'on' : ''}" data-day="today">Сегодня</button>
          <button type="button" class="chip ${isYest ? 'on' : ''}" data-day="yest">Вчера</button>
          <label class="chip date-chip ${!isToday && !isYest ? 'on' : ''}">📅 ${!isToday && !isYest ? shortDate(st.date) : 'Дата'}
            <input type="date" data-f="date" value="${st.date}" max="2100-12-31"></label>
          ${st.type === 'transfer' ? '' : `<select class="input acc-select" data-f="accountId" aria-label="Счёт">${accOptions(st.accountId)}</select>`}
        </div>
        <div class="note-row">
          <input class="input" data-f="note" placeholder="Комментарий или магазин" value="${esc(st.note)}" maxlength="120" autocomplete="off">
          <label class="photo-btn ${st.photoId || st.newPhoto ? 'has' : ''}" aria-label="Фото чека">
            ${st.photoId || st.newPhoto ? '🖼' : '📎'}<input type="file" accept="image/*" data-photo hidden></label>
        </div>
        ${st.photoId || st.newPhoto ? `<div class="photo-line"><button type="button" class="link-btn small" data-photo-view>Посмотреть фото</button>
          <button type="button" class="link-btn small" data-photo-del style="color:var(--critical-text)">Убрать</button></div>` : ''}
        <div class="keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button type="button" data-key="${k}">${k}</button>`).join('')}
        </div>
        <button class="btn" data-save>${editing ? 'Сохранить' : 'Добавить'}</button>
        ${editing ? `<div style="height:6px"></div><button class="btn danger" data-del>Удалить операцию</button>` : ''}`;
      bind();
      updateSave();
    }

    function kop(str) { return Math.round(parseFloat((str || '0').replace(/\s/g, '').replace(',', '.')) * 100) || 0; }
    function valid() {
      if (!(kop(st.amount) > 0) || !st.accountId || !st.date) return false;
      if (st.type === 'transfer') return st.toAccountId && st.toAccountId !== st.accountId && (!crossCur() || kop(st.toAmount) > 0);
      return !!st.categoryId;
    }
    function updateSave() { body.querySelector('[data-save]').disabled = !valid(); }

    function selectCategory(id, manual) {
      st.categoryId = id;
      if (manual) st.categoryManual = true;
      body.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x.dataset.cat === id));
      updateSave();
    }

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
      if (crossCur()) {
        const r1 = S.rateOf(cur()), r2 = S.rateOf(toCur());
        const inp = body.querySelector('[data-f="toAmount"]');
        if (r1 && r2 && inp && !inp.dataset.touched) {
          st.toAmount = strFromKop(Math.round(kop(a) * r1 / r2));
          inp.value = st.toAmount;
        }
      }
      updateSave();
    }

    function bind() {
      body.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
        if (st.type === b.dataset.type) return;
        st.type = b.dataset.type;
        st.categoryId = null; st.categoryManual = false;
        if (st.note) { const s = S.suggestCategory(st.note, st.type); if (s) st.categoryId = s; }
        render();
      });
      body.querySelector('[data-scan]')?.addEventListener('click', async () => {
        close();
        const { openScanner } = await import('./scanner.js');
        openScanner();
      });
      body.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => selectCategory(b.dataset.cat, true));
      body.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => {
        const t = S.frequentTemplates(st.type)[Number(b.dataset.tpl)];
        if (!t) return;
        st.amount = strFromKop(t.amount); st.note = t.note; st.categoryId = t.categoryId; st.categoryManual = true;
        if (S.account(t.accountId) && !S.account(t.accountId).archived) st.accountId = t.accountId;
        render();
      });
      body.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => {
        st.date = b.dataset.day === 'today' ? today() : yesterday();
        render();
      });
      body.querySelectorAll('[data-f]').forEach((el) => {
        const f = el.dataset.f;
        const upd = () => {
          st[f] = el.value;
          if (f === 'toAmount') el.dataset.touched = '1';
          if (f === 'note' && !st.categoryManual && st.type !== 'transfer') {
            const s = S.suggestCategory(st.note, st.type);
            if (s && s !== st.categoryId) selectCategory(s, false);
          }
          updateSave();
        };
        el.addEventListener('input', upd);
        el.addEventListener('change', () => {
          upd();
          if (f === 'date' || f === 'accountId' || f === 'toAccountId') render();
        });
      });
      const photoInput = body.querySelector('[data-photo]');
      photoInput.onchange = async () => {
        const file = photoInput.files[0];
        if (!file) return;
        try { st.newPhoto = await resizeImage(file); render(); toast('Фото прикреплено'); }
        catch { toast('Не удалось открыть фото'); }
      };
      body.querySelector('[data-photo-view]')?.addEventListener('click', async () => {
        openPhotoViewer(st.newPhoto || await S.getPhoto(st.photoId));
      });
      body.querySelector('[data-photo-del]')?.addEventListener('click', () => { st.newPhoto = null; st.photoId = null; render(); });
      body.querySelectorAll('[data-key]').forEach((b) => b.onclick = () => press(b.dataset.key));
      body.querySelector('[data-save]').onclick = save;
      body.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        await removeWithUndo(tx.id);
      });
    }

    async function save() {
      if (!valid()) return;
      const btn = body.querySelector('[data-save]');
      btn.disabled = true;
      let photoId = st.photoId;
      if (st.newPhoto) photoId = await S.savePhoto(st.newPhoto);
      if (tx?.photoId && tx.photoId !== photoId) S.deletePhoto(tx.photoId);
      const item = {
        ...(tx || {}),
        type: st.type, amount: kop(st.amount), accountId: st.accountId, date: st.date, note: st.note.trim(),
        categoryId: st.type === 'transfer' ? null : st.categoryId,
        toAccountId: st.type === 'transfer' ? st.toAccountId : null,
        toAmount: crossCur() ? kop(st.toAmount) : null,
        photoId: photoId || null,
      };
      if (p.receipt) { item.receipt = p.receipt; item.time = p.time || null; }
      await S.saveTransaction(item);
      await S.setMeta('lastAccount', st.accountId);
      if (item.note && item.categoryId && st.categoryManual) S.learnCategory(item.note, item.categoryId);
      if (p.receiptFn && item.categoryId) await rememberStore(p.receiptFn, item.categoryId, item.note);
      close();
      budgetWarning(item) || toast(editing ? 'Сохранено' : 'Операция добавлена');
    }

    render();
  });
}

/** Запомнить магазин (номер кассы из чека) → категория и название. */
export async function rememberStore(fn, categoryId, name) {
  const stores = { ...(S.getMeta('receiptStores') || {}) };
  stores[fn] = { categoryId, name: name && name !== 'Покупка по чеку' ? name : stores[fn]?.name || '' };
  await S.setMeta('receiptStores', stores);
}

/** Удалить с возможностью отменить. */
export async function removeWithUndo(id) {
  const t = await S.deleteTransaction(id);
  if (!t) return;
  toast('Операция удалена', 5000, { label: 'Отменить', onClick: () => S.restoreTransaction(t) });
}

/** Предупреждение, если трата приблизила или вывела за лимит бюджета. */
export function budgetWarning(t) {
  if (t.type !== 'expense') return false;
  const b = S.state.budgets.find((x) => x.categoryId === t.categoryId);
  if (!b) return false;
  const spent = S.spentInCategory(t.categoryId, monthKey(t.date));
  const c = S.category(t.categoryId);
  if (spent > b.limit) { toast(`⚠️ Бюджет «${c.name}» превышен на ${money(spent - b.limit)}`, 3500); return true; }
  if (spent >= b.limit * 0.8) { toast(`Бюджет «${c.name}»: осталось ${money(b.limit - spent)}`, 3000); return true; }
  return false;
}

