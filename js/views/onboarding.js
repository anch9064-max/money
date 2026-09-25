// Знакомство при первом запуске: 3 коротких экрана.
import * as S from '../store.js';
import { parseAmount, esc } from '../utils.js';

export function needsOnboarding() {
  return !S.getMeta('onboarded') && S.state.transactions.length === 0;
}

export function showOnboarding() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'onboard';
    let step = 0;
    const accounts = S.regularAccounts();
    const finish = async () => {
      await S.setMeta('onboarded', true);
      el.remove();
      resolve();
    };
    const render = () => {
      const dots = `<div class="ob-dots">${[0, 1, 2].map((i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>`;
      if (step === 0) {
        el.innerHTML = `<div class="ob-body">
          <div class="ob-emoji">👋</div>
          <h1>Мои деньги</h1>
          <p>Простой учёт доходов и расходов.<br>Все данные хранятся только на этом телефоне.</p>
          <ul class="ob-list">
            <li>➕ Добавляй траты в пару касаний</li>
            <li>📷 Сканируй QR-код с чека</li>
            <li>🏦 Загружай выписки из банка</li>
            <li>🎯 Ставь бюджеты и копи на цели</li>
          </ul></div>
          ${dots}<button class="btn" data-next>Начать</button>`;
      } else if (step === 1) {
        el.innerHTML = `<div class="ob-body">
          <div class="ob-emoji">💰</div>
          <h1>Сколько у тебя сейчас?</h1>
          <p>Укажи примерные остатки — с них начнётся учёт. Можно пропустить и поменять позже.</p>
          ${accounts.map((a) => `<label class="field"><span>${a.icon} ${esc(a.name)}</span>
            <input class="input big-input" inputmode="decimal" data-acc="${a.id}" placeholder="0 ₽"></label>`).join('')}
          </div>
          ${dots}<button class="btn" data-next>Дальше</button>`;
      } else {
        el.innerHTML = `<div class="ob-body">
          <div class="ob-emoji">✨</div>
          <h1>Как пользоваться</h1>
          <ul class="ob-list">
            <li><b>Кнопка «+»</b> внизу — добавить трату или доход</li>
            <li><b>📷 в окне добавления</b> — отсканировать чек</li>
            <li><b>Смахни операцию влево</b> — чтобы удалить</li>
            <li><b>«Ещё» → Импорт выписки</b> — загрузить операции из банка</li>
            <li><b>«Ещё» → Резервная копия</b> — не потерять данные</li>
          </ul></div>
          ${dots}<button class="btn" data-next>Всё понятно</button>`;
      }
      el.querySelector('[data-next]').onclick = async () => {
        if (step === 1) {
          for (const inp of el.querySelectorAll('[data-acc]')) {
            const v = parseAmount(inp.value || '0');
            if (v) await S.saveAccount({ ...S.account(inp.dataset.acc), initial: v });
          }
        }
        if (step === 2) return finish();
        step++;
        render();
      };
    };
    document.body.append(el);
    render();
  });
}
