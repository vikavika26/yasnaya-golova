/**
 * Ядро: превращает дневник и погоду в честные выводы о триггерах.
 *
 * Чем отличается от обычного дневника головной боли:
 *  1. Список гипотез фиксируется заранее, до подсчёта. Иначе поправка на
 *     множественные сравнения бессмысленна: перебрав достаточно вариантов,
 *     «значимое» найдёшь всегда.
 *  2. Факторы проверяются со сдвигом на 1-2 суток, а не «в тот же день».
 *  3. Учитывается, что дни идут подряд и зависимы (блочный бутстрап).
 *  4. Признаки, которые человек отмечает только в дни боли, НЕ проверяются как
 *     причины: в дни без боли их просто не спрашивали, и любой такой признак
 *     автоматически окажется «виноват». Про них приложение говорит отдельно.
 *
 * Модуль чистый: никакого DOM и сети, поэтому его же тестами проверяем движок.
 */
import {
  riskRatio, benjaminiHochberg, blockBootstrapRR,
  logisticFit, logisticPredict, auc, skillScore, calibration,
} from './stats.js';

export const MIN_EXPOSED_HEADACHE = 8;   // меньше — считать нечего, так и скажем
export const ALPHA = 0.05;

/** Признаки, которые Мигребот собирает только в дни приступа. */
export const SELF_ONLY_LABELS = [
  'Стресс', 'Мало сна', 'Много сна', 'Физ. нагрузки', 'Умственные нагрузки',
  'Духота', 'Голод', 'Алкоголь', 'Кофе', 'Шоколад', 'Болезнь', 'Погода',
  'Менструация', 'Гормоны', 'Температура', 'Обезвоживание', 'Свет', 'Шум',
  'Отголоски вчерашней головной боли', 'Операция',
];

const dayMs = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Непрерывный ряд дней: дневник + погода + производные признаки.
 * Пропущенные дни дневника остаются с headache === null и в статистику не идут,
 * но нужны, чтобы сдвиги по времени считались правильно.
 */
export function buildDays(entries, weatherMap, { until = null } = {}) {
  if (!entries.length) return [];
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const start = new Date(entries[0].date + 'T00:00:00Z');
  const lastKnown = [entries[entries.length - 1].date, until,
    ...(weatherMap ? [...weatherMap.keys()].sort().slice(-1) : [])]
    .filter(Boolean).sort().slice(-1)[0];
  const end = new Date(lastKnown + 'T00:00:00Z');

  const days = [];
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    const date = iso(t);
    const e = byDate.get(date) || {};
    const w = weatherMap ? weatherMap.get(date) : null;
    days.push({
      date,
      weekday: new Date(t).getUTCDay(),           // 0 — воскресенье
      headache: e.headache === 1 ? 1 : e.headache === 0 ? 0 : null,
      intensity: e.intensity ?? null,
      mens: e.mens === 1 ? 1 : e.mens === 0 ? 0 : null,
      medTaken: e.med_taken === 1 ? 1 : 0,
      medHelped: e.med_helped ?? null,
      selfTriggers: parseTriggers(e.self_triggers),
      daily: e.daily || null,                     // ежедневные отметки нового формата
      p_mean: w?.p_mean ?? null, p_min: w?.p_min ?? null, p_max: w?.p_max ?? null,
      t_mean: w?.t_mean ?? null, rh_mean: w?.rh_mean ?? null,
      wind_max: w?.wind_max ?? null, precip: w?.precip ?? null,
      weatherKind: w?.kind ?? null,
    });
  }

  // производные признаки
  days.forEach((d, i) => {
    const prev = days[i - 1];
    d.p_delta = prev && d.p_mean !== null && prev.p_mean !== null ? d.p_mean - prev.p_mean : null;
    d.t_delta = prev && d.t_mean !== null && prev.t_mean !== null ? d.t_mean - prev.t_mean : null;
    d.p_swing = d.p_max !== null && d.p_min !== null ? d.p_max - d.p_min : null;
    d.prevHeadache = prev ? prev.headache : null;
  });

  // Цикл: день от начала менструации и перименструальное окно ±2 дня.
  // Началом считаем отмеченный день, перед которым 3 суток не было отметок.
  // Проверка именно по календарю: пропущенный день дневника не должен разрывать
  // менструацию на два «начала» и плодить лишние окна.
  const GAP = 3;
  const startsIdx = [];
  days.forEach((d, i) => {
    if (d.mens !== 1) return;
    let recent = false;
    for (let k = 1; k <= GAP; k++) if (days[i - k] && days[i - k].mens === 1) recent = true;
    if (!recent) startsIdx.push(i);
  });
  const startsSet = new Set(startsIdx);
  days.forEach((d) => { d.cycleDay = null; d.peri = false; });
  let last = null;
  days.forEach((d, i) => {
    if (startsSet.has(i)) last = i;
    if (last !== null) d.cycleDay = i - last;
  });
  startsIdx.forEach((i) => {
    for (let k = -2; k <= 2; k++) if (days[i + k]) days[i + k].peri = true;
  });
  return days;
}

