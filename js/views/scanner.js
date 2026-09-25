// Сканер QR-кодов с кассовых чеков.
import * as S from '../store.js';
import { decodeQR } from '../qr.js';
import { esc, money, toast, vibrate, shortDate } from '../utils.js';
import { openTxSheet, rememberStore, budgetWarning } from './txSheet.js';

/**
 * Разбор строки из QR-кода чека: t=20260925T1435&s=450.00&fn=...&i=...&fp=...&n=1
 * @returns {null | {date, time, amount, type, fn, key}}
 */
export function parseReceipt(text) {
  if (!text) return null;
  const q = {};
  for (const part of String(text).trim().split('&')) {
    const i = part.indexOf('=');
    if (i > 0) q[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(q.t || '');
  const sum = parseFloat(String(q.s || '').replace(',', '.'));
  if (!m || !(sum > 0)) return null;
  const n = Number(q.n || 1);
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
    amount: Math.round(sum * 100),
    // 1 — покупка, 2 — возврат покупки, 3 — выдача денег, 4 — возврат выдачи
    type: n === 2 || n === 3 ? 'income' : 'expense',
    refund: n === 2,
    fn: q.fn || '',
    key: [q.fn, q.i, q.fp].join('-'),
  };
}

function findDuplicate(r) {
  return S.state.transactions.find((t) => t.receipt === r.key) || null;
}

function storeInfo(r) {
  const s = (S.getMeta('receiptStores') || {})[r.fn];
  const c = s && S.category(s.categoryId);
  return { categoryId: c && !c.archived && c.type === r.type ? s.categoryId : null, name: s?.name || '' };
}

/** Открыть камеру. batch — сразу в режиме «несколько чеков». */
export function openScanner({ batch = false } = {}) {
  let stream = null, timer = null, busy = false, stopped = false, pending = null, added = 0;
  let detector = null;
  try {
    if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch { detector = null; }

  const el = document.createElement('div');
  el.className = 'scanner';
  el.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scan-frame"><i></i><i></i><i></i><i></i></div>
    <div class="scan-top">
      <button class="scan-x" data-close aria-label="Закрыть">✕</button>
      <label class="scan-batch"><input type="checkbox" data-batch ${batch ? 'checked' : ''}> Несколько чеков</label>
    </div>
    <div class="scan-hint">Наведи камеру на QR-код чека</div>
    <div class="scan-card" hidden></div>
    <div class="scan-bottom">
      <label class="scan-alt">🖼 Из фото<input type="file" accept="image/*" data-file hidden></label>
      <button class="scan-alt" data-manual>⌨️ Ввести текст</button>
    </div>`;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  const video = el.querySelector('video');
  const hint = el.querySelector('.scan-hint');
  const card = el.querySelector('.scan-card');
  const batchBox = el.querySelector('[data-batch]');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const setHint = (t) => { hint.textContent = t; };
  const updateHint = () => setHint(added ? `Добавлено чеков: ${added}. Наведи на следующий` : 'Наведи камеру на QR-код чека');

  function stop() {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  function close() {
    stop();
    el.remove();
    if (!document.getElementById('sheet-root').children.length) document.body.style.overflow = '';
    if (added) toast(`Добавлено чеков: ${added}`);
  }
  el.querySelector('[data-close]').onclick = close;

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setHint('Камера недоступна в этом браузере. Выбери фото чека или введи текст вручную.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      if (stopped) { stop(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      loop();
    } catch (e) {
      setHint(e?.name === 'NotAllowedError'
        ? 'Нет доступа к камере. Разреши его: Настройки → Safari → Камера. Или выбери фото чека.'
        : 'Не удалось включить камеру. Выбери фото чека или введи текст вручную.');
    }
  }

  async function scanFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    if (detector) {
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      } catch { detector = null; }
    }
    // центральная область кадра, уменьшенная до ~640 px — быстрее и точнее
    const side = Math.min(vw, vh) * 0.8;
    const sx = (vw - side) / 2, sy = (vh - side) / 2;
    const size = Math.min(640, Math.round(side));
    canvas.width = size; canvas.height = size;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
    return decodeQR(ctx.getImageData(0, 0, size, size));
  }

  async function loop() {
    if (stopped) return;
    if (!busy && !pending) {
      busy = true;
      try {
        const text = await scanFrame();
        if (text) handle(text);
      } catch { /* кадр пропускаем */ }
      busy = false;
    }
    timer = setTimeout(loop, 120);
  }

  let lastText = '', lastAt = 0;
  function handle(text) {
    if (text === lastText && Date.now() - lastAt < 4000) return;
    lastText = text; lastAt = Date.now();
    const r = parseReceipt(text);
    if (!r) { setHint('Это не QR-код кассового чека'); setTimeout(updateHint, 2000); return; }
    vibrate();
    const dup = findDuplicate(r);
    if (batchBox.checked) showCard(r, dup);
    else {
      if (dup) {
        setHint(`Этот чек уже добавлен (${shortDate(dup.date)}, ${money(dup.amount)})`);
        setTimeout(updateHint, 2500);
        return;
      }
      close();
      openFromReceipt(r);
    }
  }

  function showCard(r, dup) {
    pending = r;
    const info = storeInfo(r);
    let catId = info.categoryId || S.suggestCategory(info.name, r.type) || null;
    const cats = S.activeCategories(r.type);
    card.hidden = false;
    card.innerHTML = `
      <div class="sc-head"><b class="num">${money(r.amount)}</b><span class="muted">${shortDate(r.date)}, ${r.time}${r.refund ? ' · возврат' : ''}</span></div>
      ${dup ? '<div class="sc-dup">⚠️ Этот чек уже добавлен</div>' : ''}
      <input class="input" data-name placeholder="Магазин (необязательно)" value="${esc(info.name)}" maxlength="60">
      <div class="cat-grid">${cats.map((c) => `<button type="button" class="cat-pick ${c.id === catId ? 'on' : ''}" data-cat="${c.id}">
        <span class="e">${c.icon}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
      <div class="sc-actions"><button class="btn secondary" data-skip>Пропустить</button>
        <button class="btn" data-add ${catId && !dup ? '' : 'disabled'}>Добавить</button></div>`;
    const addBtn = card.querySelector('[data-add]');
    card.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
      catId = b.dataset.cat;
      card.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      addBtn.disabled = false;
    });
    card.querySelector('[data-skip]').onclick = () => { pending = null; card.hidden = true; updateHint(); };
    addBtn.onclick = async () => {
      const name = card.querySelector('[data-name]').value.trim();
      const accountId = S.getMeta('lastAccount') && S.account(S.getMeta('lastAccount')) ? S.getMeta('lastAccount') : S.regularAccounts()[0]?.id;
      const t = await S.saveTransaction({
        type: r.type, amount: r.amount, date: r.date, time: r.time, categoryId: catId, accountId,
        note: name || (r.refund ? 'Возврат по чеку' : 'Покупка по чеку'), receipt: r.key,
      });
      await rememberStore(r.fn, catId, name);
      if (name) S.learnCategory(name, catId);
      added++;
      pending = null; card.hidden = true;
      budgetWarning(t);
      updateHint();
    };
  }

  el.querySelector('[data-file]').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setHint('Ищу QR-код на фото…');
    const text = await decodeFile(file);
    lastText = '';
    if (text) handle(text);
    else setHint('На фото не нашёлся QR-код. Сфотографируй поближе и ровнее.');
  };
  el.querySelector('[data-manual]').onclick = () => {
    const box = document.createElement('div');
    box.className = 'scan-manual';
    box.innerHTML = `<p class="small">Вставь текст из QR-кода (например, из приложения «Проверка чеков») или введи данные с чека:</p>
      <textarea class="input" rows="3" placeholder="t=20260925T1435&s=450.00&fn=…&i=…&fp=…&n=1"></textarea>
      <div class="sc-actions"><button class="btn secondary" data-cancel>Отмена</button><button class="btn" data-ok>Готово</button></div>`;
    el.append(box);
    box.querySelector('[data-cancel]').onclick = () => box.remove();
    box.querySelector('[data-ok]').onclick = () => {
      const v = box.querySelector('textarea').value;
      box.remove();
      lastText = '';
      handle(v);
    };
  };

  start();
  return close;
}

/** Открыть обычную шторку операции, заполненную из чека. */
export function openFromReceipt(r) {
  const info = storeInfo(r);
  openTxSheet({
    prefill: {
      type: r.type, amount: r.amount, date: r.date, time: r.time,
      note: info.name || (r.refund ? 'Возврат по чеку' : ''),
      categoryId: info.categoryId || S.suggestCategory(info.name, r.type),
      receipt: r.key, receiptFn: r.fn,
    },
  });
}

/** Найти QR-код на фотографии (пробуем несколько масштабов). */
export async function decodeFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
    });
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    for (const max of [1000, 700, 1400]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const text = decodeQR(ctx.getImageData(0, 0, c.width, c.height));
      if (text) return text;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

