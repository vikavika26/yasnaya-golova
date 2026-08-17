/** Отрисовка экранов. Чистые функции: данные на вход, разметка на выход. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pct = (v) => `${Math.round(v * 100)}%`;
const fix = (v, n = 2) => (v === null || v === undefined ? '—' : v.toFixed(n));

const VERDICT_LABEL = {
  confirmed: 'подтверждён',
  protective: 'скорее защищает',
  not_confirmed: 'не подтвердился',
  few_data: 'мало данных',
  no_data: 'нет данных',
};
const BELIEF_LABEL = {
  supported: 'данные согласны',
  not_supported: 'данные не согласны',
  needs_daily: 'нужны ежедневные отметки',
  not_measurable: 'нечем проверить',
};

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const humanDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${+d} ${RU_MONTHS[+m - 1]} ${y}`;
};

/* ─────────────────────────── Сегодня ─────────────────────────── */

export function renderToday({ today, risk, analysis, entry, weather }) {
  const prob = risk?.forecast?.find((f) => f.date === today)?.probability ?? analysis?.baseRate ?? null;
  const base = analysis?.baseRate ?? null;
  const relative = prob !== null && base ? prob / base : null;
  let mood = 'обычный день';
  if (relative !== null) {
    if (relative >= 1.4) mood = 'риск выше обычного';
    else if (relative <= 0.7) mood = 'риск ниже обычного';
  }
  const active = risk?.forecast?.find((f) => f.date === today)?.active || [];
  const trustworthy = risk?.backtest?.beatsBaseline;

  return `
  <section class="card hero">
    <div class="value">${prob === null ? '—' : pct(prob)}</div>
    <div class="label">вероятность боли сегодня · ${esc(mood)}</div>
    ${base !== null ? `<div class="sub muted small">обычный уровень для тебя — ${pct(base)} дней</div>` : ''}
    ${active.length ? `<div class="chips" style="justify-content:center">${
      active.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>` : ''}
    ${trustworthy === false ? `<div class="explain">Прогноз пока не точнее простого среднего — показываю его честно,
      как ориентир. Он станет полезным, когда наберётся больше ежедневных отметок.</div>` : ''}
  </section>

  ${weather ? `<section class="card">
    <h2>Погода сейчас</h2>
    <div class="kv">
      <div class="k">Давление</div><div>${fix(weather.p_mean, 0)} гПа${
        weather.p_delta !== null && weather.p_delta !== undefined
          ? ` (${weather.p_delta > 0 ? '+' : ''}${fix(weather.p_delta, 1)} за сутки)` : ''}</div>
      <div class="k">Температура</div><div>${fix(weather.t_mean, 1)} °C</div>
      <div class="k">Влажность</div><div>${fix(weather.rh_mean, 0)} %</div>
    </div>
  </section>` : ''}

  <section class="card">
    <h2>Отметить день</h2>
    <form id="entry-form">
      <div class="row" style="margin-bottom:14px">
        <div class="main"><div class="name">Болела голова?</div></div>
        <div class="chips" style="margin:0">
          <button type="button" class="chip ${entry?.headache === 1 ? 'on' : ''}" data-hb="1">Да</button>
          <button type="button" class="chip ${entry?.headache === 0 ? 'on' : ''}" data-hb="0">Нет</button>
        </div>
      </div>

      <div id="pain-block" ${entry?.headache === 1 ? '' : 'hidden'}>
        <label class="field">
          <span>Насколько сильно — <b id="int-val">${entry?.intensity ?? 4}</b> из 10</span>
          <input class="slider" type="range" min="1" max="10" step="1" id="intensity"
                 value="${entry?.intensity ?? 4}">
        </label>
        <label class="field">
          <span>Что приняла (можно оставить пустым)</span>
          <input type="text" id="med_text" placeholder="например, Цитрамон 2 таб"
                 value="${esc(entry?.med_text || '')}">
        </label>
        <div class="chips" style="margin-bottom:14px">
          ${['помогло', 'немного помогло', 'не помогло'].map((w) => `
            <button type="button" class="chip ${entry?.med_helped === w ? 'on' : ''}" data-helped="${w}">${w}</button>`).join('')}
        </div>
      </div>

      <div class="row" style="border:0;padding:0;margin-bottom:12px">
        <div class="main"><div class="name">Менструация</div></div>
        <div class="chips" style="margin:0">
          <button type="button" class="chip ${entry?.mens === 1 ? 'on' : ''}" data-mens="1">Да</button>
          <button type="button" class="chip ${entry?.mens === 0 ? 'on' : ''}" data-mens="0">Нет</button>
        </div>
      </div>

      <div class="name" style="margin-bottom:8px">Что было в этот день</div>
      <div class="chips" id="daily-chips" style="margin-top:0">
        ${[['sleepShort', 'мало спала'], ['stress', 'напряжённый день'],
           ['alcohol', 'алкоголь'], ['coffee', 'много кофе']].map(([k, label]) => `
          <button type="button" class="chip ${entry?.daily?.[k] ? 'on' : ''}" data-daily="${k}">${label}</button>`).join('')}
      </div>
      <div class="explain">Эти отметки нужны и в спокойные дни тоже — иначе стресс и недосып
        проверить нельзя: они будут «виноваты» просто потому, что их отмечают только когда болит.</div>

      <button type="submit" class="primary" style="margin-top:14px">Сохранить</button>
    </form>
  </section>`;
}

/* ─────────────────────────── Триггеры ─────────────────────────── */

export function renderTriggers(analysis) {
  if (!analysis) return `<div class="card">Пока нет данных. Загрузи дневник на вкладке «Дневник».</div>`;

  const beliefs = analysis.beliefs.filter((b) => b.namedTimes >= 2).slice(0, 8);
  const groups = new Map();
  analysis.factors.forEach((f) => {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  });
  const order = { confirmed: 0, protective: 1, not_confirmed: 2, few_data: 3, no_data: 4 };

  return `
  <section class="card">
    <h2>Во что верю против того, что в данных</h2>
    ${beliefs.length ? beliefs.map((b) => `
      <div class="row">
        <div class="main">
          <div class="name">${esc(b.label)} <span class="muted small">· названо ${b.namedTimes} раз</span></div>
          <div class="note">${esc(b.comment)}</div>
        </div>
        <span class="tag ${b.status}">${BELIEF_LABEL[b.status]}</span>
      </div>`).join('')
      : '<div class="muted small">Пока нечего сравнивать: в дневнике не отмечены предполагаемые причины.</div>'}
  </section>

  ${[...groups.entries()].map(([group, list]) => `
  <section class="card">
    <h2>${esc(group)}</h2>
    ${list.sort((a, b) => order[a.verdict] - order[b.verdict]).map((f) => `
      <div class="row">
        <div class="main">
          <div class="name">${esc(f.label)}</div>
          <div class="note">${f.rr
            ? `болит в ${pct(f.p1)} таких дней против ${pct(f.p0)} обычно · риск ×${fix(f.rr)} `
              + `<span class="muted">[${fix(f.lo)}; ${fix(f.hi)}]</span>`
            : ''}${f.reason ? `<br>${esc(f.reason)}` : ''}</div>
        </div>
        <span class="tag ${f.verdict}">${VERDICT_LABEL[f.verdict]}</span>
      </div>`).join('')}
  </section>`).join('')}

  ${renderLagChart(analysis.lagProfiles)}

  <section class="card">
    <h2>Как считалось</h2>
    <div class="explain">
      Дней с записями: ${analysis.knownDays}, из них с болью ${analysis.headacheDays}
      (${pct(analysis.baseRate)}). Проверено гипотез: ${analysis.testedHypotheses} — список
      составлен заранее, до подсчёта. К каждой применена поправка Беньямини — Хохберга:
      если проверять много вариантов, случайная «находка» появится почти наверняка.
      Выжившие гипотезы дополнительно проверены блочным бутстрапом, потому что дни идут
      подряд и зависят друг от друга: после дня с болью следующий день тоже рискованнее.
      Всё, что не прошло эти два фильтра, помечено как «не подтвердился» — а не выдаётся
      за триггер.
    </div>
  </section>`;
}

function renderLagChart(profiles) {
  if (!profiles) return '';
  const blocks = Object.values(profiles).filter((p) => p.points.some((pt) => pt.rr !== null));
  if (!blocks.length) return '';
  return `
  <section class="card">
    <h2>Через сколько срабатывает</h2>
    ${blocks.map((b) => `
      <h3>${esc(b.label)}</h3>
      <div class="bars" style="margin-bottom:14px">
        ${b.points.map((pt) => {
          const rr = pt.rr ?? 0;
          const width = Math.min(100, (rr / 2.5) * 100);
          return `<div class="bar-row">
            <div>${pt.lag === 0 ? 'в тот же день' : `за ${pt.lag} дн.`}</div>
            <div class="bar-track"><div class="bar-fill ${rr < 1.15 ? 'low' : ''}" style="width:${width}%"></div></div>
            <div class="bar-value">×${fix(rr)}</div>
          </div>`;
        }).join('')}
      </div>`).join('')}
    <div class="explain">Форма важнее отдельного числа. Фактор, который «срабатывает» только
      в сам день боли, скорее часть приступа, чем его причина: тяга к сладкому или зевота —
      это уже начало, а не провокатор.</div>
  </section>`;
}

/* ─────────────────────────── Дневник ─────────────────────────── */

export function renderDiary({ days, stats }) {
  const last = days.filter((d) => d.headache !== null).slice(-40).reverse();
  return `
  <section class="card">
    <h2>Что уже есть</h2>
    <div class="kv">
      <div class="k">Записей</div><div>${stats.entries}</div>
      <div class="k">Дней с болью</div><div>${stats.headacheDays}</div>
      <div class="k">Период</div><div>${stats.from ? `${humanDate(stats.from)} — ${humanDate(stats.to)}` : '—'}</div>
      <div class="k">Дней погоды</div><div>${stats.weatherDays}</div>
    </div>
    <label class="filebtn" style="margin-top:14px">
      <input type="file" id="file-migrebot" accept=".xlsx">
      <button type="button" class="primary" onclick="this.parentNode.querySelector('input').click()">
        Загрузить выгрузку Мигребота
      </button>
    </label>
    <div class="explain">В Мигреботе: «Скачать дневник» → выбери файл здесь. Импорт можно
      повторять: записи по одинаковым датам обновятся, дубликатов не будет.</div>
  </section>

  <section class="card">
    <h2>Последние дни</h2>
    ${last.length ? last.map((d) => `
      <div class="row">
        <div class="main">
          <div class="name">${humanDate(d.date)}${d.headache === 1
            ? ` · боль ${d.intensity ?? '?'}/10` : ' · спокойно'}</div>
          <div class="note">${[
            d.mens === 1 ? 'менструация' : null,
            d.medTaken ? 'принимала препарат' : null,
            d.p_mean !== null ? `${Math.round(d.p_mean)} гПа` : null,
            d.selfTriggers?.length ? d.selfTriggers.join(', ') : null,
          ].filter(Boolean).join(' · ')}</div>
        </div>
        <span class="tag ${d.headache === 1 ? 'not_supported' : 'confirmed'}">${d.headache === 1 ? 'болело' : 'ок'}</span>
      </div>`).join('') : '<div class="muted small">Записей пока нет.</div>'}
  </section>`;
}

/* ─────────────────────────── Врачу ─────────────────────────── */

export function renderDoctor({ analysis, risk }) {
  if (!analysis) return `<div class="card">Нет данных для сводки.</div>`;
  const m = analysis.meds;
  const months = m.months.slice(-12);
  const maxBar = Math.max(10, ...months.map((x) => Math.max(x.medDays, x.headacheDays)));
  const confirmed = analysis.factors.filter((f) => f.verdict === 'confirmed');

  return `
  <section class="card">
    <h2>Коротко</h2>
    <div class="kv">
      <div class="k">Период наблюдения</div><div>${analysis.knownDays} дней</div>
      <div class="k">Дней с болью</div><div>${analysis.headacheDays} (${pct(analysis.baseRate)})</div>
      <div class="k">В среднем в месяц</div><div>${(analysis.headacheDays / Math.max(1, m.months.length)).toFixed(1)} дней</div>
      <div class="k">Максимум дней с препаратом в месяц</div><div>${m.maxMedDays}</div>
      <div class="k">Месяцев с 10+ днями приёма</div><div>${m.riskyMonths}</div>
    </div>
    ${m.riskyMonths > 0
      ? `<div class="explain" style="color:var(--warn)">Есть месяцы, где обезболивающие принимались
         10 и более дней. Это тот порог, при котором обсуждают риск лекарственной головной боли —
         стоит показать врачу.</div>`
      : `<div class="explain">Порог настороженности по злоупотреблению обезболивающими
         (10 дней в месяц) не превышен ни в одном месяце.</div>`}
  </section>

  <section class="card">
    <h2>Дни с болью и с препаратами по месяцам</h2>
    <div class="bars">
      ${months.map((x) => `
        <div class="bar-row">
          <div>${x.month}</div>
          <div class="bar-track">
            <div class="bar-fill ${x.medDays >= m.threshold ? '' : 'low'}"
                 style="width:${(x.headacheDays / maxBar) * 100}%"></div>
          </div>
          <div class="bar-value">${x.headacheDays} / ${x.medDays}</div>
        </div>`).join('')}
    </div>
    <div class="explain">Слева месяц, справа «дней с болью / дней с приёмом препарата».</div>
  </section>

  <section class="card">
    <h2>Что подтвердилось на данных</h2>
    ${confirmed.length ? confirmed.map((f) => `
      <div class="row">
        <div class="main">
          <div class="name">${esc(f.label)}</div>
          <div class="note">риск ×${fix(f.rr)} [${fix(f.lo)}; ${fix(f.hi)}] · ${f.exposedHeadache} приступов
            из ${f.exposedDays} таких дней</div>
        </div>
        <span class="tag confirmed">подтверждён</span>
      </div>`).join('')
      : '<div class="muted small">Ни один фактор пока не прошёл проверку. Это тоже результат.</div>'}
    ${risk?.backtest ? `<div class="explain">Прогноз проверен на будущем: обучение на
      ${risk.backtest.trainDays} днях, проверка на ${risk.backtest.testDays} последующих
      (${humanDate(risk.backtest.testFrom)} — ${humanDate(risk.backtest.testTo)}).
      AUC ${fix(risk.backtest.auc, 3)}, выигрыш над простым средним
      ${risk.backtest.beatsBaseline ? 'есть' : 'пока отсутствует'}.</div>` : ''}
  </section>

  <section class="card">
    <h2>Отдать врачу или сохранить</h2>
    <button type="button" class="primary" id="btn-report">Сводка текстом</button>
    <button type="button" class="ghost" id="btn-export">Резервная копия (json)</button>
    <div class="explain">Приложение не ставит диагнозов и не назначает лечение. Это описание
      того, что видно в твоих записях, для разговора с врачом.</div>
  </section>`;
}

/* ─────────────────────────── Настройки ─────────────────────────── */

export function renderSettings(settings, stats) {
  return `
  <section class="card">
    <h2>Город для погоды</h2>
    <label class="field">
      <span>Найти город</span>
      <input type="text" id="city-input" value="${esc(settings.city)}" placeholder="Санкт-Петербург">
    </label>
    <div id="city-results"></div>
    <button type="button" class="ghost" id="btn-find-city">Найти</button>
    <button type="button" class="primary" id="btn-sync-weather" style="margin-top:8px">
      Обновить погоду за весь период
    </button>
    <div class="explain">Сейчас: ${esc(settings.city)} (${fix(+settings.lat, 3)}, ${fix(+settings.lon, 3)}).
      История давления, температуры, влажности и ветра тянется автоматически и хранится в телефоне.
      Загружено дней погоды: ${stats.weatherDays}.</div>
  </section>

  <section class="card">
    <h2>Данные</h2>
    <button type="button" class="ghost" id="btn-export2">Скачать резервную копию</button>
    <label class="filebtn">
      <input type="file" id="file-backup" accept=".json">
      <button type="button" class="ghost" onclick="this.parentNode.querySelector('input').click()">
        Восстановить из копии
      </button>
    </label>
    <button type="button" class="ghost" id="btn-wipe" style="color:var(--bad)">Удалить все данные</button>
    <div class="explain">Всё хранится только на этом устройстве: ни аккаунта, ни сервера, ни отправки
      куда-либо. Резервная копия создаётся вручную и остаётся у тебя.</div>
  </section>

  <section class="card">
    <h2>О приложении</h2>
    <div class="explain">«Ясная голова» — дневник головной боли, который сам ищет закономерности:
      подтягивает погоду по твоему городу, проверяет факторы со сдвигом на 1–2 суток, делает поправку
      на множественность проверок и честно говорит «не подтвердилось», когда данных не хватает.
      Не медицинское устройство: диагнозов не ставит и лечение не назначает.</div>
  </section>`;
}
