/**
 * Статистика без библиотек — чтобы внутри не было чёрного ящика.
 *
 * Здесь ровно те приёмы, из-за отсутствия которых обычные дневники головной боли
 * показывают выдуманные триггеры:
 *   riskRatio        — оценка с доверительным интервалом, а не «процент совпадений»;
 *   benjaminiHochberg — поправка на то, что гипотез много (иначе одна «значимая» найдётся всегда);
 *   blockBootstrap   — учёт того, что дни идут подряд и не независимы;
 *   logistic + backtest — прогноз проверяется на будущем, а не на тех же данных.
 */

/** Детерминированный генератор: один и тот же вход даёт один и тот же результат. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Функция ошибок (Abramowitz & Stegun 7.1.26), точности с запасом для p-value. */
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

export function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
export function twoSidedP(z) { return 2 * (1 - normalCdf(Math.abs(z))); }

/**
 * Отношение рисков: во сколько раз чаще болит в дни с фактором.
 * CI — логарифмическое приближение Katz, стандартное для таблиц 2×2.
 */
export function riskRatio(a1, n1, a0, n0) {
  if (!n1 || !n0) return null;
  const p1 = a1 / n1, p0 = a0 / n0;
  if (a1 === 0 || a0 === 0) {                     // без поправки логарифм не берётся
    a1 += 0.5; a0 += 0.5; n1 += 1; n0 += 1;
  }
  const rr = (a1 / n1) / (a0 / n0);
  const se = Math.sqrt(1 / a1 - 1 / n1 + 1 / a0 - 1 / n0);
  const z = Math.log(rr) / se;
  return {
    p1, p0, rr,
    lo: Math.exp(Math.log(rr) - 1.96 * se),
    hi: Math.exp(Math.log(rr) + 1.96 * se),
    p: twoSidedP(z),
    exposedDays: n1, exposedHeadache: a1,
  };
}

/**
 * Поправка Беньямини — Хохберга: контролирует долю ложных находок среди
 * объявленных значимыми. Мягче Бонферрони, поэтому реальные эффекты выживают.
 * Возвращает пороги и флаг survived для каждой исходной гипотезы.
 */
export function benjaminiHochberg(pvalues, alpha = 0.05) {
  const m = pvalues.length;
  const order = pvalues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  let maxK = -1;
  order.forEach((o, k) => { if (o.p <= ((k + 1) / m) * alpha) maxK = k; });
  const out = new Array(m).fill(null);
  order.forEach((o, k) => {
    out[o.i] = { survived: k <= maxK, threshold: ((k + 1) / m) * alpha, rank: k + 1 };
  });
  return out;
}

/**
 * Блочный бутстрап. Обычный бутстрап по дням завышает уверенность, потому что
 * приступ тянется несколько суток — дни зависимы. Пересобираем ряд блоками по
 * blockSize дней, сохраняя эту склейку.
 */
export function blockBootstrapRR(headache, mask, { blockSize = 14, iters = 600, seed = 42 } = {}) {
  const n = headache.length;
  if (n < blockSize * 3) return null;
  const rnd = mulberry32(seed);
  const nBlocks = Math.ceil(n / blockSize);
  const starts = [];
  for (let s = 0; s + blockSize <= n; s++) starts.push(s);
  if (!starts.length) return null;

  const rrs = [];
  for (let it = 0; it < iters; it++) {
    let a1 = 0, n1 = 0, a0 = 0, n0 = 0;
    for (let b = 0; b < nBlocks; b++) {
      const s = starts[Math.floor(rnd() * starts.length)];
      for (let k = 0; k < blockSize; k++) {
        const i = s + k;
        const h = headache[i];
        if (h === null || h === undefined) continue;
        if (mask[i]) { n1++; a1 += h; } else { n0++; a0 += h; }
      }
    }
    if (n1 < 5 || n0 < 5 || a0 === 0) continue;
    rrs.push((a1 / n1) / (a0 / n0));
  }
  if (rrs.length < iters * 0.5) return null;
  rrs.sort((x, y) => x - y);
  const q = (f) => rrs[Math.min(rrs.length - 1, Math.max(0, Math.floor(f * rrs.length)))];
  return { lo: q(0.025), hi: q(0.975), median: q(0.5), iters: rrs.length };
}

/** Логистическая регрессия методом IRLS с гребневой регуляризацией. */
export function logisticFit(X, y, { l2 = 1.0, iters = 40 } = {}) {
  const n = X.length, p = X[0].length;
  let beta = new Array(p).fill(0);
  for (let it = 0; it < iters; it++) {
    const eta = X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
    const mu = eta.map((e) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, e)))));
    const g = new Array(p).fill(0);
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const w = Math.max(1e-6, mu[i] * (1 - mu[i]));
      const r = y[i] - mu[i];
      for (let j = 0; j < p; j++) {
        g[j] += X[i][j] * r;
        for (let k = 0; k < p; k++) H[j][k] += w * X[i][j] * X[i][k];
      }
    }
    for (let j = 1; j < p; j++) { g[j] -= l2 * beta[j]; H[j][j] += l2; }  // свободный член не штрафуем
    const delta = solve(H, g);
    if (!delta) break;
    let maxStep = 0;
    for (let j = 0; j < p; j++) { beta[j] += delta[j]; maxStep = Math.max(maxStep, Math.abs(delta[j])); }
    if (maxStep < 1e-7) break;
  }
  return beta;
}

/** Решение системы методом Гаусса с выбором главного элемента. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  // после полного исключения матрица диагональная — решение читается напрямую
  return M.map((row, i) => row[n] / row[i]);
}

export function logisticPredict(beta, row) {
  const e = row.reduce((s, v, j) => s + v * beta[j], 0);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, e))));
}

/** AUC через нормированную статистику Манна — Уитни. */
export function auc(scores, labels) {
  const pairs = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0, nPos = 0, nNeg = 0, i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].s === pairs[i].s) j++;
    const avgRank = (i + j + 2) / 2;                       // ранги с 1, средние для связок
    for (let k = i; k <= j; k++) if (pairs[k].y === 1) rankSum += avgRank;
    i = j + 1;
  }
  labels.forEach((y) => (y === 1 ? nPos++ : nNeg++));
  if (!nPos || !nNeg) return null;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function brier(scores, labels) {
  return scores.reduce((s, v, i) => s + (v - labels[i]) ** 2, 0) / scores.length;
}

/** Насколько модель лучше «всегда предсказывать среднюю частоту». */
export function skillScore(scores, labels) {
  const base = labels.reduce((a, b) => a + b, 0) / labels.length;
  const bBase = labels.reduce((s, y) => s + (base - y) ** 2, 0) / labels.length;
  return bBase === 0 ? null : 1 - brier(scores, labels) / bBase;
}

/** Калибровка: сравнение обещанной вероятности с фактической частотой. */
export function calibration(scores, labels, bins = 5) {
  const out = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx = scores.map((s, i) => ({ s, i }))
      .filter((o) => o.s >= lo && (b === bins - 1 ? o.s <= hi : o.s < hi));
    if (!idx.length) { out.push({ lo, hi, n: 0 }); continue; }
    out.push({
      lo, hi, n: idx.length,
      predicted: idx.reduce((s, o) => s + o.s, 0) / idx.length,
      actual: idx.reduce((s, o) => s + labels[o.i], 0) / idx.length,
    });
  }
  return out;
}