function parseTriggers(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function quantile(values, q) {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 20) return null;
  return v[Math.floor(q * (v.length - 1))];
}

/** Заранее зафиксированный список гипотез. */
export function factorDefs(days) {
  const F = [];
  const at = (i, key, lag) => {
    const j = i - lag;
    return j >= 0 ? days[j][key] : null;
  };
  const add = (key, label, group, test, { lag = 0, hint = '', protectiveOk = false } = {}) => {
    const mask = days.map((d, i) => {
      const v = test(i);
      return v === null || v === undefined ? null : !!v;
    });
    F.push({ key, label, group, lag, hint, protectiveOk, mask });
  };

  add('peri', 'Перименструальное окно (±2 дня от начала)', 'Цикл',
    (i) => days[i].peri, { hint: 'Самая частая связь при мигрени у женщин: резкое падение эстрогена перед менструацией.' });
  add('mens_day', 'День менструации', 'Цикл', (i) => days[i].mens === 1);

  [0, 1, 2].forEach((lag) => {
    add(`p_drop_l${lag}`, `Падение давления ≥5 гПа за сутки${lag ? ` (за ${lag} дн. до)` : ''}`,
      'Погода', (i) => { const v = at(i, 'p_delta', lag); return v === null ? null : v <= -5; },
      { lag, hint: 'Проверяется перепад, а не абсолютное давление: реакция бывает на изменение, и с задержкой.' });
  });
  add('p_drop_strong', 'Резкое падение давления ≥10 гПа за сутки', 'Погода',
    (i) => { const v = days[i].p_delta; return v === null ? null : v <= -10; });
  add('p_rise', 'Рост давления ≥5 гПа за сутки', 'Погода',
    (i) => { const v = days[i].p_delta; return v === null ? null : v >= 5; });
  [0, 1].forEach((lag) => {
    add(`p_swing_l${lag}`, `Скачки давления внутри суток ≥10 гПа${lag ? ` (за ${lag} дн. до)` : ''}`,
      'Погода', (i) => { const v = at(i, 'p_swing', lag); return v === null ? null : v >= 10; }, { lag });
  });

  const pLow = quantile(days.map((d) => d.p_mean), 0.2);
  if (pLow !== null) {
    add('p_low', 'Низкое давление (пятая часть самых низких дней)', 'Погода',
      (i) => { const v = days[i].p_mean; return v === null ? null : v <= pLow; });
  }
  add('t_jump', 'Перепад температуры ≥5 °C за сутки', 'Погода',
    (i) => { const v = days[i].t_delta; return v === null ? null : Math.abs(v) >= 5; });
  const rhHigh = quantile(days.map((d) => d.rh_mean), 0.8);
  if (rhHigh !== null) {
    add('rh_high', 'Высокая влажность (пятая часть самых влажных дней)', 'Погода',
      (i) => { const v = days[i].rh_mean; return v === null ? null : v >= rhHigh; });
  }
  const windHigh = quantile(days.map((d) => d.wind_max), 0.8);
  if (windHigh !== null) {
    add('wind_high', 'Сильный ветер (пятая часть самых ветреных дней)', 'Погода',
      (i) => { const v = days[i].wind_max; return v === null ? null : v >= windHigh; });
  }
  add('precip', 'Осадки больше 1 мм', 'Погода',
    (i) => { const v = days[i].precip; return v === null ? null : v >= 1; });

  add('weekend', 'Выходной день', 'Режим', (i) => [0, 6].includes(days[i].weekday),
    { hint: 'Мигрень выходного дня: сдвиг режима сна и отмена привычного кофеина.' });
  add('monday', 'Понедельник', 'Режим', (i) => days[i].weekday === 1);

  // ежедневные отметки, если человек начал их вести
  const dailyKeys = new Map([
    ['sleepShort', 'Спала меньше обычного'],
    ['stress', 'Напряжённый день'],
    ['alcohol', 'Алкоголь'],
    ['coffee', 'Кофе больше обычного'],
  ]);
  for (const [key, label] of dailyKeys) {
    const marked = days.filter((d) => d.daily && d.daily[key] !== undefined).length;
    if (marked < 30) continue;                    // ещё рано, отметок мало
    [0, 1].forEach((lag) => {
      add(`daily_${key}_l${lag}`, `${label}${lag ? ` (за ${lag} дн. до)` : ''}`, 'Мои отметки',
        (i) => { const d = days[i - lag]; return d && d.daily ? !!d.daily[key] : null; }, { lag });
    });
  }

  add('prev_day', 'Боль была вчера', 'Инерция',
    (i) => (days[i].prevHeadache === null ? null : days[i].prevHeadache === 1),
    { hint: 'Это не причина, а продолжение приступа. Учитывается, чтобы не завышать значимость остального.' });
  return F;
}

