// Декодер QR-кодов на чистом JavaScript (версии 1–10, этого с запасом хватает для чеков).
// Этапы: бинаризация → поиск трёх «глазков» → выравнивающий узор → перспектива →
// чтение формата и маски → код Рида–Соломона → разбор данных.

// ===================== Бинаризация =====================
function toGray(data, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  // лёгкое размытие 3×3 убирает шум матрицы камеры
  const s = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += g[yy * w + xx]; n++;
        }
      }
      s[y * w + x] = sum / n;
    }
  }
  return [g, s];
}

/** Адаптивный порог по блокам 8×8 (устойчив к теням и неравномерному свету). */
function binarize(gray, w, h, invert = false) {
  const B = 8;
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const avg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0, min = 255, max = 0, n = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y++) {
        for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
          const v = gray[y * w + x];
          sum += v; n++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      let a = sum / n;
      if (max - min <= 24) {
        // однотонный блок — скорее всего фон; берём мягкий порог
        a = min / 2;
        if (by > 0 && bx > 0) {
          const nb = (avg[(by - 1) * bw + bx] + 2 * avg[by * bw + bx - 1] + avg[(by - 1) * bw + bx - 1]) / 4;
          if (min < nb) a = nb;
        }
      }
      avg[by * bw + bx] = a;
    }
  }
  const bits = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = Math.min(bh - 1, Math.max(0, by + dy));
          const xx = Math.min(bw - 1, Math.max(0, bx + dx));
          s += avg[yy * bw + xx]; n++;
        }
      }
      const t = s / n;
      for (let y = by * B; y < Math.min(h, by * B + B); y++) {
        for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
          const dark = gray[y * w + x] <= t;
          bits[y * w + x] = (dark !== invert) ? 1 : 0;
        }
      }
    }
  }
  return bits;
}

// ===================== Поиск «глазков» (finder patterns) =====================
function ratioOk(sc) {
  let total = 0;
  for (const c of sc) { if (!c) return false; total += c; }
  if (total < 7) return false;
  const m = total / 7, v = m / 1.6;
  return Math.abs(m - sc[0]) < v && Math.abs(m - sc[1]) < v && Math.abs(3 * m - sc[2]) < 3 * v &&
    Math.abs(m - sc[3]) < v && Math.abs(m - sc[4]) < v;
}

/** Пробег B-W-B-W-B вдоль направления (dx,dy) через точку (x,y). Возвращает смещение центра и счётчики. */
function crossCheck(bits, w, h, x, y, dx, dy, maxCount) {
  const get = (t) => {
    const xx = Math.round(x + dx * t), yy = Math.round(y + dy * t);
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) return -1;
    return bits[yy * w + xx];
  };
  const sc = [0, 0, 0, 0, 0];
  let t = 0;
  // назад: центр (чёрный), белый, чёрный
  while (get(t) === 1) { sc[2]++; t--; }
  const a = sc[2];
  if (get(t) === -1) return null;
  while (get(t) === 0 && sc[1] <= maxCount) { sc[1]++; t--; }
  if (get(t) === -1 || sc[1] > maxCount) return null;
  while (get(t) === 1 && sc[0] <= maxCount) { sc[0]++; t--; }
  if (sc[0] > maxCount) return null;
  // вперёд
  t = 1;
  let b = 0;
  while (get(t) === 1) { sc[2]++; b++; t++; }
  if (get(t) === -1) return null;
  while (get(t) === 0 && sc[3] <= maxCount) { sc[3]++; t++; }
  if (get(t) === -1 || sc[3] > maxCount) return null;
  while (get(t) === 1 && sc[4] <= maxCount) { sc[4]++; t++; }
  if (sc[4] > maxCount) return null;
  if (!ratioOk(sc)) return null;
  return { offset: (b - (a - 1)) / 2, sc, total: sc.reduce((s, v) => s + v, 0) };
}

