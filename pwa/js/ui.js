/**
 * Отрисовка экранов. Чистые функции: данные на вход, разметка на выход.
 *
 * Два правила текста, которым подчинён весь файл:
 *  1. Никакого статистического жаргона. Человеку нужно понимать, почему приложение
 *     говорит «влияет» или «просто совпадение», а не читать про бутстрап.
 *  2. На экране — минимум слов. Подробности спрятаны в «Подробнее»: кому надо,
 *     развернёт. Раньше пояснений было столько, что они мешали читать данные.
 */
import { catCalm, catAchy, catCurious, catUnsure, catSleepy, catForRisk, catForVerdict } from './cats.js';
import { DAILY_FACTORS, unmeasurableBeliefs } from './engine.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pct = (v) => `${Math.round(v * 100)}%`;
const fix = (v, n = 2) => (v === null || v === undefined ? '—' : v.toFixed(n));
const mm = (v) => (v === null || v === undefined ? '—' : Math.round(v));

const VERDICT_LABEL = {
  confirmed: 'похоже, влияет',
  protective: 'наоборот, легче',
  not_confirmed: 'просто совпадение',
  few_data: 'ещё мало случаев',
  no_data: 'нечего считать',
};

const BELIEF_LABEL = {
  supported: 'и правда влияет',
  not_supported: 'кажется, напрасно винила',
};

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const humanDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${+d} ${RU_MONTHS[+m - 1]} ${y}`;
};
const shortDate = (iso) => {
  const [, m, d] = iso.split('-');
  return `${+d} ${RU_MONTHS[+m - 1]}`;
};

const plural = (n, one, few, many) => {
  const m10 = Math.round(n) % 10, m100 = Math.round(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

/** Раскрывающийся блок — так подробности не мешают тем, кому они не нужны. */
const details = (title, body) => `
  <details class="more"><summary>${esc(title)}</summary><div class="more-body">${body}</div></details>`;

function shortReason(f, tested) {
  switch (f.verdict) {
    case 'confirmed': return 'Болит заметно чаще, и связь не рассыпается при перепроверке.';
    case 'protective': return 'В такие дни болит реже обычного.';
    case 'not_confirmed':
      return f.bh?.survived
        ? 'Разница держалась на пары затяжных приступов — без них исчезает.'
        : `Разница маленькая, такая выходит и случайно: я перебрала ${tested} версий.`;
    case 'few_data':
      return `Совпало с болью всего ${f.exposedHeadache} ${plural(f.exposedHeadache, 'раз', 'раза', 'раз')} — мало, чтобы судить.`;
    default: return 'Данных для расчёта нет.';
  }
}

function humanNumbers(f) {
  if (!f.rr) return '';
  const times = f.rr >= 1 ? f.rr : 1 / f.rr;
  return `${pct(f.p1)} таких дней против ${pct(f.p0)} обычных · в ${fix(times, 1)} раза`
    + ` ${f.rr >= 1 ? 'чаще' : 'реже'}`;
}

/* ─────────────────────────── Сегодня ─────────────────────────── */

export function renderToday({ today, risk, analysis, entry, weather, savedAt }) {
  const prob = risk?.forecast?.find((f) => f.date === today)?.probability ?? analysis?.baseRate ?? null;
  const base = analysis?.baseRate ?? null;
  const rel = prob !== null && base ? prob / base : null;

  let mood = 'как обычно';
  if (rel !== null) {
    if (rel >= 1.4) mood = 'выше обычного';
    else if (rel <= 0.75) mood = 'ниже обычного';
  }
  const active = risk?.forecast?.find((f) => f.date === today)?.active || [];
  const rough = risk?.backtest?.beatsBaseline === false;
  const marked = entry && entry.headache !== null && entry.headache !== undefined;

  return `
  <section class="card hero">
    ${catForRisk(prob, base, 100)}
    <div class="value">${prob === null ? '—' : pct(prob)}</div>
    <div class="label">вероятность, что сегодня заболит голова</div>
    <div class="sub">${esc(mood)}${base !== null
      ? ` · обычно у тебя болит ${pct(base)} дней` : ''}</div>
    ${active.length ? `<div class="chips center">${
      active.map((a) => `<span class="chip flat">${esc(a)}</span>`).join('')}</div>` : ''}
    ${rough ? `<div class="note center">Пока это грубая оценка, не предсказание.</div>` : ''}
  </section>

  ${weather ? `<section class="card">
    <h2>${catCurious(24)} Погода сейчас</h2>
    <div class="kv">
      <div class="k">Давление</div><div>${mm(weather.p_mean)} мм рт. ст.${
        weather.p_delta !== null && weather.p_delta !== undefined
          ? ` <span class="muted">(${weather.p_delta > 0 ? '+' : '−'}${fix(Math.abs(weather.p_delta), 1)} за сутки)</span>`
          : ''}</div>
      <div class="k">Температура</div><div>${fix(weather.t_mean, 1)} °C</div>
      <div class="k">Влажность</div><div>${mm(weather.rh_mean)} %</div>
    </div>
    <div class="source">Open-Meteo, архив ERA5 · тянется сама</div>
  </section>` : ''}

  <section class="card ${marked ? 'done' : ''}">
    <h2>${marked ? catCalm(24) : catAchy(24)} ${marked ? 'День записан' : 'Как прошёл день'}</h2>
    ${marked ? `<div class="saved-line">${entry.headache === 1
      ? `отмечено: болела на ${entry.intensity ?? '?'} из 10`
      : 'отмечено: голова не болела'}${savedAt ? ` · сохранено в ${savedAt}` : ''}</div>` : ''}
    <form id="entry-form">
      <div class="q">
        <div class="q-name">Болела голова?</div>
        <div class="chips">
          <button type="button" class="chip ${entry?.headache === 1 ? 'on' : ''}" data-hb="1">да</button>
          <button type="button" class="chip ${entry?.headache === 0 ? 'on' : ''}" data-hb="0">нет</button>
        </div>
      </div>

      <div id="pain-block" ${entry?.headache === 1 ? '' : 'hidden'}>
        <label class="field">
          <span>Насколько сильно — <b id="int-val">${entry?.intensity ?? 4}</b> из 10</span>
          <input type="range" min="1" max="10" step="1" id="intensity" value="${entry?.intensity ?? 4}">
        </label>
        <label class="field">
          <span>Что приняла</span>
          <input type="text" id="med_text" placeholder="цитрамон 2 таблетки"
                 value="${esc(entry?.med_text || '')}">
        </label>
        <div class="chips">
          ${['помогло', 'немного помогло', 'не помогло'].map((w) => `
            <button type="button" class="chip ${entry?.med_helped === w ? 'on' : ''}"
                    data-helped="${w}">${w}</button>`).join('')}
        </div>
      </div>

      <div class="q">
        <div class="q-name">Менструация</div>
        <div class="chips">
          <button type="button" class="chip ${entry?.mens === 1 ? 'on' : ''}" data-mens="1">да</button>
          <button type="button" class="chip ${entry?.mens === 0 ? 'on' : ''}" data-mens="0">нет</button>
        </div>
      </div>

      <div class="q-name">Что ещё было</div>
      <div class="chips" id="daily-chips">
        ${DAILY_FACTORS.map(({ key, label }) => `
          <button type="button" class="chip ${entry?.daily?.[key] ? 'on' : ''}"
                  data-daily="${key}">${label}</button>`).join('')}
      </div>
      <label class="field" style="margin-top:12px">
        <span>Своё</span>
        <input type="text" id="note" placeholder="например, перелёт или запах духов"
               value="${esc(entry?.note || '')}">
      </label>
      <div class="note">Отмечай и в дни без боли — иначе сравнивать не с чем.</div>

      <button type="submit" class="primary">${marked ? 'Обновить запись' : 'Сохранить день'}</button>
    </form>
  </section>`;
}

/* ─────────────────────────── Триггеры ─────────────────────────── */

export function renderTriggers(analysis) {
  if (!analysis) {
    return `<section class="card"><div class="empty">${catSleepy(88)}
      <div class="t">Пока нечего показать</div>
      <div class="s">Перенеси дневник на вкладке «Дневник».</div></div></section>`;
  }

  // в основной список идут только проверяемые убеждения — остальные одной строкой
  const beliefs = analysis.beliefs
    .filter((b) => b.namedTimes >= 2 && (b.status === 'supported' || b.status === 'not_supported'))
    .slice(0, 6);
  const pending = unmeasurableBeliefs(analysis.beliefs).slice(0, 6).map((b) => b.label.toLowerCase());

  const groups = new Map();
  analysis.factors.forEach((f) => {
    if (f.verdict === 'no_data') return;             // пустые строки никому не нужны
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  });
  const order = { confirmed: 0, protective: 1, not_confirmed: 2, few_data: 3 };

  return `
  <section class="card">
    <h2>${catCurious(24)} Во что верю и что на самом деле</h2>
    ${beliefs.length ? beliefs.map((b) => `
      <div class="row">
        <div class="main">
          <div class="name">${esc(b.label)}
            <span class="muted small">· винила ${b.namedTimes} ${plural(b.namedTimes, 'раз', 'раза', 'раз')}</span></div>
          <div class="note">${b.status === 'supported'
            ? 'Данные согласны.'
            : 'Проверила со всех сторон — связи нет.'}</div>
        </div>
        <span class="tag ${b.status}">${BELIEF_LABEL[b.status]}</span>
      </div>`).join('')
      : `<div class="note">Пока не с чем сравнивать: в дневнике не отмечено, что ты считала причиной.</div>`}
    ${pending.length ? `<div class="hintline">${catUnsure(30)}
      <div>Чтобы проверить <b>${esc(pending.join(', '))}</b>, отмечай это каждый день на первой
      вкладке — включая дни без боли. Наберётся 30 отметок, и посчитаю.</div></div>` : ''}
  </section>

  ${[...groups.entries()].map(([group, list]) => `
  <section class="card">
    <h2>${esc(group)}</h2>
    ${list.sort((a, b) => order[a.verdict] - order[b.verdict]).map((f) => `
      <div class="row">
        <div class="stack">${catForVerdict(f.verdict, 34)}</div>
        <div class="main">
          <div class="name">${esc(f.label)}</div>
          ${f.rr ? `<div class="nums">${humanNumbers(f)}</div>` : ''}
          <div class="note">${esc(shortReason(f, analysis.testedHypotheses))}</div>
        </div>
        <span class="tag ${f.verdict}">${VERDICT_LABEL[f.verdict]}</span>
      </div>`).join('')}
  </section>`).join('')}

  ${renderLagChart(analysis.lagProfiles)}

  <section class="card">
    <h2>${catCalm(24)} Как я это проверяю</h2>
    <div class="note">Коротко: сравниваю дни с болью и без, ищу разницу больше случайной
      и перепроверяю на прочность. Из ${analysis.testedHypotheses} версий прошло
      ${analysis.factors.filter((f) => f.verdict === 'confirmed').length}.</div>
    ${details('Подробнее, по шагам', `
      <div class="steps">
        <div class="step"><div class="num"></div><div class="txt">Список подозреваемых
          составляю заранее — чтобы не подгонять вывод под то, во что уже веришь.</div></div>
        <div class="step"><div class="num"></div><div class="txt">Считаю по всем дням.
          Спокойные дни нужны: без них не видно, чем отличались дни с болью.</div></div>
        <div class="step"><div class="num"></div><div class="txt">Смотрю со сдвигом на день
          и два: погода могла испортиться вчера, а голова заболеть сегодня.</div></div>
        <div class="step"><div class="num"></div><div class="txt">Делаю скидку на число
          попыток: перебрав ${analysis.testedHypotheses} версий, одну найдёшь «виновной»
          случайно.</div></div>
        <div class="step"><div class="num"></div><div class="txt">Выкидываю случайные куски
          дневника и смотрю, держится ли связь. Рассыпалась — значит, показалось.</div></div>
      </div>
      <div class="note">Не врач и не ставлю диагнозов: показываю только то, что видно
        в твоих записях.</div>`)}
  </section>`;
}

function renderLagChart(profiles) {
  if (!profiles) return '';
  const blocks = Object.values(profiles).filter((p) => p.points.some((pt) => pt.rr !== null));
  if (!blocks.length) return '';
  return `
  <section class="card">
    <h2>${catUnsure(24)} Причина или начало приступа</h2>
    ${blocks.map((b) => `
      <h3>${esc(b.label)}</h3>
      <div class="bars">
        ${b.points.map((pt) => {
          const rr = pt.rr ?? 0;
          return `<div class="bar-row">
            <div>${pt.lag === 0 ? 'в тот день' : `${pt.lag} ${plural(pt.lag, 'день', 'дня', 'дней')} назад`}</div>
            <div class="bar-track"><div class="bar-fill ${rr < 1.15 ? 'low' : ''}"
                 style="width:${Math.min(100, (rr / 2.5) * 100)}%"></div></div>
            <div class="bar-value">×${fix(rr, 1)}</div>
          </div>`;
        }).join('')}
      </div>`).join('')}
    <div class="note">Настоящая причина срабатывает заранее. То, что совпадает только
      в день боли, — чаще всего уже её начало.</div>
  </section>`;
}

/* ─────────────────────────── Дневник ─────────────────────────── */

export function renderDiary({ days, stats }) {
  const last = days.filter((d) => d.headache !== null).slice(-45).reverse();
  return `
  <section class="card">
    <h2>${catCalm(24)} Что уже накопилось</h2>
    <div class="kv">
      <div class="k">Дней записано</div><div>${stats.entries}</div>
      <div class="k">Из них с болью</div><div>${stats.headacheDays}</div>
      <div class="k">Период</div><div>${stats.from
        ? `${shortDate(stats.from)} ${stats.from.slice(0, 4)} — ${shortDate(stats.to)} ${stats.to.slice(0, 4)}`
        : '—'}</div>
      <div class="k">Дней с погодой</div><div>${stats.weatherDays}</div>
    </div>
    <label class="filebtn">
      <input type="file" id="file-migrebot" accept=".xlsx">
      <button type="button" class="primary"
              onclick="this.parentNode.querySelector('input').click()">
        Перенести из Мигребота
      </button>
    </label>
    <div class="note">Нажми в боте «Скачать дневник» и выбери файл. Повторный перенос
      просто обновит те же дни.</div>
  </section>

  <section class="card">
    <h2>Последние дни</h2>
    ${last.length ? `<div class="daylist">${last.map((d) => `
      <div class="day ${d.headache === 1 ? 'pain' : 'calm'}">
        <div class="day-mark">${d.headache === 1
          ? `<span class="score">${d.intensity ?? '·'}</span>`
          : catCalm(28)}</div>
        <div class="main">
          <div class="name">${shortDate(d.date)}${d.headache === 1
            ? ` · болело` : ` · спокойно`}</div>
          <div class="note">${[
            d.mens === 1 ? 'менструация' : null,
            d.medTaken ? 'таблетка' : null,
            d.p_mean !== null ? `${mm(d.p_mean)} мм` : null,
            d.selfTriggers?.length ? d.selfTriggers.join(', ').toLowerCase() : null,
            d.note || null,
          ].filter(Boolean).join(' · ') || '—'}</div>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty">${catSleepy(80)}<div class="t">Записей пока нет</div>
         <div class="s">Отметь сегодняшний день на первой вкладке.</div></div>`}
  </section>`;
}

