// Экран «Ещё»: счета, категории, регулярные платежи, резервные копии.
import * as S from '../store.js';
import { openSheet, confirmSheet, emojiPicker, bindEmojiPicker } from '../ui.js';
import { esc, money, parseAmount, toast, today, shortDate, fromISO } from '../utils.js';

const PERIODS = { week: 'Каждую неделю', month: 'Каждый месяц', year: 'Каждый год' };
const PERIODS_SHORT = { week: 'еженедельно', month: 'ежемесячно', year: 'ежегодно' };

export function renderMore(view) {
  const accounts = S.activeAccounts();
  const subs = [...S.state.subscriptions].sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const monthlySubs = subs.filter((s) => s.active && (s.type || 'expense') === 'expense')
    .reduce((sum, s) => sum + (s.period === 'week' ? s.amount * 52 / 12 : s.period === 'year' ? s.amount / 12 : s.amount), 0);

  view.innerHTML = `
    <div class="section-title">Регулярные платежи</div>
    <div class="list">
      ${subs.map((s) => {
        const c = S.category(s.categoryId);
        return `<button class="row" data-sub="${s.id}">
          <span class="ico">${c?.icon || '🔁'}</span>
          <span class="main"><div class="t1">${esc(s.name)}</div>
            <div class="t2">${s.active ? `${PERIODS_SHORT[s.period]} · ${shortDate(s.nextDate)}` : 'На паузе'}</div></span>
          <span class="amt ${s.type === 'income' ? 'plus' : ''}">${money(s.amount)}</span>
        </button>`;
      }).join('')}
      <button class="row" data-sub-new><span class="ico">＋</span><span class="main"><div class="t1" style="color:var(--accent)">Добавить платёж</div>
        <div class="t2">Подписки, аренда, зарплата</div></span></button>
    </div>
    ${monthlySubs ? `<div class="small muted" style="margin:-4px 4px 8px">Регулярные расходы ≈ ${money(Math.round(monthlySubs))} в месяц</div>` : ''}

    <div class="section-title">Счета</div>
    <div class="list">
      ${accounts.map((a) => `<button class="row" data-acc="${a.id}"><span class="ico">${a.icon}</span>
        <span class="main"><div class="t1">${esc(a.name)}</div></span><span class="amt">${money(S.accountBalance(a.id))}</span></button>`).join('')}
      <button class="row" data-acc-new><span class="ico">＋</span><span class="main"><div class="t1" style="color:var(--accent)">Добавить счёт</div></span></button>
    </div>

    <div class="section-title">Настройки</div>
    <div class="list">
      <button class="row" data-cats="expense"><span class="ico">🏷</span><span class="main"><div class="t1">Категории расходов</div></span><span class="chev">›</span></button>
      <button class="row" data-cats="income"><span class="ico">💰</span><span class="main"><div class="t1">Категории доходов</div></span><span class="chev">›</span></button>
    </div>

    <div class="section-title">Данные</div>
    <div class="list">
      <button class="row" data-export-json><span class="ico">💾</span><span class="main"><div class="t1">Сохранить резервную копию</div>
        <div class="t2">${S.getMeta('lastBackup') ? 'Последняя: ' + shortDate(S.getMeta('lastBackup')) : 'Ещё ни разу — рекомендую сделать'}</div></span></button>
      <button class="row" data-import-json><span class="ico">📥</span><span class="main"><div class="t1">Восстановить из копии</div>
        <div class="t2">Заменит все текущие данные</div></span></button>
      <button class="row" data-export-csv><span class="ico">📊</span><span class="main"><div class="t1">Выгрузить в Excel (CSV)</div></span></button>
    </div>
    <input type="file" accept=".json,application/json" data-file hidden>

    <p class="small muted" style="margin:16px 4px">Все данные хранятся только на этом устройстве, в браузере — никуда не отправляются.
      Если удалить приложение с экрана «Домой» или очистить данные Safari, они пропадут, поэтому время от времени сохраняй резервную копию (например, в «Файлы» или iCloud Drive).
      <br><br>Операций: ${S.state.transactions.length}</p>`;

  view.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => openSubSheet(S.state.subscriptions.find((s) => s.id === b.dataset.sub)));
  view.querySelector('[data-sub-new]').onclick = () => openSubSheet();
  view.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => openAccountSheet(S.account(b.dataset.acc)));
  view.querySelector('[data-acc-new]').onclick = () => openAccountSheet();
  view.querySelectorAll('[data-cats]').forEach((b) => b.onclick = () => openCategoriesSheet(b.dataset.cats));
  view.querySelector('[data-export-json]').onclick = exportJSON;
  view.querySelector('[data-export-csv]').onclick = exportCSV;
  const file = view.querySelector('[data-file]');
  view.querySelector('[data-import-json]').onclick = () => file.click();
  file.onchange = () => { importJSON(file.files[0]); file.value = ''; };
}