/** Оценка одного фактора: сколько дней, как часто болело, отношение рисков. */
function evaluate(days, mask) {
  let a1 = 0, n1 = 0, a0 = 0, n0 = 0;
  days.forEach((d, i) => {
    if (d.headache === null || mask[i] === null) return;
    if (mask[i]) { n1++; a1 += d.headache; } else { n0++; a0 += d.headache; }
  });
  if (!n1 || !n0) return null;
  const rr = riskRatio(a1, n1, a0, n0);
  return rr ? { ...rr, exposedDays: n1, exposedHeadache: a1, controlDays: n0, controlHeadache: a0 } : null;
}

/**
 * Главный анализ. Возвращает вердикт по каждой гипотезе — включая честное
 * «не подтвердилось» и «данных пока мало», без которых приложение врало бы.
 */
export function analyze(days, { alpha = ALPHA, bootstrapIters = 600 } = {}) {
  const known = days.filter((d) => d.headache !== null);
  const baseRate = known.length ? known.reduce((s, d) => s + d.headache, 0) / known.length : 0;
  const defs = factorDefs(days);

  const raw = defs.map((f) => ({ def: f, res: evaluate(days, f.mask) }));
  const testable = raw.filter((r) => r.res && r.res.exposedHeadache >= MIN_EXPOSED_HEADACHE);
  const bh = benjaminiHochberg(testable.map((r) => r.res.p), alpha);

  const headacheArr = days.map((d) => d.headache);
  const factors = raw.map((r) => {
    const base = {
      key: r.def.key, label: r.def.label, group: r.def.group, lag: r.def.lag, hint: r.def.hint,
    };
    if (!r.res) return { ...base, verdict: 'no_data', reason: 'нет данных по этому фактору' };
    const idx = testable.indexOf(r);
    if (idx === -1) {
      return {
        ...base, ...r.res, verdict: 'few_data',
        reason: `дней с этим фактором и болью всего ${r.res.exposedHeadache}, нужно минимум ${MIN_EXPOSED_HEADACHE}`,
      };
    }
    const corr = bh[idx];
    let boot = null;
    if (corr.survived) {
      boot = blockBootstrapRR(headacheArr, r.def.mask.map((v) => v === true), { iters: bootstrapIters });
    }
    const bootOk = !boot || boot.lo > 1 || boot.hi < 1;
    const confirmed = corr.survived && bootOk;
    return {
      ...base, ...r.res,
      bh: corr, bootstrap: boot,
      verdict: confirmed ? (r.res.rr >= 1 ? 'confirmed' : 'protective') : 'not_confirmed',
      reason: confirmed
        ? null
        : corr.survived
          ? 'после учёта того, что дни зависимы, связь перестала быть надёжной'
          : 'связь слабее, чем ожидаемая случайная находка при таком числе проверок',
    };
  });

  return {
    baseRate,
    knownDays: known.length,
    headacheDays: known.reduce((s, d) => s + d.headache, 0),
    testedHypotheses: testable.length,
    factors,
    beliefs: checkBeliefs(days, factors),
    lagProfiles: lagProfiles(days),
    meds: medStats(days),
  };
}