/* ─────────────────────────── Врачу ─────────────────────────── */

export function renderDoctor({ analysis, risk }) {
  if (!analysis) {
    return `<section class="card"><div class="empty">${catSleepy(88)}
      <div class="t">Сводку собрать не из чего</div>
      <div class="s">Сначала перенеси дневник.</div></div></section>`;
  }
  const m = analysis.meds;
  const months = m.months.slice(-12);
  const maxBar = Math.max(10, ...months.map((x) => Math.max(x.medDays, x.headacheDays)));
  const confirmed = analysis.factors.filter((f) => f.verdict === 'confirmed');
  const perMonth = (analysis.headacheDays / Math.max(1, m.months.length)).toFixed(1);

  return `
  <section class="card">
    <h2>${catCurious(24)} Коротко для приёма</h2>
    <div class="kv">
      <div class="k">Наблюдение</div><div>${analysis.knownDays} дней</div>
      <div class="k">Дней с болью</div><div>${analysis.headacheDays} (${pct(analysis.baseRate)})</div>
      <div class="k">В среднем за месяц</div><div>${perMonth}</div>
      <div class="k">Максимум дней с таблеткой в месяц</div><div>${m.maxMedDays}</div>
    </div>
    ${m.riskyMonths > 0
      ? `<div class="note warn">В ${m.riskyMonths} ${plural(m.riskyMonths, 'месяце', 'месяцах', 'месяцах')}
         таблетки принимались 10 дней и чаще — с этого порога врачи проверяют, не поддерживают
         ли они боль сами. Стоит показать.</div>`
      : `<div class="note">Порог 10 дней приёма в месяц не превышен ни разу (максимум ${m.maxMedDays}).</div>`}
  </section>

  <section class="card">
    <h2>Как шли месяцы</h2>
    <div class="legend">
      <span><i class="sw rose"></i>дней с болью</span>
      <span><i class="sw lav"></i>из них с таблеткой</span>
    </div>
    <div class="bars">
      ${months.map((x) => `
        <div class="bar-row">
          <div>${x.month.slice(5)}.${x.month.slice(2, 4)}</div>
          <div class="bar-track pair">
            <div class="bar-fill" style="width:${(x.headacheDays / maxBar) * 100}%"></div>
            <div class="bar-fill lav" style="width:${(x.medDays / maxBar) * 100}%"></div>
          </div>
          <div class="bar-value">${x.headacheDays}<span class="muted">/${x.medDays}</span></div>
        </div>`).join('')}
    </div>
  </section>

  <section class="card">
    <h2>${catAchy(24)} Что подтвердилось</h2>
    ${confirmed.length ? confirmed.map((f) => `
      <div class="row">
        <div class="stack">${catAchy(32)}</div>
        <div class="main">
          <div class="name">${esc(f.label)}</div>
          <div class="nums">${humanNumbers(f)} · ${f.exposedHeadache} из ${f.exposedDays} дней</div>
        </div>
        <span class="tag confirmed">${VERDICT_LABEL.confirmed}</span>
      </div>`).join('')
      : `<div class="empty">${catUnsure(72)}<div class="t">Пока ничего</div>
         <div class="s">Простых объяснений в этих данных нет — это тоже результат.</div></div>`}
    ${risk?.backtest ? `<div class="note">Прогноз проверен на ${risk.backtest.testDays} днях,
      которых модель не видела: получается ${risk.backtest.beatsBaseline
        ? 'немного лучше' : 'пока не лучше'} простого среднего.</div>` : ''}
  </section>

  <section class="card">
    <button type="button" class="primary" id="btn-report">Сводка текстом для врача</button>
    <button type="button" class="ghost" id="btn-export">Сохранить копию данных</button>
  </section>`;
}

