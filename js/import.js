// Разбор банковских выписок: Т-Банк (CSV), Сбер (PDF) и любые похожие CSV.
import * as S from './store.js';
import { hash } from './utils.js';

// ===================== Чтение файла =====================
export function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('windows-1251').decode(bytes); }
  return text.replace(/^﻿/, '');
}

export function parseCSV(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => first.split(ch).length - 1;
  const delim = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// ===================== Разбор значений =====================
export function parseMoney(s) {
  if (s == null) return null;
  let t = String(s).replace(/[\s  ]/g, '').replace('−', '-').replace(/[₽a-zа-я]/gi, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export function parseDateTime(s) {
  const v = String(s || '').trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(v);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return { date: `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(v);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null };
  return null;
}

// ===================== CSV: Т-Банк и похожие =====================
export function parseStatementCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const hIdx = rows.findIndex((r) => r.some((c) => /дата/i.test(c)) && r.some((c) => /сумма|приход|расход|списани|зачислени/i.test(c)));
  if (hIdx < 0) return [];
  const head = rows[hIdx].map((h) => h.trim().toLowerCase());
  const col = (...res) => {
    for (const re of res) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) return i; }
    return -1;
  };
  const cDate = col(/^дата операции/, /^дата/);
  const cAmount = col(/^сумма платежа$/, /^сумма операции$/, /^сумма в валюте сч/, /^сумма/);
  const cOut = col(/расход|списани|дебет/);
  const cIn = col(/приход|зачислени|поступлени|кредит/);
  const cStatus = col(/статус/);
  const cDesc = col(/^описание/, /назначение/, /контрагент|получатель/, /комментари/);
  const cCat = col(/^категория/);
  const cMcc = col(/^mcc/);
  const cCur = col(/валюта платежа/, /^валюта/);
  const out = [];
  for (const r of rows.slice(hIdx + 1)) {
    const dt = parseDateTime(r[cDate]);
    if (!dt) continue;
    if (cStatus >= 0 && /failed|отклон|ошибк/i.test(r[cStatus] || '')) continue;
    let amount = cAmount >= 0 ? parseMoney(r[cAmount]) : null;
    if (amount == null && (cOut >= 0 || cIn >= 0)) {
      const o = parseMoney(r[cOut]) || 0, i = parseMoney(r[cIn]) || 0;
      amount = i ? Math.abs(i) : -Math.abs(o);
    }
    if (!amount) continue;
    out.push({
      date: dt.date, time: dt.time,
      type: amount < 0 ? 'expense' : 'income', amount: Math.abs(amount),
      description: (r[cDesc] || '').trim(),
      bankCategory: (r[cCat] || '').trim(),
      mcc: (r[cMcc] || '').trim(),
      currency: (r[cCur] || '').trim().toUpperCase().replace('RUR', 'RUB'),
    });
  }
  return out;
}

// ===================== PDF: Сбер и похожие =====================
async function pdfLines(buf) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim());
  }
  return lines;
}

const AMT = '[+−-]?\\d{1,3}(?:[ \\u00a0]\\d{3})*,\\d{2}';
const SBER_LINE = new RegExp(`^(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(\\d{2}:\\d{2})\\s+(?:(\\d{6})\\s+)?(.*?)\\s*(${AMT})(?:\\s+(${AMT}))?$`);

export function parseStatementLines(lines) {
  const out = [];
  let cur = null;
  const skip = /^(продолжение на следующей|страница|дата операции|дата обработки|расшифровка|остаток|итого|сумма в валюте|категория|описание операции|по счёту|по счету|выписка|действительна|для проверки)/i;
  for (const raw of lines) {
    const line = raw.trim();
    const m = SBER_LINE.exec(line);
    if (m) {
      const amt = m[5];
      const val = parseMoney(amt.replace('+', ''));
      if (!val) { cur = null; continue; }
      const [d, mo, y] = m[1].split('.');
      cur = {
        date: `${y}-${mo}-${d}`, time: m[2],
        type: amt.trim().startsWith('+') ? 'income' : 'expense', amount: Math.abs(val),
        bankCategory: (m[4] || '').trim(), description: '', mcc: '',
      };
      out.push(cur);
      continue;
    }
    if (!cur || skip.test(line)) continue;
    // строка описания: «25.09.2026 PYATEROCHKA 1234 Krasnoyarsk RUS. Операция по карте ****1234»
    const desc = line.replace(/^\d{2}\.\d{2}\.\d{4}\s*/, '').replace(/\.?\s*Операция по (карте|счету|счёту)\s*\*+\d+/i, '').trim();
    if (desc && cur.description.length < 120) cur.description = (cur.description ? cur.description + ' ' : '') + desc;
  }
  return out.filter((r) => r.date >= '2000-01-01');
}

export async function parseFile(file) {
  const buf = await file.arrayBuffer();
  const isPdf = /\.pdf$/i.test(file.name) || new Uint8Array(buf.slice(0, 5)).every((b, i) => b === [37, 80, 68, 70, 45][i]);
  if (isPdf) return { kind: 'pdf', rows: parseStatementLines(await pdfLines(buf)) };
  const text = decodeText(buf);
  return { kind: 'csv', rows: parseStatementCSV(text) };
}

// ===================== Категории =====================
const RULES = [
  ['expense', 'Переводы', /перевод|сбп|transfer|card2card|c2c/i],
  ['expense', 'Подписки', /подписк|яндекс плюс|yandex\.?plus|кинопоиск|kinopoisk|ivi\b|okko|spotify|apple\.com|itunes|vk музык|boom/i],
  ['expense', 'Продукты', /супермаркет|продукт|пятерочк|пятёрочк|pyaterochk|перекрест|perekrest|магнит|magnit|ашан|auchan|вкусвилл|vkusvill|дикси|dixy|лента|lenta|spar\b|окей|o'key|самокат|samokat|fix ?price|светофор|мария-ра|бристоль|красное.белое|krasnoe|metro c&c|азбука вкуса|globus|глобус/i],
  ['expense', 'Кафе', /ресторан|кафе|фастфуд|fast ?food|кофе|coffee|cafe|restoran|kfc|burger|бургер|вкусно.+точка|додо|dodo|шоколадниц|яндекс еда|eda\.yandex|delivery|суши|sushi|пицц|pizza|столов|бар\b/i],
  ['expense', 'Транспорт', /транспорт|такси|taxi|yandex\.?go|uber|метрополит|metropoliten|азс|топлив|fuel|бензин|лукойл|lukoil|газпромнефт|gazprom ?neft|роснефт|rosneft|tatneft|парковк|parking|каршеринг|делимобил|citydrive|belka|ржд|rzd|аэрофлот|aeroflot|авиа|avia|пригород|автобус|троллейб|тройка|strelka|автомобил/i],
  ['expense', 'Здоровье', /аптек|apteka|медицин|клиник|clinic|стоматолог|здоров|36[,.]6|ригла|rigla|eapteka|инвитро|invitro|гемотест|анализ/i],
  ['expense', 'Одежда', /одежд|обув|zara|lamoda|gloria|спортмастер|sportmaster|befree|o'stin|ostin|lime\b|love republic|h&m|uniqlo|аксессуар/i],
  ['expense', 'Связь', /связь|мобильн|\bмтс\b|\bmts\b|билайн|beeline|мегафон|megafon|tele2|\bт2\b|ростелеком|rostelecom|интернет|internet|дом\.ру/i],
  ['expense', 'Жильё', /жкх|коммунал|квартпл|электроэнерг|энергосбыт|водоканал|газпром межрегионгаз|аренд|управляющ|капремонт|жилищ/i],
  ['expense', 'Развлечения', /развлеч|кино|cinema|театр|концерт|билет|ticket|игр|steam|playstation|xbox|отдых|боулинг|бассейн|фитнес|fitness/i],
  ['expense', 'Подарки', /подарк|цвет/i],
  ['income', 'Зарплата', /зарплат|заработн|аванс|salary|оплата труда/i],
  ['income', 'Кэшбэк', /кэшб|кешб|cashback|бонус|проценты на остаток|начисление процент/i],
  ['income', 'Переводы', /перевод|сбп|transfer|пополнени/i],
];
const MCC = [
  [[5411, 5422, 5441, 5451, 5462, 5499, 5300, 5311], 'Продукты'],
  [[5812, 5813, 5814], 'Кафе'],
  [[4111, 4112, 4121, 4131, 4784, 5541, 5542, 7523, 4511, 3000], 'Транспорт'],
  [[5912, 8011, 8021, 8062, 8071, 8099], 'Здоровье'],
  [[5611, 5621, 5631, 5641, 5651, 5661, 5691, 5699], 'Одежда'],
  [[4812, 4814, 4899], 'Связь'],
  [[4900], 'Жильё'],
  [[7832, 7922, 7941, 7996, 7997, 7999, 5815, 5816, 5817, 5818], 'Развлечения'],
];

function catByName(type, name) {
  return S.state.categories.find((c) => c.type === type && !c.archived && c.name.toLowerCase() === name.toLowerCase())?.id || null;
}
export function mapCategory(row) {
  const text = `${row.bankCategory} ${row.description}`;
  const learned = S.suggestCategory(row.description, row.type);
  if (learned) return learned;
  for (const [type, name, re] of RULES) {
    if (type === row.type && re.test(text)) { const id = catByName(type, name); if (id) return id; }
  }
  const mcc = parseInt(row.mcc, 10);
  if (mcc && row.type === 'expense') {
    for (const [codes, name] of MCC) if (codes.includes(mcc)) { const id = catByName('expense', name); if (id) return id; }
  }
  return catByName(row.type, 'Другое') || S.activeCategories(row.type).slice(-1)[0]?.id || null;
}

// ===================== Подготовка к импорту =====================
export function importKey(accountId, r) {
  return hash([accountId, r.date, r.time || '', r.amount, r.type, S.normKey(r.description)].join('|'));
}

/** Подготовить строки: ключ, категория, пометки о дублях и переводах между своими счетами. */
export async function prepare(rows, accountId) {
  await S.ensureCategory('expense', 'Переводы', '🔄');
  await S.ensureCategory('income', 'Переводы', '🔄');
  const existing = new Set(S.state.transactions.map((t) => t.importKey).filter(Boolean));
  const manual = S.state.transactions.filter((t) => !t.importKey && (t.type === 'income' || t.type === 'expense'));
  const out = [];
  let already = 0;
  for (const r of rows) {
    const key = importKey(accountId, r);
    if (existing.has(key)) { already++; continue; }
    existing.add(key);
    const similar = manual.find((t) => t.date === r.date && t.amount === r.amount && t.type === r.type);
    const own = /между сво|на свой сч|со своего сч|собственн.+сч|инвесткопилк/i.test(`${r.description} ${r.bankCategory}`);
    const categoryId = mapCategory(r);
    out.push({
      ...r, key, categoryId, suggested: categoryId,
      checked: !similar && !own,
      flag: similar ? 'Похоже, уже добавлена вручную' : own ? 'Перевод между своими счетами' : '',
    });
  }
  return { rows: out.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))), already };
}

export async function commit(rows, accountId) {
  const chosen = rows.filter((r) => r.checked);
  await S.saveTransactions(chosen.map((r) => ({
    type: r.type, amount: r.amount, accountId, categoryId: r.categoryId, date: r.date, time: r.time || null,
    note: (r.description || r.bankCategory || '').slice(0, 120), importKey: r.key,
  })));
  for (const r of chosen) if (r.categoryId !== r.suggested && r.description) await S.learnCategory(r.description, r.categoryId);
  return chosen.length;
}
