// Защита входа: ПИН-код и Face ID / Touch ID (через WebAuthn, проверка — на устройстве).
import * as S from './store.js';
import { openSheet } from './ui.js';
import { toast, vibrate } from './utils.js';

const LOCK_AFTER_MS = 60 * 1000;
let hiddenAt = 0;
let locked = false;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin);
  return b64(await crypto.subtle.digest('SHA-256', data));
}

export const pinEnabled = () => !!S.getMeta('pinHash');
export const faceIdEnabled = () => !!S.getMeta('faceId');

export async function faceIdAvailable() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function setPin(pin) {
  const salt = b64(rand(16));
  await S.setMeta('pinSalt', salt);
  await S.setMeta('pinHash', await hashPin(pin, salt));
}
export async function disablePin() {
  await S.setMeta('pinHash', null);
  await S.setMeta('pinSalt', null);
  await S.setMeta('faceId', null);
}
async function checkPin(pin) {
  return (await hashPin(pin, S.getMeta('pinSalt'))) === S.getMeta('pinHash');
}

export async function enableFaceId() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Мои деньги', id: location.hostname },
      user: { id: rand(16), name: 'money-user', displayName: 'Мои деньги' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  await S.setMeta('faceId', b64(cred.rawId));
}
async function verifyFaceId() {
  const id = S.getMeta('faceId');
  if (!id) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
        allowCredentials: [{ type: 'public-key', id: unb64(id) }],
      },
    });
    return true;
  } catch { return false; }
}

/** Показать экран блокировки. Возвращает Promise, который выполнится после входа. */
export function showLock() {
  if (!pinEnabled() || locked) return Promise.resolve();
  locked = true;
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'lock';
    let pin = '';
    el.innerHTML = `
      <div class="lock-ico">🔒</div>
      <div class="lock-title">Введи ПИН-код</div>
      <div class="pin-dots">${'<i></i>'.repeat(4)}</div>
      <div class="keypad lock-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'face', '0', '⌫'].map((k) =>
        k === 'face' ? (faceIdEnabled() ? '<button data-face aria-label="Войти по Face ID">🙂</button>' : '<span></span>')
          : `<button data-k="${k}">${k}</button>`).join('')}</div>
      <button class="link-btn small" data-forgot>Забыл ПИН-код?</button>`;
    document.body.append(el);
    const dots = el.querySelectorAll('.pin-dots i');
    const done = () => { locked = false; el.remove(); resolve(); };
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    el.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
      vibrate();
      pin = b.dataset.k === '⌫' ? pin.slice(0, -1) : (pin + b.dataset.k).slice(0, 4);
      paint();
      if (pin.length === 4) {
        if (await checkPin(pin)) done();
        else { el.querySelector('.pin-dots').classList.add('shake'); setTimeout(() => { el.querySelector('.pin-dots').classList.remove('shake'); pin = ''; paint(); }, 450); }
      }
    });
    const face = el.querySelector('[data-face]');
    if (face) {
      face.onclick = async () => { if (await verifyFaceId()) done(); };
      setTimeout(async () => { if (locked && await verifyFaceId()) done(); }, 300);
    }
    el.querySelector('[data-forgot]').onclick = () => {
      el.querySelector('.lock-title').innerHTML = 'ПИН-код хранится только на этом телефоне и восстановить его нельзя.<br><br>Можно удалить приложение с экрана «Домой», установить заново и восстановить данные из резервной копии.';
    };
  });
}

export function initAutoLock() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (pinEnabled() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) showLock();
  });
}

/** Шторка установки ПИН-кода (ввод дважды). */
export function openPinSetup(onDone) {
  openSheet('Новый ПИН-код', (body, close) => {
    let first = null, pin = '';
    const render = () => {
      body.innerHTML = `<p class="muted" style="text-align:center;margin:0 0 12px">${first ? 'Повтори ПИН-код' : 'Придумай 4 цифры'}</p>
        <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
        <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k ? `<button data-k="${k}">${k}</button>` : '<span></span>').join('')}</div>`;
      body.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
        pin = b.dataset.k === '⌫' ? pin.slice(0, -1) : (pin + b.dataset.k).slice(0, 4);
        if (pin.length === 4) {
          if (!first) { first = pin; pin = ''; }
          else if (first === pin) { await setPin(pin); close(); toast('ПИН-код установлен'); onDone?.(); return; }
          else { first = null; pin = ''; toast('ПИН-коды не совпали, попробуй ещё раз'); }
        }
        render();
      });
    };
    render();
  });
}