function findFinders(bits, w, h) {
  const found = [];
  const skip = Math.max(2, Math.floor(h / 300));

  const handle = (sc, y, xEnd) => {
    const total = sc.reduce((s, v) => s + v, 0);
    let cx = xEnd - sc[4] - sc[3] - sc[2] / 2;
    const v = crossCheck(bits, w, h, cx, y, 0, 1, sc[2]);
    if (!v || 5 * Math.abs(v.total - total) >= 2 * total) return false;
    const cy = y + v.offset;
    const hz = crossCheck(bits, w, h, cx, cy, 1, 0, sc[2]);
    if (!hz || 5 * Math.abs(hz.total - total) >= 2 * total) return false;
    cx += hz.offset;
    const v2 = crossCheck(bits, w, h, cx, cy, 0, 1, sc[2]);
    const ccy = v2 ? cy + v2.offset : cy;
    const d = crossCheck(bits, w, h, cx, ccy, 1, 1, sc[2] * 1.5);
    if (!d) return false;
    const m = (v.total + hz.total) / 14;
    for (const p of found) {
      if (Math.abs(ccy - p.y) <= m && Math.abs(cx - p.x) <= m && Math.abs(m - p.m) <= Math.max(1, p.m * 0.5)) {
        const n = p.count + 1;
        p.x = (p.x * p.count + cx) / n; p.y = (p.y * p.count + ccy) / n; p.m = (p.m * p.count + m) / n;
        p.count = n;
        return true;
      }
    }
    found.push({ x: cx, y: ccy, m, count: 1 });
    return true;
  };

  for (let y = skip - 1; y < h; y += skip) {
    const sc = [0, 0, 0, 0, 0];
    let state = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (bits[row + x]) {
        if (state & 1) state++;
        sc[state]++;
      } else {
        if (state === 0 && sc[0] === 0) continue;
        if (!(state & 1)) {
          if (state === 4) {
            if (ratioOk(sc) && handle(sc, y, x)) {
              sc.fill(0); state = 0;
            } else {
              sc[0] = sc[2]; sc[1] = sc[3]; sc[2] = sc[4]; sc[3] = 1; sc[4] = 0; state = 3;
            }
          } else { state++; sc[state]++; }
        } else sc[state]++;
      }
    }
    if (state === 4 && ratioOk(sc)) handle(sc, y, w);
  }
  return found;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Выбрать тройки глазков, похожие на угол квадрата, лучшие — первыми. */
function pickTriples(found) {
  const c = [...found].sort((a, b) => b.count - a.count).slice(0, 12);
  const out = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
    const t = [c[i], c[j], c[k]];
    const ms = t.map((p) => p.m), mAvg = (ms[0] + ms[1] + ms[2]) / 3;
    const mVar = Math.max(...ms.map((m) => Math.abs(m - mAvg))) / mAvg;
    if (mVar > 0.5) continue;
    const d = [dist(t[0], t[1]), dist(t[1], t[2]), dist(t[0], t[2])].sort((a, b) => a - b);
    if (d[0] < mAvg * 10) continue; // слишком близко — не QR
    const score = Math.abs(d[2] - Math.SQRT2 * d[1]) / d[2] + Math.abs(d[0] - d[1]) / d[1] + mVar * 0.5;
    out.push({ t, score });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 4).map((x) => orderPatterns(x.t));
}

function orderPatterns([a, b, c]) {
  const ab = dist(a, b), bc = dist(b, c), ac = dist(a, c);
  let tl, p1, p2;
  if (bc >= ab && bc >= ac) { tl = a; p1 = b; p2 = c; }
  else if (ac >= ab && ac >= bc) { tl = b; p1 = a; p2 = c; }
  else { tl = c; p1 = a; p2 = b; }
  const cross = (p1.x - tl.x) * (p2.y - tl.y) - (p1.y - tl.y) * (p2.x - tl.x);
  return cross > 0 ? { tl, tr: p1, bl: p2 } : { tl, tr: p2, bl: p1 };
}

// ===================== Перспектива =====================
function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
  if (dx3 === 0 && dy3 === 0) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den;
  const a23 = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
}
function adjoint(m) {
  const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
  return [
    a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31,
    a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32,
    a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21,
  ];
}
// Матрицы хранятся как [a11, a21, a31, a12, a22, a32, a13, a23, a33] (как в ZXing)
function times(a, b) {
  const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = a;
  const [b11, b21, b31, b12, b22, b32, b13, b23, b33] = b;
  return [
    a11 * b11 + a21 * b12 + a31 * b13, a11 * b21 + a21 * b22 + a31 * b23, a11 * b31 + a21 * b32 + a31 * b33,
    a12 * b11 + a22 * b12 + a32 * b13, a12 * b21 + a22 * b22 + a32 * b23, a12 * b31 + a22 * b32 + a32 * b33,
    a13 * b11 + a23 * b12 + a33 * b13, a13 * b21 + a23 * b22 + a33 * b23, a13 * b31 + a23 * b32 + a33 * b33,
  ];
}
/** Преобразование из квадрата модулей (src) в точки изображения (dst). Порядок точек: TL, TR, BR, BL. */
function quadToQuad(src, dst) {
  const qToS = adjoint(squareToQuad(...src));
  const sToQ = squareToQuad(...dst);
  const m = times(sToQ, qToS);
  return (x, y) => {
    const den = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / den, (m[3] * x + m[4] * y + m[5]) / den];
  };
}