// ===== Счета =====
export function openAccountSheet(acc) {
  let icon = acc?.icon || '💳';
  openSheet(acc ? 'Счёт' : 'Новый счёт', (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Название</span><input class="input" data-name value="${esc(acc?.name || '')}" placeholder="Например, Т-Банк" maxlength="40"></label>
      <label class="field"><span>Начальный остаток, ₽</span><input class="input" inputmode="decimal" data-initial value="${acc ? acc.initial / 100 : ''}" placeholder="0"></label>
      ${acc ? `<div class="small muted" style="margin:-4px 4px 12px">Сейчас на счёте: <b>${money(S.accountBalance(acc.id))}</b></div>` : ''}
      <div class="field"><span>Иконка</span>${emojiPicker(icon)}</div>
      <button class="btn" data-save>Сохранить</button>
      ${acc ? '<div style="height:6px"></div><button class="btn danger" data-del>Удалить счёт</button>' : ''}`;
    bindEmojiPicker(body, (e) => { icon = e; });
    body.querySelector('[data-save]').onclick = async () => {
      const name = body.querySelector('[data-name]').value.trim();
      if (!name) { toast('Введи название'); return; }
      await S.saveAccount({ ...(acc || {}), name, icon, initial: parseAmount(body.querySelector('[data-initial]').value || '0') });
      close();
    };
    body.querySelector('[data-del]')?.addEventListener('click', () => {
      const used = S.accountUsed(acc.id);
      confirmSheet('Удалить счёт?',
        used ? 'По счёту есть операции — он будет скрыт, а история сохранится.' : 'Счёт будет удалён.',
        'Удалить', async () => { await S.deleteAccount(acc.id); close(); });
    });
  });
}

// ===== Категории =====
function openCategoriesSheet(type) {
  openSheet(type === 'expense' ? 'Категории расходов' : 'Категории доходов', (body) => {
    const render = () => {
      body.innerHTML = `<div class="list">
        ${S.activeCategories(type).map((c) => `<button class="row" data-c="${c.id}"><span class="ico">${c.icon}</span>
          <span class="main"><div class="t1">${esc(c.name)}</div></span><span class="chev">›</span></button>`).join('')}
        <button class="row" data-c-new><span class="ico">＋</span><span class="main"><div class="t1" style="color:var(--accent)">Новая категория</div></span></button>
      </div>`;
      body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openCategorySheet(type, S.category(b.dataset.c), render));
      body.querySelector('[data-c-new]').onclick = () => openCategorySheet(type, null, render);
    };
    render();
  });
}

function openCategorySheet(type, cat, onDone) {
  let icon = cat?.icon || '📦';
  openSheet(cat ? 'Категория' : 'Новая категория', (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Название</span><input class="input" data-name value="${esc(cat?.name || '')}" maxlength="30"></label>
      <div class="field"><span>Иконка</span>${emojiPicker(icon)}</div>
      <button class="btn" data-save>Сохранить</button>
      ${cat ? '<div style="height:6px"></div><button class="btn danger" data-del>Удалить категорию</button>' : ''}`;
    bindEmojiPicker(body, (e) => { icon = e; });
    body.querySelector('[data-save]').onclick = async () => {
      const name = body.querySelector('[data-name]').value.trim();
      if (!name) { toast('Введи название'); return; }
      await S.saveCategory({ ...(cat || {}), type, name, icon });
      close(); onDone();
    };
    body.querySelector('[data-del]')?.addEventListener('click', () =>
      confirmSheet('Удалить категорию?', 'Старые операции сохранятся, но категорию нельзя будет выбрать для новых. Бюджет по ней удалится.', 'Удалить',
        async () => { await S.deleteCategory(cat.id); close(); onDone(); }));
  });
}