/**
 * Сверка убеждений с данными — то, чего нет ни в одном дневнике.
 * Слева: сколько раз человек сам назвал причину. Справа: что говорят данные.
 */
export function checkBeliefs(days, factors) {
  const named = new Map();
  days.forEach((d) => {
    if (d.headache !== 1) return;
    d.selfTriggers.forEach((t) => named.set(t, (named.get(t) || 0) + 1));
  });

  // с чем сопоставляется каждое убеждение
  const MAP = {
    'Погода': ['p_drop_l0', 'p_drop_l1', 'p_drop_l2', 'p_drop_strong', 'p_rise',
      'p_swing_l0', 'p_swing_l1', 'p_low', 't_jump', 'rh_high', 'wind_high', 'precip'],
    'Температура': ['t_jump'],
    'Менструация': ['peri', 'mens_day'],
    'Гормоны': ['peri'],
    'Отголоски вчерашней головной боли': ['prev_day'],
    'Мало сна': ['daily_sleepShort_l0', 'daily_sleepShort_l1'],
    'Стресс': ['daily_stress_l0', 'daily_stress_l1'],
    'Алкоголь': ['daily_alcohol_l0', 'daily_alcohol_l1'],
    'Кофе': ['daily_coffee_l0', 'daily_coffee_l1'],
  };
  const byKey = new Map(factors.map((f) => [f.key, f]));

  const out = [];
  for (const [label, count] of [...named.entries()].sort((a, b) => b[1] - a[1])) {
    const keys = MAP[label] || [];
    const linked = keys.map((k) => byKey.get(k)).filter(Boolean);
    const confirmed = linked.filter((f) => f.verdict === 'confirmed');
    const testable = linked.filter((f) => ['confirmed', 'not_confirmed', 'protective'].includes(f.verdict));

    let status, comment;
    if (!keys.length) {
      status = 'not_measurable';
      comment = 'нечем проверить: этого нет ни в погоде, ни в цикле. Начни отмечать каждый день — проверю.';
    } else if (!testable.length) {
      status = 'needs_daily';
      comment = 'проверить пока нельзя: отметки есть только в дни боли, а нужны и в спокойные дни тоже.';
    } else if (confirmed.length) {
      status = 'supported';
      const best = confirmed.sort((a, b) => b.rr - a.rr)[0];
      comment = `подтверждается: ${best.label.toLowerCase()} повышает риск в ${best.rr.toFixed(2)} раза.`;
    } else {
      status = 'not_supported';
      comment = `проверила ${testable.length} способами — связи не нашла. Скорее совпадение, чем причина.`;
    }
    out.push({ label, namedTimes: count, status, comment, linked: linked.map((f) => f.key) });
  }
  return out;
}

/**
 * Профиль лага: как меняется риск в зависимости от сдвига.
 * Форма кривой отличает провокатора от предвестника: то, что «срабатывает»
 * только в сам день боли, скорее часть приступа, а не его причина.
 */