// ===================== Таблицы QR =====================
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
// [ecPerBlock, [blocks, dataCodewords], ...] для уровней L, M, Q, H
const EC = [null,
  { L: [7, [1, 19]], M: [10, [1, 16]], Q: [13, [1, 13]], H: [17, [1, 9]] },
  { L: [10, [1, 34]], M: [16, [1, 28]], Q: [22, [1, 22]], H: [28, [1, 16]] },
  { L: [15, [1, 55]], M: [26, [1, 44]], Q: [18, [2, 17]], H: [22, [2, 13]] },
  { L: [20, [1, 80]], M: [18, [2, 32]], Q: [26, [2, 24]], H: [16, [4, 9]] },
  { L: [26, [1, 108]], M: [24, [2, 43]], Q: [18, [2, 15], [2, 16]], H: [22, [2, 11], [2, 12]] },
  { L: [18, [2, 68]], M: [16, [4, 27]], Q: [24, [4, 19]], H: [28, [4, 15]] },
  { L: [20, [2, 78]], M: [18, [4, 31]], Q: [18, [2, 14], [4, 15]], H: [26, [4, 13], [1, 14]] },
  { L: [24, [2, 97]], M: [22, [2, 38], [2, 39]], Q: [22, [4, 18], [2, 19]], H: [26, [4, 14], [2, 15]] },
  { L: [30, [2, 116]], M: [22, [3, 36], [2, 37]], Q: [20, [4, 16], [4, 17]], H: [24, [4, 12], [4, 13]] },
  { L: [18, [2, 68], [2, 69]], M: [26, [4, 43], [1, 44]], Q: [24, [6, 19], [2, 20]], H: [28, [6, 15], [2, 16]] },
];
const EC_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

const FORMATS = (() => {
  const out = [];
  for (let d = 0; d < 32; d++) {
    let v = d << 10;
    for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
    out.push({ code: ((d << 10) | v) ^ 0x5412, ec: EC_BITS[d >> 3], mask: d & 7 });
  }
  return out;
})();
const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

function functionMask(version) {
  const n = 17 + 4 * version;
  const f = new Uint8Array(n * n);
  const set = (r0, c0, hgt, wid) => {
    for (let r = r0; r < r0 + hgt; r++) for (let c = c0; c < c0 + wid; c++) if (r >= 0 && c >= 0 && r < n && c < n) f[r * n + c] = 1;
  };
  set(0, 0, 9, 9); set(0, n - 8, 9, 8); set(n - 8, 0, 8, 9);
  set(6, 0, 1, n); set(0, 6, n, 1);
  const al = ALIGN[version];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) continue;
    set(r - 2, c - 2, 5, 5);
  }
  if (version >= 7) { set(0, n - 11, 6, 3); set(n - 11, 0, 3, 6); }
  return f;
}

// ===================== Рид–Соломон, GF(256) =====================
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const gdiv = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

/** Исправляет ошибки на месте. cw — данные+коды, старшая степень первой. Возвращает false, если не удалось. */
export function rsCorrect(cw, nsym) {
  const n = cw.length;
  const S = new Array(nsym).fill(0);
  let bad = false;
  for (let j = 0; j < nsym; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s = gmul(s, EXP[j]) ^ cw[k];
    S[j] = s;
    if (s) bad = true;
  }
  if (!bad) return true;
  // Берлекэмп–Мэсси (коэффициенты от младшей степени)
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < nsym; i++) {
    let d = S[i];
    for (let k = 1; k <= L; k++) d ^= gmul(C[k] || 0, S[i - k]);
    if (d === 0) { m++; continue; }
    const coef = gdiv(d, b);
    const T = C.slice();
    const len = Math.max(C.length, B.length + m);
    const Cn = new Array(len).fill(0);
    for (let k = 0; k < C.length; k++) Cn[k] = C[k];
    for (let k = 0; k < B.length; k++) Cn[k + m] ^= gmul(coef, B[k]);
    C = Cn;
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (2 * L > nsym) return false;
  const evalPoly = (p, x) => { let r = 0; for (let k = p.length - 1; k >= 0; k--) r = gmul(r, x) ^ p[k]; return r; };
  // Ω(x) = S(x)·Λ(x) mod x^nsym
  const Om = new Array(nsym).fill(0);
  for (let i = 0; i < nsym; i++) for (let k = 0; k < C.length && k <= i; k++) Om[i] ^= gmul(C[k], S[i - k]);
  const dC = C.map((c, k) => (k % 2 === 1 ? c : 0)).slice(1); // формальная производная
  let found = 0;
  for (let k = 0; k < n; k++) {
    const e = n - 1 - k;
    const xinv = EXP[(255 - e) % 255];
    if (evalPoly(C, xinv) === 0) {
      const num = gmul(EXP[e], evalPoly(Om, xinv));
      const den = evalPoly(dC, xinv);
      if (!den) return false;
      cw[k] ^= gdiv(num, den);
      found++;
    }
  }
  return found === L;
}

