// Вкладка «Планы»: бюджеты, копилки и долги.
import { renderBudgets } from './budgets.js';
import { renderGoals } from './goals.js';
import { renderDebts } from './debts.js';

const TABS = [['budgets', 'Бюджеты'], ['goals', 'Копилки'], ['debts', 'Долги']];

export function renderPlans(view, ui) {
  ui.plansTab = ui.plansTab || 'budgets';
  view.innerHTML = `<div class="seg plans-seg">${TABS.map(([k, l]) =>
    `<button type="button" data-ptab="${k}" class="${ui.plansTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="plans-body"></div>`;
  const body = view.querySelector('.plans-body');
  if (ui.plansTab === 'budgets') renderBudgets(body, ui);
  else if (ui.plansTab === 'goals') renderGoals(body);
  else renderDebts(body);
  view.querySelectorAll('[data-ptab]').forEach((b) => b.onclick = () => { ui.plansTab = b.dataset.ptab; renderPlans(view, ui); });
}