/* ─────────────────────────── Настройки ─────────────────────────── */

export function renderSettings(settings, stats) {
  return `
  <section class="card">
    <h2>${catCurious(24)} Город для погоды</h2>
    <label class="field">
      <span>Город</span>
      <input type="text" id="city-input" value="${esc(settings.city)}" placeholder="Санкт-Петербург">
    </label>
    <div id="city-results"></div>
    <button type="button" class="ghost" id="btn-find-city">Найти</button>
    <button type="button" class="primary" id="btn-sync-weather">Обновить погоду</button>
    <div class="note">Скачано дней: ${stats.weatherDays}. Давление показываю в мм рт. ст.</div>
    ${details('Откуда берётся погода', `<div class="note">Сервис Open-Meteo: история из архива
      ERA5, свежие дни и прогноз — из их прогноза. Данные открытые, аккаунт не нужен.
      Всё скачанное хранится в телефоне, поэтому работает и без интернета.</div>`)}
  </section>

  <section class="card">
    <h2>${catCalm(24)} Твои данные</h2>
    <button type="button" class="ghost" id="btn-export2">Сохранить копию в файл</button>
    <label class="filebtn">
      <input type="file" id="file-backup" accept=".json">
      <button type="button" class="ghost"
              onclick="this.parentNode.querySelector('input').click()">Восстановить из копии</button>
    </label>
    <button type="button" class="ghost danger" id="btn-wipe">Удалить всё</button>
    <div class="note">Записи только в этом телефоне: ни аккаунта, ни сервера. Меняешь
      телефон — сделай копию заранее.</div>
  </section>`;
}
