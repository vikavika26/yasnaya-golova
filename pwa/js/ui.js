/**
 * Отрисовка экранов. Чистые функции: данные на вход, разметка на выход.
 *
 * Про язык: здесь принципиально нет статистического жаргона. Человеку с болью не
 * нужны слова «множественные сравнения» и «бутстрап» — ему нужно понимать, почему
 * приложение говорит «влияет» или «просто совпадение». Методика от этого не
 * меняется, меняются только формулировки.
 */
import { catCalm, catAchy, catCurious, catUnsure, catSleepy, catForRisk, catForVerdict } from './cats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pct = (v) => `${Math.round(v * 100)}%`;
const fix = (v, n = 2) => (v === null || v === undefined ? '—' : v.toFixed(n));

/** Статусы проверки — понятными словами вместо «подтверждён / не подтвердился». */
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
  needs_daily: 'нужны отметки и в хорошие дни',
  not_measurable: 'пока не умею проверять',
};

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const humanDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${+d} ${RU_MONTHS[+m - 1]} ${y}`;
};

const plural = (n, one, few, many) => {
  const m10 = Math.round(n) % 10, m100 = Math.round(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

/** Почему получился такой статус — по-человечески, без терминов. */
function humanReason(f, tested) {
  switch (f.verdict) {
    case 'confirmed':
      return 'В такие дни голова болит заметно чаще, и это не рассыпается, когда я убираю'
        + ' случайные куски дневника. Похоже на настоящую связь.';
    case 'protective':
      return 'В такие дни болит реже обычного. Не значит, что это лечит — просто такие дни'
        + ' у тебя проходят спокойнее.';
    case 'not_confirmed': {
      if (f.bh && f.bh.survived) {
        return 'Разница выглядела заметной, но держится на нескольких затяжных приступах:'
          + ' стоит их убрать — и она исчезает. Пока не поверю.';
      }
      const dir = f.rr >= 1 ? 'чуть чаще' : 'чуть реже';
      return `Болит ${dir}, но такая разница легко получается сама собой. Я проверила`
        + ` ${tested} ${plural(tested, 'версию', 'версии', 'версий')}, а при таком количестве`
        + ' попыток одна-две всегда выглядят подозрительно — случайно.';
    }
    case 'few_data':
      return `Дней, когда это совпало с болью, пока всего ${f.exposedHeadache}. Чтобы отличить`
        + ' закономерность от совпадения, мне нужно хотя бы восемь — вернусь к этому позже.';
    default:
      return 'Нет данных, чтобы это посчитать.';
  }
}

/** Числа — тоже словами, а не «RR [CI]». */
function humanNumbers(f) {
  if (!f.rr) return '';
  const more = f.rr >= 1 ? 'чаще' : 'реже';
  const times = f.rr >= 1 ? f.rr : 1 / f.rr;
  return `болит в ${pct(f.p1)} таких дней против ${pct(f.p0)} в остальные`
    + ` · это в ${fix(times)} раза ${more}`
    + `<span class="muted"> (с запасом на случайность: от ${fix(f.lo)} до ${fix(f.hi)})</span>`;
}

/* ─────────────────────────── Сегодня ─────────────────────────── */

export function renderToday({ today, risk, analysis, entry, weather }) {
  const prob = risk?.forecast?.find((f) => f.date === today)?.probability ?? analysis?.baseRate ?? null;
  const base = analysis?.baseRate ?? null;
  const rel = prob !== null && base ? prob / base : null;

  let mood = 'обычный день';
  if (rel !== null) {
    if (rel >= 1.4) mood = 'сегодня стоит поберечься';
    else if (rel <= 0.75) mood = 'сегодня спокойно';
  }
  const active = risk?.forecast?.find((f) => f.date === today)?.active || [];
  const honest = risk?.backtest?.beatsBaseline === false;

  return `
  <section class="card hero">
    ${catForRisk(prob, base, 104)}
    <div class="value">${prob === null ? '—' : pct(prob)}</div>
    <div class="label">${esc(mood)}</div>
    ${base !== null ? `<div class="sub">Обычно голова болит в ${pct(base)} дней —
      с этим и сравниваю</div>` : ''}
    ${active.length ? `<div class="chips" style="justify-content:center">${
      active.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>` : ''}
    ${honest ? `<div class="explain warm">Честно: пока эта цифра угадывает не лучше, чем
      «в среднем столько-то дней болит». Показываю как ориентир, а не как предсказание —
      чем больше отметок, тем точнее станет.</div>` : ''}
  </section>

  ${weather ? `<section class="card">
    <h2>${catCurious(26)} Погода за окном</h2>
    <div class="kv">
      <div class="k">Давление</div><div>${fix(weather.p_mean, 0)} гПа${
        weather.p_delta !== null && weather.p_delta !== undefined
          ? ` <span class="muted">(${weather.p_delta > 0 ? '+' : ''}${fix(weather.p_delta, 1)} за сутки)</span>`
          : ''}</div>
      <div class="k">Температура</div><div>${fix(weather.t_mean, 1)} °C</div>
      <div class="k">Влажность</div><div>${fix(weather.rh_mean, 0)} %</div>
    </div>
    <div class="explain">Погоду беру не по ощущениям, а из открытого архива наблюдений —
      поэтому её можно честно сравнить с днями боли. И смотрю в первую очередь не на само
      давление, а на то, насколько оно изменилось за сутки.</div>
    <div class="source">Источник: Open-Meteo. История — архив ERA5, это европейский
      реанализ погоды по всему миру; свежие дни и завтрашний прогноз — оттуда же.
      Данные открытые, скачиваются сами, аккаунт не нужен.</div>
  </section>` : ''}

  <section class="card">
    <h2>${catAchy(26)} Как прошёл день</h2>
    <form id="entry-form">
      <div class="row" style="margin-bottom:16px">
        <div class="main"><div class="name">Болела голова?</div></div>
        <div class="chips" style="margin:0">
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
          <span>Что приняла, если принимала</span>
          <input type="text" id="med_text" placeholder="например, цитрамон 2 таблетки"
                 value="${esc(entry?.med_text || '')}">
        </label>
        <div class="chips" style="margin-bottom:16px">
          ${['помогло', 'немного помогло', 'не помогло'].map((w) => `
            <button type="button" class="chip ${entry?.med_helped === w ? 'on' : ''}"
                    data-helped="${w}">${w}</button>`).join('')}
        </div>
      </div>

      <div class="row" style="border:0;padding:0;margin-bottom:14px">
        <div class="main"><div class="name">Менструация</div></div>
        <div class="chips" style="margin:0">
          <button type="button" class="chip ${entry?.mens === 1 ? 'on' : ''}" data-mens="1">да</button>
          <button type="button" class="chip ${entry?.mens === 0 ? 'on' : ''}" data-mens="0">нет</button>
        </div>
      </div>

      <div class="name" style="margin-bottom:8px">Что ещё было сегодня</div>
      <div class="chips" id="daily-chips" style="margin-top:0">
        ${[['sleepShort', 'мало спала'], ['stress', 'нервный день'],
           ['alcohol', 'алкоголь'], ['coffee', 'много кофе']].map(([k, label]) => `
          <button type="button" class="chip ${entry?.daily?.[k] ? 'on' : ''}"
                  data-daily="${k}">${label}</button>`).join('')}
      </div>
      <div class="explain">Отмечай это и в хорошие дни тоже, даже когда ничего не болит.
        Иначе недосып и нервы всегда будут выглядеть виноватыми — просто потому, что их
        замечают только когда плохо. Спокойные дни нужны мне для сравнения.</div>

      <button type="submit" class="primary" style="margin-top:16px">Сохранить день</button>
    </form>
  </section>`;
}

/* ─────────────────────────── Триггеры ─────────────────────────── */

export function renderTriggers(analysis) {
  if (!analysis) {
    return `<section class="card"><div class="empty">${catSleepy(88)}
      <div class="t">Пока нечего показать</div>
      <div class="s">Перенеси дневник на вкладке «Дневник» — и я всё посчитаю.</div>
    </div></section>`;
  }

  const beliefs = analysis.beliefs.filter((b) => b.namedTimes >= 2).slice(0, 8);
  const groups = new Map();
  analysis.factors.forEach((f) => {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  });
  const order = { confirmed: 0, protective: 1, not_confirmed: 2, few_data: 3, no_data: 4 };
  const GROUP_HINT = {
    'Цикл': 'Гормональные колебания — самая частая причина мигрени у женщин.',
    'Погода': 'Погоду винят чаще всего. Проверяю по настоящим наблюдениям, а не по ощущениям.',
    'Режим': 'На выходных сдвигается сон и меняется привычный кофе — иногда это заметно.',
    'Мои отметки': 'То, что ты отмечаешь сама каждый день.',
    'Инерция': 'Не причина, а продолжение приступа. Считаю отдельно, чтобы не путать одно с другим.',
  };

  return `
  <section class="card">
    <h2>${catCurious(26)} Во что верю и что вышло на самом деле</h2>
    ${beliefs.length ? beliefs.map((b) => `
      <div class="row">
        <div class="main">
          <div class="name">${esc(b.label)}
            <span class="muted small">· винила ${b.namedTimes}
            ${plural(b.namedTimes, 'раз', 'раза', 'раз')}</span></div>
          <div class="note">${esc(humanBelief(b))}</div>
        </div>
        <span class="tag ${b.status}">${BELIEF_LABEL[b.status]}</span>
      </div>`).join('')
      : `<div class="empty">${catUnsure(72)}<div class="t">Сравнивать пока нечего</div>
        <div class="s">В дневнике не отмечено, что ты считала причиной.</div></div>`}
    <div class="explain">Слева — то, что ты сама записывала как причину. Справа — что
      получилось, когда я сверила это с данными. Расхождение — это нормально: мы запоминаем
      то, что бросается в глаза, а не то, что случается чаще.</div>
  </section>

  ${[...groups.entries()].map(([group, list]) => `
  <section class="card">
    <h2>${esc(group)}</h2>
    ${GROUP_HINT[group] ? `<div class="explain" style="margin-top:0;margin-bottom:14px">
      ${esc(GROUP_HINT[group])}</div>` : ''}
    ${list.sort((a, b) => order[a.verdict] - order[b.verdict]).map((f) => `
      <div class="row">
        <div class="stack">${catForVerdict(f.verdict, 38)}</div>
        <div class="main">
          <div class="name">${esc(f.label)}</div>
          ${f.rr ? `<div class="note">${humanNumbers(f)}</div>` : ''}
          <div class="note">${esc(humanReason(f, analysis.testedHypotheses))}</div>
          ${f.hint ? `<div class="note muted">${esc(f.hint)}</div>` : ''}
        </div>
        <span class="tag ${f.verdict}">${VERDICT_LABEL[f.verdict]}</span>
      </div>`).join('')}
  </section>`).join('')}

  ${renderLagChart(analysis.lagProfiles)}
  ${renderMethod(analysis)}`;
}

function humanBelief(b) {
  switch (b.status) {
    case 'supported':
      return `И данные согласны. ${b.comment.replace(/^подтверждается:\s*/i, '')}`;
    case 'not_supported':
      return 'Я проверила это со всех сторон и связи не нашла. Скорее всего, такие дни просто'
        + ' запоминались ярче остальных.';
    case 'needs_daily':
      return 'Проверить пока не могу: ты отмечаешь это только когда болит. Начни отмечать'
        + ' каждый день — тогда будет с чем сравнивать.';
    default:
      return 'Этого нет ни в погоде, ни в цикле, так что сверить не с чем. Если начнёшь'
        + ' отмечать каждый день, смогу проверить.';
  }
}

function renderLagChart(profiles) {
  if (!profiles) return '';
  const blocks = Object.values(profiles).filter((p) => p.points.some((pt) => pt.rr !== null));
  if (!blocks.length) return '';
  return `
  <section class="card">
    <h2>${catUnsure(26)} Причина или уже начало приступа</h2>
    ${blocks.map((b) => `
      <h3>${esc(b.label)}</h3>
      <div class="bars" style="margin-bottom:16px">
        ${b.points.map((pt) => {
          const rr = pt.rr ?? 0;
          return `<div class="bar-row">
            <div>${pt.lag === 0 ? 'в тот же день'
              : `${pt.lag} ${plural(pt.lag, 'день', 'дня', 'дней')} назад`}</div>
            <div class="bar-track"><div class="bar-fill ${rr < 1.15 ? 'low' : ''}"
                 style="width:${Math.min(100, (rr / 2.5) * 100)}%"></div></div>
            <div class="bar-value">×${fix(rr, 1)}</div>
          </div>`;
        }).join('')}
      </div>`).join('')}
    <div class="explain">Зачем это нужно: настоящая причина обычно срабатывает заранее, за день
      или два. А то, что совпадает только в сам день боли, чаще всего уже начало приступа,
      а не его причина. Классический пример — тянет на сладкое не потому, что шоколад вызвал
      боль, а потому, что приступ уже начался.</div>
  </section>`;
}

function renderMethod(a) {
  const conf = a.factors.filter((f) => f.verdict === 'confirmed').length;
  return `
  <section class="card">
    <h2>${catCalm(26)} Откуда берутся эти выводы</h2>
    <div class="steps">
      <div class="step"><div class="num"></div><div class="txt">
        <b>Сначала составляю список подозреваемых</b> — до того, как посмотрю на цифры.
        Так нельзя подогнать вывод под то, во что уже веришь.</div></div>
      <div class="step"><div class="num"></div><div class="txt">
        <b>Считаю по всем дням, а не по приступам.</b> Спокойные дни так же важны: без них
        не понять, что необычного было в дни с болью.</div></div>
      <div class="step"><div class="num"></div><div class="txt">
        <b>Смотрю со сдвигом на день и два.</b> Погода могла испортиться вчера,
        а голова заболеть сегодня.</div></div>
      <div class="step"><div class="num"></div><div class="txt">
        <b>Делаю скидку на число попыток.</b> Если перебрать ${a.testedHypotheses} версий,
        одна покажется виновной просто по случайности — поэтому чем больше я проверяю,
        тем строже порог.</div></div>
      <div class="step"><div class="num"></div><div class="txt">
        <b>И проверяю на прочность:</b> выкидываю случайные куски дневника и смотрю, держится
        ли связь. Рассыпалась — значит, показалось.</div></div>
    </div>
    <div class="explain">На твоих данных: ${a.knownDays}
      ${plural(a.knownDays, 'день', 'дня', 'дней')} с записями, из них ${a.headacheDays} с болью.
      Проверено версий: ${a.testedHypotheses}, прошло проверку: ${conf}.
      ${conf === 0 ? ' Ничего не подтвердилось — это тоже честный ответ, а не пустой экран.' : ''}</div>
    <div class="explain warm">Я не врач и не ставлю диагнозов. Я только показываю, что видно
      в твоих записях, — с этим удобно идти к доктору.</div>
  </section>`;
}

/* ─────────────────────────── Дневник ─────────────────────────── */

export function renderDiary({ days, stats }) {
  const last = days.filter((d) => d.headache !== null).slice(-40).reverse();
  return `
  <section class="card">
    <h2>${catCalm(26)} Что уже накопилось</h2>
    <div class="kv">
      <div class="k">Дней записано</div><div>${stats.entries}</div>
      <div class="k">Из них с болью</div><div>${stats.headacheDays}</div>
      <div class="k">Период</div><div>${stats.from
        ? `${humanDate(stats.from)} — ${humanDate(stats.to)}` : '—'}</div>
      <div class="k">Дней с погодой</div><div>${stats.weatherDays}</div>
    </div>
    <label class="filebtn" style="margin-top:16px">
      <input type="file" id="file-migrebot" accept=".xlsx">
      <button type="button" class="primary"
              onclick="this.parentNode.querySelector('input').click()">
        Перенести дневник из Мигребота
      </button>
    </label>
    <div class="explain">В Мигреботе нажми «Скачать дневник» и выбери этот файл здесь.
      Переносить можно сколько угодно раз: дни с одинаковой датой просто обновятся,
      дубликатов не будет.</div>
  </section>

  <section class="card">
    <h2>Последние дни</h2>
    ${last.length ? last.map((d) => `
      <div class="row">
        <div class="stack">${d.headache === 1 ? catAchy(34) : catCalm(34)}</div>
        <div class="main">
          <div class="name">${humanDate(d.date)}${d.headache === 1
            ? ` · болело на ${d.intensity ?? '?'} из 10` : ''}</div>
          <div class="note">${[
            d.headache === 1 ? null : 'голова не болела',
            d.mens === 1 ? 'менструация' : null,
            d.medTaken ? 'принимала таблетку' : null,
            d.p_mean !== null ? `давление ${Math.round(d.p_mean)}` : null,
            d.selfTriggers?.length ? `винила: ${d.selfTriggers.join(', ').toLowerCase()}` : null,
          ].filter(Boolean).join(' · ')}</div>
        </div>
      </div>`).join('')
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
    <h2>${catCurious(26)} Коротко для приёма</h2>
    <div class="kv">
      <div class="k">Наблюдаю</div><div>${analysis.knownDays} дней</div>
      <div class="k">Дней с болью</div><div>${analysis.headacheDays} (${pct(analysis.baseRate)})</div>
      <div class="k">В среднем за месяц</div><div>${perMonth}</div>
      <div class="k">Больше всего дней с таблеткой в одном месяце</div><div>${m.maxMedDays}</div>
    </div>
    ${m.riskyMonths > 0
      ? `<div class="explain warm">Были месяцы, когда обезболивающее принималось десять дней
         и чаще — таких ${m.riskyMonths}. С этого количества врачи начинают проверять, не
         поддерживают ли сами таблетки головную боль. Стоит показать эту цифру доктору.</div>`
      : `<div class="explain">Таблетки ни в одном месяце не доходили до десяти дней — это тот
         порог, с которого врачи начинают беспокоиться, что обезболивающие сами поддерживают
         боль. У тебя максимум ${m.maxMedDays}.</div>`}
  </section>

  <section class="card">
    <h2>Как шли месяцы</h2>
    <div class="bars">
      ${months.map((x) => `
        <div class="bar-row">
          <div>${x.month}</div>
          <div class="bar-track"><div class="bar-fill ${x.medDays >= m.threshold ? '' : 'low'}"
               style="width:${(x.headacheDays / maxBar) * 100}%"></div></div>
          <div class="bar-value">${x.headacheDays} / ${x.medDays}</div>
        </div>`).join('')}
    </div>
    <div class="explain">Справа две цифры: сколько дней в этом месяце болело и в скольких
      из них ты принимала таблетку.</div>
  </section>

  <section class="card">
    <h2>${catAchy(26)} Что подтвердилось на данных</h2>
    ${confirmed.length ? confirmed.map((f) => `
      <div class="row">
        <div class="stack">${catAchy(34)}</div>
        <div class="main">
          <div class="name">${esc(f.label)}</div>
          <div class="note">болит в ${pct(f.p1)} таких дней против ${pct(f.p0)} в остальные —
            это в ${fix(f.rr)} раза чаще. Случаев: ${f.exposedHeadache} из ${f.exposedDays}.</div>
        </div>
        <span class="tag confirmed">${VERDICT_LABEL.confirmed}</span>
      </div>`).join('')
      : `<div class="empty">${catUnsure(72)}<div class="t">Пока ничего не подтвердилось</div>
         <div class="s">Это тоже результат: простых объяснений в этих данных нет.</div></div>`}
    ${risk?.backtest ? `<div class="explain">Прогноз проверен по-честному: училась на
      ${risk.backtest.trainDays} днях, а угадывала на ${risk.backtest.testDays} следующих,
      которых до этого не видела. Выходит
      ${risk.backtest.beatsBaseline ? 'немного лучше' : 'пока не лучше'}, чем просто
      «в среднем ${pct(risk.backtest.baseRate)} дней болит».</div>` : ''}
  </section>

  <section class="card">
    <h2>Забрать с собой</h2>
    <button type="button" class="primary" id="btn-report">Сводка текстом для врача</button>
    <button type="button" class="ghost" id="btn-export">Сохранить копию данных</button>
    <div class="explain warm">Приложение не ставит диагнозов и не назначает лечение.
      Это просто аккуратно собранная картина твоих записей.</div>
  </section>`;
}

/* ─────────────────────────── Настройки ─────────────────────────── */

export function renderSettings(settings, stats) {
  return `
  <section class="card">
    <h2>${catCurious(26)} Город для погоды</h2>
    <label class="field">
      <span>Найти свой город</span>
      <input type="text" id="city-input" value="${esc(settings.city)}" placeholder="Санкт-Петербург">
    </label>
    <div id="city-results"></div>
    <button type="button" class="ghost" id="btn-find-city">Найти город</button>
    <button type="button" class="primary" id="btn-sync-weather" style="margin-top:10px">
      Обновить погоду за все дни
    </button>
    <div class="explain">Сейчас стоит ${esc(settings.city)}. Историю давления, температуры,
      влажности и ветра приложение скачивает само и держит у себя — поэтому всё работает
      и без интернета. Уже скачано дней: ${stats.weatherDays}.</div>
    <div class="source">Откуда погода: сервис Open-Meteo. История — из архива ERA5, это
      европейский реанализ наблюдений за погодой по всему миру; свежие дни и прогноз —
      из их же прогноза. Данные открытые и бесплатные, аккаунт не нужен.</div>
  </section>

  <section class="card">
    <h2>${catCalm(26)} Твои данные</h2>
    <button type="button" class="ghost" id="btn-export2">Сохранить копию в файл</button>
    <label class="filebtn">
      <input type="file" id="file-backup" accept=".json">
      <button type="button" class="ghost"
              onclick="this.parentNode.querySelector('input').click()">
        Восстановить из копии
      </button>
    </label>
    <button type="button" class="ghost" id="btn-wipe" style="color:#C4697F">Удалить всё</button>
    <div class="explain">Записи живут только в этом телефоне: ни аккаунта, ни сервера,
      никуда ничего не отправляется. Единственный способ вынести данные — сохранить копию
      самой. Собираешься менять телефон — сделай копию заранее.</div>
  </section>

  <section class="card">
    <h2>${catSleepy(26)} Про приложение</h2>
    <div class="explain">«Ясная голова» — дневник головной боли, который не просто хранит
      записи, а сам ищет закономерности: подтягивает настоящую погоду, сравнивает дни с болью
      и без, проверяет со сдвигом на сутки и честно говорит «не знаю», когда данных мало.
      Ничего не обещает и не лечит — помогает разобраться и подготовиться к врачу.</div>
  </section>`;
}