// ===================== Разбор данных =====================
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function decodeBits(bytes, version) {
  let pos = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = bytes[pos >> 3];
      v = (v << 1) | (byte === undefined ? 0 : (byte >> (7 - (pos & 7))) & 1);
      pos++;
    }
    return v;
  };
  const left = () => bytes.length * 8 - pos;
  const big = version >= 10;
  let out = '';
  const raw = [];
  while (left() >= 4) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 7) { // ECI
      const first = read(8);
      if ((first & 0x80) === 0x80) read((first & 0x40) ? 16 : 8);
      continue;
    }
    if (mode === 1) {
      let cnt = read(big ? 12 : 10);
      while (cnt >= 3) { out += String(read(10)).padStart(3, '0'); cnt -= 3; }
      if (cnt === 2) out += String(read(7)).padStart(2, '0');
      else if (cnt === 1) out += String(read(4));
    } else if (mode === 2) {
      let cnt = read(big ? 11 : 9);
      while (cnt >= 2) { const v = read(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; cnt -= 2; }
      if (cnt === 1) out += ALNUM[read(6)];
    } else if (mode === 4) {
      const cnt = read(big ? 16 : 8);
      if (cnt * 8 > left()) return null;
      const buf = [];
      for (let i = 0; i < cnt; i++) buf.push(read(8));
      raw.push(...buf);
      try { out += new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buf)); }
      catch { out += String.fromCharCode(...buf); }
    } else {
      return null; // кандзи и прочее в чеках не встречаются
    }
  }
  return out;
}

