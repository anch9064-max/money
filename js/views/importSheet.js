// Импорт банковской выписки: выбор файла → предпросмотр → добавление.
import * as S from '../store.js';
import { openSheet } from '../ui.js';
import { esc, money, shortDate, toast } from '../utils.js';

const GUIDES = {
  tbank: {
    name: 'Т-Банк',
    file: 'CSV',
    steps: [
      'Открой сайт <b>tbank.ru</b> в браузере и войди в личный кабинет (в приложении выгрузки в CSV обычно нет).',
      'Перейди в раздел <b>«Операции»</b> и выбери нужный период.',
      'Нажми <b>«Выгрузить»</b> (или значок скачивания) и выбери формат <b>CSV</b>.',
      'Загрузи полученный файл сюда.',
    ],
  },
  sber: {
    name: 'Сбер',
    file: 'PDF',
    steps: [
      'В приложении <b>СберБанк Онлайн</b> открой нужную карту.',
      'Найди пункт <b>«Выписки и справки»</b> → <b>«Выписка по счёту»</b> (названия могут немного отличаться).',
      'Выбери период и формат <b>PDF</b>, затем «Поделиться» → <b>«Сохранить в Файлы»</b>.',
      'Загрузи этот PDF сюда.',
    ],
  },
  other: {
    name: 'Другой банк',
    file: 'CSV или PDF',
    steps: [
      'Выгрузи выписку из приложения или сайта банка в формате <b>CSV</b> (лучше всего) или <b>PDF</b>.',
      'В файле должны быть дата, сумма и описание операции.',
      'Перед добавлением ты увидишь все найденные операции и сможешь их поправить.',
    ],
  },
};

