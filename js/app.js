// Точка входа: навигация по вкладкам и перерисовка при изменении данных.
import * as S from './store.js';
import { currentMonth, toast } from './utils.js';
import { renderHome } from './views/home.js';
import { renderHistory, filters } from './views/history.js';
import { renderBudgets } from './views/budgets.js';
import { renderMore } from './views/more.js';
import { openTxSheet } from './views/txSheet.js';

const TITLES = { home: 'Обзор', history: 'Операции', budgets: 'Бюджеты', more: 'Ещё' };
const ui = { tab: 'home', month: currentMonth() };
const view = document.getElementById('view');

function render() {
  document.getElementById('title').textContent = TITLES[ui.tab];
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  if (ui.tab === 'home') renderHome(view, ui, go);
  else if (ui.tab === 'history') renderHistory(view);
  else if (ui.tab === 'budgets') renderBudgets(view, ui);
  else renderMore(view);
}

function go(tab, opts) {
  if (tab === 'history') {
    filters.categoryId = opts?.categoryId || null;
    filters.month = opts?.month || null;
    filters.type = opts?.type || 'all';
    filters.query = '';
  }
  ui.tab = tab;
  render();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
document.getElementById('fab').addEventListener('click', () => openTxSheet());

// Перерисовка при изменении данных
S.subscribe(() => render());

// При возвращении в приложение (например, на следующий день) — проверить регулярные платежи и месяц
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const added = await S.runSubscriptions();
  if (added) toast(`Добавлено регулярных платежей: ${added}`);
  if (ui.month > currentMonth()) { ui.month = currentMonth(); render(); }
});

(async function start() {
  try {
    await S.init();
    render();
  } catch (e) {
    view.innerHTML = `<div class="empty">Не удалось открыть хранилище данных.<br>${e?.message || e}<br><br>
      Если это приватный режим Safari — открой приложение в обычном режиме.</div>`;
    console.error(e);
  }
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW:', e));
  });
}