export function lagProfiles(days, keys = ['p_drop', 'p_swing']) {
  const out = {};
  const profile = (make) => [0, 1, 2, 3].map((lag) => {
    const mask = days.map((d, i) => {
      const j = i - lag;
      return j >= 0 ? make(days[j]) : null;
    });
    const res = evaluate(days, mask);
    return { lag, rr: res ? res.rr : null, lo: res?.lo ?? null, hi: res?.hi ?? null, n: res?.exposedDays ?? 0 };
  });
  if (keys.includes('p_drop')) {
    out.p_drop = { label: 'Падение давления ≥5 гПа', points: profile((d) => (d.p_delta === null ? null : d.p_delta <= -5)) };
  }
  if (keys.includes('p_swing')) {
    out.p_swing = { label: 'Скачки давления внутри суток ≥10 гПа', points: profile((d) => (d.p_swing === null ? null : d.p_swing >= 10)) };
  }
  return out;
}

/** Приём обезболивающих по месяцам: первое, что спросит врач. */
export function medStats(days) {
  const byMonth = new Map();
  days.forEach((d) => {
    if (d.headache === null) return;
    const m = d.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, { month: m, medDays: 0, headacheDays: 0 });
    const b = byMonth.get(m);
    b.headacheDays += d.headache;
    b.medDays += d.medTaken ? 1 : 0;
  });
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const risky = months.filter((m) => m.medDays >= 10);
  const helped = days.filter((d) => d.medHelped);
  const effect = {};
  helped.forEach((d) => { effect[d.medHelped] = (effect[d.medHelped] || 0) + 1; });
  return {
    months,
    riskyMonths: risky.length,
    maxMedDays: months.length ? Math.max(...months.map((m) => m.medDays)) : 0,
    effect,
    // порог настороженности по абузусной головной боли — 10 дней в месяц
    // для комбинированных препаратов и 15 для простых анальгетиков
    threshold: 10,
  };
}

/**
 * Прогноз риска на день. Обучается на прошлом, проверяется на будущем —
 * разбиение по времени, а не случайное, иначе модель подглядывает вперёд.
 */
export function riskModel(days, analysis, { trainShare = 0.7 } = {}) {
  const useKeys = analysis.factors
    .filter((f) => ['confirmed', 'protective'].includes(f.verdict) && f.key !== 'prev_day')
    .map((f) => f.key);
  const keys = [...new Set([...useKeys, 'peri', 'prev_day', 'p_drop_l1', 'p_swing_l0'])];
  const defs = factorDefs(days).filter((f) => keys.includes(f.key));
  if (!defs.length) return null;

  const rows = [];
  days.forEach((d, i) => {
    if (d.headache === null) return;
    const feats = defs.map((f) => (f.mask[i] === true ? 1 : 0));
    if (defs.some((f) => f.mask[i] === null)) return;      // неполный день пропускаем
    rows.push({ i, date: d.date, x: [1, ...feats], y: d.headache });
  });
  if (rows.length < 120) return { insufficient: true, rows: rows.length };

  const cut = Math.floor(rows.length * trainShare);
  const train = rows.slice(0, cut), test = rows.slice(cut);
  const beta = logisticFit(train.map((r) => r.x), train.map((r) => r.y), { l2: 1.0 });
  const scores = test.map((r) => logisticPredict(beta, r.x));
  const labels = test.map((r) => r.y);
  const skill = skillScore(scores, labels);
  const areaUnder = auc(scores, labels);

  // прогноз на сегодня и завтра — по последним дням, где погода уже известна
  const forecast = [];
  for (let i = days.length - 1; i >= 0 && forecast.length < 3; i--) {
    const feats = defs.map((f) => (f.mask[i] === true ? 1 : 0));
    if (defs.some((f) => f.mask[i] === null)) continue;
    forecast.unshift({
      date: days[i].date,
      probability: logisticPredict(beta, [1, ...feats]),
      active: defs.filter((f) => f.mask[i] === true).map((f) => f.label),
    });
  }

  return {
    features: defs.map((f) => f.label),
    weights: defs.map((f, j) => ({ label: f.label, beta: beta[j + 1] })),
    backtest: {
      trainDays: train.length, testDays: test.length,
      testFrom: test[0]?.date, testTo: test[test.length - 1]?.date,
      baseRate: labels.reduce((s, v) => s + v, 0) / labels.length,
      auc: areaUnder, skill,
      calibration: calibration(scores, labels, 4),
      beatsBaseline: skill !== null && skill > 0,
    },
    forecast,
  };
}
