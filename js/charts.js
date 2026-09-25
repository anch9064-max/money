// Графики на чистом SVG/HTML, без библиотек.
import { money, moneyShort, monthShort, monthLabel, esc } from './utils.js';

/** Горизонтальные полосы «расходы по категориям» (один цвет — величина). */
export function categoryBars(items, { max = 6 } = {}) {
  if (!items.length) return `<div class="empty">Пока нет расходов за этот месяц</div>`;
  const total = items.reduce((s, x) => s + x.sum, 0);
  let list = items;
  if (items.length > max) {
    const rest = items.slice(max - 1);
    list = items.slice(0, max - 1).concat({
      id: '__other', category: { name: `Прочее (${rest.length})`, icon: '⋯' },
      sum: rest.reduce((s, x) => s + x.sum, 0),
    });
  }
  const top = Math.max(...list.map((x) => x.sum));
  return `<div class="cat-bars">${list.map((x) => {
    const pct = Math.round((x.sum / total) * 100);
    return `<button class="cat-bar" data-cat="${esc(x.id)}">
      <span class="e">${x.category.icon}</span>
      <span class="n">${esc(x.category.name)}</span>
      <span class="v">${money(x.sum)}<span class="pct">${pct}%</span></span>
      <span class="track"><span class="fill" style="width:${Math.max(2, (x.sum / top) * 100)}%"></span></span>
    </button>`;
  }).join('')}</div>`;
}

/** Путь столбика со скруглёнными верхними углами (4px), основание — прямое. */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/**
 * Сгруппированные столбики «доходы / расходы» по месяцам.
 * data: [{ key: 'YYYY-MM', income, expense }]
 */
export function monthlyChart(container, data, { selected } = {}) {
  const W = Math.max(280, container.clientWidth || 340);
  const H = 180;
  const pad = { l: 44, r: 4, t: 8, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxV = niceMax(Math.max(...data.map((d) => Math.max(d.income, d.expense))));
  const y = (v) => pad.t + ih - (v / maxV) * ih;
  const colW = iw / data.length;
  const barW = Math.min(18, (colW - 14) / 2);
  const ticks = [0, 0.5, 1].map((f) => f * maxV);

  const grid = ticks.map((v) => `
    <line class="${v === 0 ? 'baseline' : 'gridline'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : moneyShort(v)}</text>`).join('');

  const cols = data.map((d, i) => {
    const cx = pad.l + colW * i + colW / 2;
    const x1 = cx - barW - 1, x2 = cx + 1; // зазор 2px между столбиками
    const dim = selected && selected !== d.key ? ' dim' : '';
    return `<g class="col${dim}" data-i="${i}">
      <path class="b-inc" d="${barPath(x1, y(d.income), barW, y(0) - y(d.income))}"/>
      <path class="b-exp" d="${barPath(x2, y(d.expense), barW, y(0) - y(d.expense))}"/>
      <text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${monthShort(d.key)}</text>
      <rect class="hit" x="${pad.l + colW * i}" y="0" width="${colW}" height="${H}"/>
    </g>`;
  }).join('');

  container.innerHTML = `
    <div class="legend">
      <span><i class="dot" style="background:var(--income)"></i>Доходы</span>
      <span><i class="dot" style="background:var(--expense)"></i>Расходы</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Доходы и расходы по месяцам">${grid}${cols}</svg>
      <div class="chart-tip" hidden></div>
    </div>
    <button class="table-toggle" type="button">Показать таблицей</button>
    <div class="table-slot" hidden>
      <table class="data"><thead><tr><th>Месяц</th><th>Доходы</th><th>Расходы</th><th>Итог</th></tr></thead>
      <tbody>${data.map((d) => `<tr><td>${monthLabel(d.key)}</td><td>${money(d.income)}</td><td>${money(d.expense)}</td><td>${money(d.income - d.expense, { sign: true })}</td></tr>`).join('')}</tbody></table>
    </div>`;

  // Подсказка при наведении / касании
  const wrap = container.querySelector('.chart-wrap');
  const tip = container.querySelector('.chart-tip');
  const svg = wrap.querySelector('svg');
  const show = (g) => {
    const d = data[Number(g.dataset.i)];
    const cx = pad.l + colW * Number(g.dataset.i) + colW / 2;
    const scale = svg.getBoundingClientRect().width / W;
    tip.innerHTML = `<b>${monthLabel(d.key)}</b><br>Доходы: ${money(d.income)}<br>Расходы: ${money(d.expense)}`;
    tip.hidden = false;
    const left = Math.min(Math.max(cx * scale, 70), wrap.clientWidth - 70);
    tip.style.left = left + 'px';
    tip.style.top = (y(Math.max(d.income, d.expense)) * scale - 6) + 'px';
  };
  svg.querySelectorAll('.col').forEach((g) => {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('click', () => show(g));
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });

  const tbtn = container.querySelector('.table-toggle');
  const slot = container.querySelector('.table-slot');
  tbtn.addEventListener('click', () => {
    slot.hidden = !slot.hidden;
    tbtn.textContent = slot.hidden ? 'Показать таблицей' : 'Скрыть таблицу';
  });
}