function decodeMatrix(get, version) {
  const n = 17 + 4 * version;
  // формат
  let f1 = 0, f2 = 0;
  const bit = (x, y) => (get(x, y) ? 1 : 0);
  for (let i = 0; i <= 5; i++) f1 = (f1 << 1) | bit(i, 8);
  f1 = (f1 << 1) | bit(7, 8); f1 = (f1 << 1) | bit(8, 8); f1 = (f1 << 1) | bit(8, 7);
  for (let j = 5; j >= 0; j--) f1 = (f1 << 1) | bit(8, j);
  for (let j = n - 1; j >= n - 7; j--) f2 = (f2 << 1) | bit(8, j);
  for (let i = n - 8; i < n; i++) f2 = (f2 << 1) | bit(i, 8);
  let best = null, bestD = 99;
  for (const f of FORMATS) {
    for (const v of [f1, f2]) {
      const d = popcount(f.code ^ v);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  if (!best || bestD > 3) return null;
  const fm = functionMask(version);
  const mask = MASKS[best.mask];
  // чтение кодовых слов зигзагом
  const codewords = [];
  let up = true, cur = 0, nb = 0;
  for (let j = n - 1; j > 0; j -= 2) {
    if (j === 6) j--;
    for (let c = 0; c < n; c++) {
      const i = up ? n - 1 - c : c;
      for (let k = 0; k < 2; k++) {
        const x = j - k;
        if (fm[i * n + x]) continue;
        let b = get(x, i) ? 1 : 0;
        if (mask(i, x)) b ^= 1;
        cur = (cur << 1) | b; nb++;
        if (nb === 8) { codewords.push(cur); cur = 0; nb = 0; }
      }
    }
    up = !up;
  }
  const [ecPer, ...groups] = EC[version][best.ec];
  const blocks = [];
  for (const [count, dataCw] of groups) for (let i = 0; i < count; i++) blocks.push({ data: dataCw, cw: [] });
  const total = blocks.reduce((s, b) => s + b.data + ecPer, 0);
  if (codewords.length < total) return null;
  const maxData = Math.max(...blocks.map((b) => b.data));
  let p = 0;
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data) b.cw.push(codewords[p++]);
  for (let i = 0; i < ecPer; i++) for (const b of blocks) b.cw.push(codewords[p++]);
  const data = [];
  for (const b of blocks) {
    if (!rsCorrect(b.cw, ecPer)) return null;
    data.push(...b.cw.slice(0, b.data));
  }
  return decodeBits(data, version);
}

// ===================== Сэмплирование и сборка =====================
function sampleGrid(gray, w, h, tl, tr, bl, br, dim, brIsAlignment) {
  const off = brIsAlignment ? dim - 6.5 : dim - 3.5;
  const tf = quadToQuad([3.5, 3.5, dim - 3.5, 3.5, off, off, 3.5, dim - 3.5],
    [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const px = (x, y) => {
    const [a, b] = tf(x, y);
    const ix = Math.round(a - 0.5), iy = Math.round(b - 0.5);
    return ix >= 0 && iy >= 0 && ix < w && iy < h ? gray[iy * w + ix] : 255;
  };
  // средняя яркость каждого модуля (5 точек)
  const val = new Float32Array(dim * dim);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    val[y * dim + x] = (2 * px(cx, cy) + px(cx - 0.2, cy) + px(cx + 0.2, cy) + px(cx, cy - 0.2) + px(cx, cy + 0.2)) / 6;
  }
  // локальный порог по соседним модулям: середина между самым тёмным и самым светлым
  const grid = new Uint8Array(dim * dim);
  const R = 3;
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    let mn = 255, mx = 0;
    for (let yy = Math.max(0, y - R); yy <= Math.min(dim - 1, y + R); yy++) {
      for (let xx = Math.max(0, x - R); xx <= Math.min(dim - 1, x + R); xx++) {
        const v = val[yy * dim + xx];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const v = val[y * dim + x];
    grid[y * dim + x] = mx - mn < 20 ? (v < 128 ? 1 : 0) : (v < (mn + mx) / 2 ? 1 : 0);
  }
  return (x, y) => grid[y * dim + x];
}

function findAlignment(bits, w, h, tl, tr, bl, dim, mod) {
  const n7 = dim - 7;
  const ux = { x: (tr.x - tl.x) / n7, y: (tr.y - tl.y) / n7 };
  const uy = { x: (bl.x - tl.x) / n7, y: (bl.y - tl.y) / n7 };
  const corr = 1 - 3 / n7;
  const ex = tl.x + corr * (tr.x - tl.x + bl.x - tl.x);
  const ey = tl.y + corr * (tr.y - tl.y + bl.y - tl.y);
  const px = (x, y) => {
    const ix = Math.round(x), iy = Math.round(y);
    return ix >= 0 && iy >= 0 && ix < w && iy < h ? bits[iy * w + ix] : -1;
  };
  const score = (cx, cy) => {
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const want = Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1;
      const v = px(cx + dx * ux.x + dy * uy.x, cy + dx * ux.y + dy * uy.y);
      if (v === want) s++;
    }
    return s;
  };
  let best = { x: ex, y: ey, s: -1 };
  const R = Math.max(4, mod * 5), step = Math.max(1, mod / 3);
  for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) {
    const s = score(ex + dx, ey + dy) - (Math.hypot(dx, dy) / R) * 0.5;
    if (s > best.s) best = { x: ex + dx, y: ey + dy, s };
  }
  return best.s >= 20 ? best : null;
}

function tryDecode(bits, gray, w, h) {
  const finders = findFinders(bits, w, h);
  if (finders.length < 3) return null;
  for (const { tl, tr, bl } of pickTriples(finders)) {
    const mod = (tl.m + tr.m + bl.m) / 3;
    const est = (dist(tl, tr) + dist(tl, bl)) / 2 / mod + 7;
    const v0 = Math.round((est - 17) / 4);
    for (const version of [v0, v0 + 1, v0 - 1, v0 + 2, v0 - 2]) {
      if (version < 1 || version > 10) continue;
      const dim = 17 + 4 * version;
      const candidates = [];
      if (version >= 2) {
        const a = findAlignment(bits, w, h, tl, tr, bl, dim, mod);
        if (a) candidates.push([a, true]);
      }
      candidates.push([{ x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y }, false]);
      for (const [br, isAl] of candidates) {
        const get = sampleGrid(gray, w, h, tl, tr, bl, br, dim, isAl);
        const text = decodeMatrix(get, version);
        if (text) return text;
      }
    }
  }
  return null;
}

/**
 * Найти и расшифровать QR-код на изображении.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img — ImageData
 * @returns {string|null}
 */
export function decodeQR(img) {
  const { data, width: w, height: h } = img;
  const [raw, smooth] = toGray(data, w, h);
  return tryDecode(binarize(smooth, w, h), raw, w, h) ||
    tryDecode(binarize(smooth, w, h, true), raw.map((v) => 255 - v), w, h);
}
