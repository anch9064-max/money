// Нижняя «шторка» (bottom sheet) и общие элементы интерфейса.
import { esc } from './utils.js';

/**
 * Открыть шторку.
 * @param {string} title
 * @param {(body: HTMLElement, close: () => void) => void} render — рисует содержимое
 */
export function openSheet(title, render) {
  const root = document.getElementById('sheet-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="link-btn" data-close>Закрыть</button></div>
    <div class="sheet-body"></div>`;
  root.append(backdrop, sheet);
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      sheet.remove(); backdrop.remove();
      if (!root.children.length) document.body.style.overflow = '';
    }, 250);
  };
  backdrop.addEventListener('click', close);
  sheet.querySelector('[data-close]').addEventListener('click', close);

  // Свайп вниз за «ручку» закрывает шторку
  let startY = null;
  sheet.addEventListener('touchstart', (e) => { if (sheet.scrollTop <= 0) startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transform = '';
    startY = null;
    if (dy > 120) close();
  });

  render(sheet.querySelector('.sheet-body'), close);
  requestAnimationFrame(() => { sheet.classList.add('open'); backdrop.classList.add('open'); });
  return close;
}

export const EMOJIS = [
  '🛒', '☕', '🍔', '🍕', '🚌', '🚕', '⛽', '🚗', '🏠', '💡', '📱', '🌐', '💊', '🏥', '👕', '👟',
  '🎮', '🎬', '🎵', '📚', '🎓', '🎁', '🐶', '✈️', '🏖', '💇', '🏋️', '🍷', '🚬', '👶', '🔁', '📦',
  '💼', '💻', '💸', '💰', '📈', '🏦', '💳', '💵', '🪙', '🎉', '🛠', '🧾', '❤️', '⭐', '🔧', '🧸',
];

export function emojiPicker(selected) {
  return `<div class="emoji-grid">${EMOJIS.map((e) =>
    `<button type="button" data-emoji="${e}" class="${e === selected ? 'on' : ''}">${e}</button>`).join('')}</div>`;
}
export function bindEmojiPicker(root, onPick) {
  root.querySelectorAll('[data-emoji]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-emoji]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    onPick(b.dataset.emoji);
  }));
}

export function confirmSheet(title, text, okLabel, onOk) {
  openSheet(title, (body, close) => {
    body.innerHTML = `<p class="muted" style="margin:0 0 16px">${esc(text)}</p>
      <button class="btn" data-ok style="background:var(--critical)">${esc(okLabel)}</button>
      <div style="height:8px"></div>
      <button class="btn secondary" data-cancel>Отмена</button>`;
    body.querySelector('[data-ok]').onclick = () => { close(); onOk(); };
    body.querySelector('[data-cancel]').onclick = close;
  });
}