// ===== Регулярные платежи =====
function openSubSheet(sub) {
  const accounts = S.activeAccounts();
  const st = {
    type: sub?.type || 'expense',
    categoryId: sub?.categoryId || null,
  };
  openSheet(sub ? 'Регулярный платёж' : 'Новый регулярный платёж', (body, close) => {
    const render = () => {
      const cats = S.activeCategories(st.type);
      if (!st.categoryId || !cats.some((c) => c.id === st.categoryId)) {
        st.categoryId = cats.find((c) => c.name === 'Подписки')?.id || cats[0]?.id;
      }
      const vals = {
        name: body.querySelector('[data-name]')?.value ?? sub?.name ?? '',
        amount: body.querySelector('[data-amount]')?.value ?? (sub ? sub.amount / 100 : ''),
        account: body.querySelector('[data-account]')?.value ?? sub?.accountId ?? accounts[0]?.id,
        period: body.querySelector('[data-period]')?.value ?? sub?.period ?? 'month',
        date: body.querySelector('[data-date]')?.value ?? sub?.nextDate ?? today(),
      };
      body.innerHTML = `
        <div class="seg"><button type="button" data-type="expense" class="${st.type === 'expense' ? 'on' : ''}">Расход</button>
          <button type="button" data-type="income" class="${st.type === 'income' ? 'on' : ''}">Доход</button></div>
        <label class="field"><span>Название</span><input class="input" data-name value="${esc(vals.name)}" placeholder="Например, Яндекс Плюс" maxlength="40"></label>
        <label class="field"><span>Сумма, ₽</span><input class="input" inputmode="decimal" data-amount value="${esc(vals.amount)}" placeholder="0"></label>
        <div class="field"><span>Категория</span><div class="cat-grid">${cats.map((c) => `<button type="button" class="cat-pick ${c.id === st.categoryId ? 'on' : ''}" data-cat="${c.id}">
          <span class="e">${c.icon}</span><span>${esc(c.name)}</span></button>`).join('')}</div></div>
        <div class="meta-row">
          <label class="field"><span>Счёт</span><select class="input" data-account>${accounts.map((a) => `<option value="${a.id}" ${a.id === vals.account ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Повтор</span><select class="input" data-period>${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${k === vals.period ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${sub ? 'Следующий платёж' : 'Дата первого платежа'}</span><input class="input" type="date" data-date value="${vals.date}"></label>
        <p class="small muted" style="margin:0 4px 12px">В этот день операция добавится автоматически при открытии приложения.</p>
        <button class="btn" data-save>Сохранить</button>
        ${sub ? `<div style="height:8px"></div><button class="btn secondary" data-pause>${sub.active ? 'Поставить на паузу' : 'Возобновить'}</button>
          <div style="height:6px"></div><button class="btn danger" data-del>Удалить</button>` : ''}`;
      body.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { st.type = b.dataset.type; st.categoryId = null; render(); });
      body.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
        st.categoryId = b.dataset.cat;
        body.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      });
      body.querySelector('[data-save]').onclick = async () => {
        const name = body.querySelector('[data-name]').value.trim();
        const amount = parseAmount(body.querySelector('[data-amount]').value);
        const date = body.querySelector('[data-date]').value;
        if (!name) return toast('Введи название');
        if (amount <= 0) return toast('Укажи сумму');
        if (!date) return toast('Укажи дату');
        if (!accounts.length) return toast('Сначала добавь счёт');
        const n = S.state.transactions.length;
        await S.saveSubscription({
          ...(sub || {}), type: st.type, name, amount, categoryId: st.categoryId,
          accountId: body.querySelector('[data-account]').value,
          period: body.querySelector('[data-period]').value,
          nextDate: date, anchorDay: fromISO(date).getDate(),
        });
        close();
        const added = S.state.transactions.length - n;
        toast(added ? `Сохранено. Добавлено операций: ${added}` : 'Платёж сохранён');
      };
      body.querySelector('[data-pause]')?.addEventListener('click', async () => {
        await S.saveSubscription({ ...sub, active: !sub.active, nextDate: !sub.active && sub.nextDate < today() ? today() : sub.nextDate });
        close();
      });
      body.querySelector('[data-del]')?.addEventListener('click', () =>
        confirmSheet('Удалить платёж?', 'Уже добавленные операции останутся.', 'Удалить', async () => { await S.deleteSubscription(sub.id); close(); }));
    };
    render();
  });
}

// ===== Экспорт / импорт =====
async function deliverFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], name, { type: mime });
  // На iPhone удобнее всего «Поделиться» → «Сохранить в Файлы»
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

async function exportJSON() {
  const ok = await deliverFile(`money-backup-${today()}.json`, JSON.stringify(S.exportData()), 'application/json');
  if (ok) { await S.setMeta('lastBackup', today()); toast('Резервная копия готова'); }
}

async function exportCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const types = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
  const rows = [['Дата', 'Тип', 'Сумма', 'Категория', 'Счёт', 'Счёт получатель', 'Комментарий']];
  for (const t of S.sortedTransactions()) {
    rows.push([
      t.date, types[t.type],
      ((t.type === 'expense' ? -t.amount : t.amount) / 100).toFixed(2).replace('.', ','),
      S.category(t.categoryId)?.name || '', S.account(t.accountId)?.name || '',
      t.type === 'transfer' ? S.account(t.toAccountId)?.name || '' : '', t.note || '',
    ]);
  }
  // BOM + «;» — чтобы русский Excel открыл файл без кракозябр
  const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  if (await deliverFile(`money-${today()}.csv`, csv, 'text/csv')) toast('Файл готов');
}

async function importJSON(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const count = data.transactions?.length ?? 0;
    confirmSheet('Восстановить данные?', `В копии операций: ${count}. Все текущие данные на этом устройстве будут заменены.`, 'Восстановить', async () => {
      try { await S.importData(data); toast('Данные восстановлены'); }
      catch (e) { toast(e.message); }
    });
  } catch {
    toast('Не удалось прочитать файл');
  }
}