export function openImportSheet() {
  let bank = S.getMeta('importBank') || 'tbank';
  let accountId = S.getMeta('importAccount');
  const accounts = S.regularAccounts();
  if (!accounts.some((a) => a.id === accountId)) accountId = accounts[0]?.id;

  openSheet('Импорт выписки', (body, close) => {
    function renderStart() {
      const g = GUIDES[bank];
      body.innerHTML = `
        <div class="seg">${Object.entries(GUIDES).map(([k, v]) => `<button type="button" data-bank="${k}" class="${k === bank ? 'on' : ''}">${v.name}</button>`).join('')}</div>
        <div class="card guide"><h2>Как получить файл (${g.file})</h2>
          <ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>
        <label class="field"><span>Куда добавить операции</span>
          <select class="input" data-acc>${accounts.map((a) => `<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('')}</select></label>
        <label class="btn file-btn">Выбрать файл выписки<input type="file" accept=".csv,.txt,.pdf,text/csv,application/pdf" data-file hidden></label>
        <p class="small muted" style="margin:10px 4px 0">Файл обрабатывается прямо на телефоне и никуда не отправляется. Повторная загрузка той же выписки не создаст дублей.</p>`;
      body.querySelectorAll('[data-bank]').forEach((b) => b.onclick = () => { bank = b.dataset.bank; S.setMeta('importBank', bank); renderStart(); });
      body.querySelector('[data-acc]').onchange = (e) => { accountId = e.target.value; S.setMeta('importAccount', accountId); };
      body.querySelector('[data-file]').onchange = (e) => handleFile(e.target.files[0]);
    }

    async function handleFile(file) {
      if (!file) return;
      body.innerHTML = `<div class="empty">⏳ Читаю выписку…</div>`;
      try {
        const importFile = await import('../import.js');
        const parsed = await importFile.parseFile(file);
        if (!parsed.rows.length) {
          body.innerHTML = `<div class="empty">Не получилось найти операции в этом файле.<br><br>
            Проверь, что это выписка с операциями (а не справка об остатке).
            Если файл правильный — формат банка мог измениться, напиши разработчику.</div>
            <button class="btn secondary" data-back>Назад</button>`;
          body.querySelector('[data-back]').onclick = renderStart;
          return;
        }
        const prep = await importFile.prepare(parsed.rows, accountId);
        renderPreview(prep, importFile);
      } catch (e) {
        console.error(e);
        body.innerHTML = `<div class="empty">Ошибка при чтении файла: ${esc(e?.message || e)}</div><button class="btn secondary" data-back>Назад</button>`;
        body.querySelector('[data-back]').onclick = renderStart;
      }
    }

    function renderPreview({ rows, already }, mod) {
      const catOptions = (type, sel) => S.activeCategories(type).map((c) =>
        `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
      const summary = () => {
        const ch = rows.filter((r) => r.checked);
        const inc = ch.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
        const exp = ch.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
        return { n: ch.length, inc, exp };
      };
      const LIMIT = 400;
      body.innerHTML = `
        <div class="imp-sum" data-sum></div>
        ${already ? `<p class="small muted" style="margin:0 4px 8px">Уже загружено раньше и пропущено: ${already}</p>` : ''}
        ${rows.length ? `<div class="chips"><button class="chip" data-all>Выбрать все</button><button class="chip" data-none>Снять все</button></div>
        <div class="list imp-list">${rows.slice(0, LIMIT).map((r, i) => `
          <div class="imp-row ${r.checked ? '' : 'off'}" data-i="${i}">
            <input type="checkbox" ${r.checked ? 'checked' : ''} aria-label="Добавить">
            <div class="imp-main">
              <div class="imp-top"><span class="imp-desc">${esc(r.description || r.bankCategory || 'Операция')}</span>
                <span class="amt ${r.type === 'income' ? 'plus' : ''}">${r.type === 'income' ? '+' : '−'}${money(r.amount)}</span></div>
              <div class="imp-bottom"><span class="small muted">${shortDate(r.date)}${r.time ? ', ' + r.time : ''}</span>
                <select class="imp-cat">${catOptions(r.type, r.categoryId)}</select></div>
              ${r.flag ? `<div class="imp-flag">⚠️ ${esc(r.flag)}</div>` : ''}
            </div>
          </div>`).join('')}</div>
        ${rows.length > LIMIT ? `<p class="small muted">Показаны первые ${LIMIT} из ${rows.length}. Остальные тоже будут добавлены, если отмечены.</p>` : ''}` :
        '<div class="empty">Все операции из этого файла уже есть в приложении 👍</div>'}
        <div class="imp-actions"><button class="btn secondary" data-back>Другой файл</button>
          <button class="btn" data-go>Добавить</button></div>`;
      const upd = () => {
        const s = summary();
        body.querySelector('[data-sum]').innerHTML = `Найдено операций: <b>${rows.length}</b>. К добавлению: <b>${s.n}</b><br>
          <span class="small muted">Доходы ${money(s.inc)} · Расходы ${money(s.exp)}</span>`;
        const go = body.querySelector('[data-go]');
        go.disabled = !s.n;
        go.textContent = s.n ? `Добавить ${s.n}` : 'Добавить';
      };
      body.querySelectorAll('.imp-row').forEach((el) => {
        const r = rows[Number(el.dataset.i)];
        const cb = el.querySelector('input');
        cb.onchange = () => { r.checked = cb.checked; el.classList.toggle('off', !r.checked); upd(); };
        el.querySelector('select').onchange = (e) => { r.categoryId = e.target.value; };
      });
      const setAll = (v) => { rows.forEach((r) => { r.checked = v; }); body.querySelectorAll('.imp-row').forEach((el) => { el.classList.toggle('off', !v); el.querySelector('input').checked = v; }); upd(); };
      body.querySelector('[data-all]')?.addEventListener('click', () => setAll(true));
      body.querySelector('[data-none]')?.addEventListener('click', () => setAll(false));
      body.querySelector('[data-back]').onclick = renderStart;
      body.querySelector('[data-go]').onclick = async () => {
        const n = await mod.commit(rows, accountId);
        close();
        toast(`Добавлено операций: ${n}`);
      };
      upd();
    }

    renderStart();
  });
}
