/** Сборка приложения: состояние, переключение экранов, обработчики. */
import * as store from './store.js';
import * as weatherApi from './weather.js';
import { buildDays, analyze, riskModel } from './engine.js';
import { importMigrebotFile } from './import.js';
import * as ui from './ui.js';

const view = document.getElementById('view');
const title = document.getElementById('screen-title');
const toastEl = document.getElementById('toast');

const TITLES = { today: 'Сегодня', triggers: 'Триггеры', diary: 'Дневник', doctor: 'Врачу', settings: 'Настройки' };
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

const state = { screen: 'today', days: [], analysis: null, risk: null, stats: null, settings: null };
let toastTimer = null;

function toast(text, ms = 2600) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

/** Пересчёт всего: дни → анализ → прогноз. Тяжёлое считается один раз на изменение. */
async function recompute() {
  const entries = await store.entries.all();
  state.stats = await store.stats();
  state.settings = await store.allSettings();
  if (!entries.length) { state.days = []; state.analysis = null; state.risk = null; return; }
  const wMap = await weatherApi.byDate();
  state.days = buildDays(entries, wMap, { until: todayIso() });
  state.analysis = analyze(state.days);
  state.risk = riskModel(state.days, state.analysis);
}

function currentWeather() {
  const t = todayIso();
  const d = state.days.find((x) => x.date === t);
  return d && d.p_mean !== null ? d : null;
}

function render() {
  title.textContent = TITLES[state.screen];
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.screen === state.screen);
  });

  const t = todayIso();
  if (state.screen === 'today') {
    const entry = state.days.find((d) => d.date === t) || null;
    view.innerHTML = ui.renderToday({
      today: t, risk: state.risk, analysis: state.analysis,
      entry: entry && entry.headache !== null ? entryToForm(entry) : null,
      weather: currentWeather(),
    });
    bindToday();
  } else if (state.screen === 'triggers') {
    view.innerHTML = ui.renderTriggers(state.analysis);
  } else if (state.screen === 'diary') {
    view.innerHTML = ui.renderDiary({ days: state.days, stats: state.stats });
    bindDiary();
  } else if (state.screen === 'doctor') {
    view.innerHTML = ui.renderDoctor({ analysis: state.analysis, risk: state.risk });
    bindDoctor();
  } else if (state.screen === 'settings') {
    view.innerHTML = ui.renderSettings(state.settings, state.stats);
    bindSettings();
  }
}

function entryToForm(day) {
  return {
    headache: day.headache, intensity: day.intensity, mens: day.mens,
    med_text: day.medText || '', med_helped: day.medHelped, daily: day.daily || {},
  };
}

async function go(screen) { state.screen = screen; render(); }

/* ─── Сегодня ─── */

function bindToday() {
  const form = document.getElementById('entry-form');
  if (!form) return;
  const picked = { headache: null, mens: null, helped: null, daily: {} };

  // подтягиваем то, что уже сохранено на сегодня
  form.querySelectorAll('[data-hb].on').forEach((b) => { picked.headache = +b.dataset.hb; });
  form.querySelectorAll('[data-mens].on').forEach((b) => { picked.mens = +b.dataset.mens; });
  form.querySelectorAll('[data-helped].on').forEach((b) => { picked.helped = b.dataset.helped; });
  form.querySelectorAll('[data-daily].on').forEach((b) => { picked.daily[b.dataset.daily] = true; });

  const single = (attr, key, cast = (v) => v) => {
    form.querySelectorAll(`[data-${attr}]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const isOn = btn.classList.contains('on');
        form.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.remove('on'));
        if (!isOn) { btn.classList.add('on'); picked[key] = cast(btn.dataset[attr]); }
        else picked[key] = null;
        if (attr === 'hb') document.getElementById('pain-block').hidden = picked.headache !== 1;
      });
    });
  };
  single('hb', 'headache', Number);
  single('mens', 'mens', Number);
  single('helped', 'helped');

  form.querySelectorAll('[data-daily]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('on');
      picked.daily[btn.dataset.daily] = btn.classList.contains('on');
    });
  });

  const slider = document.getElementById('intensity');
  const intVal = document.getElementById('int-val');
  slider?.addEventListener('input', () => { intVal.textContent = slider.value; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (picked.headache === null) return toast('Отметь сначала, болела ли голова');
    const medText = document.getElementById('med_text')?.value.trim() || null;
    await store.entries.put({
      date: todayIso(),
      headache: picked.headache,
      intensity: picked.headache === 1 ? Number(slider?.value || 4) : null,
      mens: picked.mens,
      med_taken: medText ? 1 : 0,
      med_text: medText,
      med_helped: medText ? picked.helped : null,
      daily: picked.daily,
      source: 'manual',
    });
    await recompute();
    render();
    toast('Записала, спасибо ✨');
  });
}

/* ─── Дневник ─── */

function bindDiary() {
  document.getElementById('file-migrebot')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast('Читаю дневник, это займёт пару секунд…', 8000);
    try {
      const res = await importMigrebotFile(file);
      toast(`Перенесла ${res.imported} дней, из них с болью ${res.headacheDays}`, 4000);
      await syncWeather();
      await recompute();
      render();
    } catch (err) {
      toast(`Не получилось прочитать файл: ${err.message}`, 5000);
    }
  });
}

/* ─── Врачу ─── */

function bindDoctor() {
  document.getElementById('btn-report')?.addEventListener('click', () => {
    const text = buildReport();
    if (navigator.share) navigator.share({ title: 'Сводка по головной боли', text }).catch(() => {});
    else { navigator.clipboard?.writeText(text); toast('Сводка скопирована — можно вставить куда угодно'); }
  });
  document.getElementById('btn-export')?.addEventListener('click', exportBackup);
}

function buildReport() {
  const a = state.analysis;
  if (!a) return 'Нет данных';
  const m = a.meds;
  const confirmed = a.factors.filter((f) => f.verdict === 'confirmed');
  const lines = [
    'Дневник головной боли — сводка',
    `Период: ${a.knownDays} дней с записями, ${a.headacheDays} дней с болью (${Math.round(a.baseRate * 100)}%).`,
    `В среднем ${(a.headacheDays / Math.max(1, m.months.length)).toFixed(1)} дней с болью в месяц.`,
    `Обезболивающие: максимум ${m.maxMedDays} дней в месяц, месяцев с 10+ днями приёма — ${m.riskyMonths}.`,
    '',
    'Подтверждённые на данных факторы:',
    ...(confirmed.length
      ? confirmed.map((f) => `— ${f.label}: риск ×${f.rr.toFixed(2)} `
        + `[${f.lo.toFixed(2)}; ${f.hi.toFixed(2)}], ${f.exposedHeadache} приступов из ${f.exposedDays} дней`)
      : ['— ни один фактор не прошёл проверку']),
    '',
    'Проверено и НЕ подтвердилось: '
      + a.factors.filter((f) => f.verdict === 'not_confirmed').map((f) => f.label.toLowerCase()).join('; '),
    '',
    'Метод: гипотезы зафиксированы заранее, поправка Беньямини — Хохберга на множественные сравнения,'
      + ' блочный бутстрап для учёта зависимости соседних дней. Погода — реанализ ERA5 по городу.',
  ];
  return lines.join('\n');
}

async function exportBackup() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yasnaya-golova-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Копия сохранена в загрузки');
}

/* ─── Настройки ─── */

function bindSettings() {
  document.getElementById('btn-find-city')?.addEventListener('click', async () => {
    const name = document.getElementById('city-input').value.trim();
    if (!name) return;
    try {
      const list = await weatherApi.findCity(name);
      const box = document.getElementById('city-results');
      box.innerHTML = list.length ? list.map((c, i) => `
        <div class="row"><div class="main">
          <div class="name">${c.name}</div>
          <div class="note">${[c.admin, c.country].filter(Boolean).join(', ')}</div>
        </div><button class="chip" data-city="${i}">выбрать</button></div>`).join('')
        : '<div class="muted small">Ничего не нашлось</div>';
      box.querySelectorAll('[data-city]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const c = list[+btn.dataset.city];
          await store.setSetting('city', c.name);
          await store.setSetting('lat', c.lat);
          await store.setSetting('lon', c.lon);
          await store.setSetting('tz', c.tz);
          toast(`Город: ${c.name}. Обновляю погоду…`);
          await syncWeather({ force: true });
          await recompute();
          render();
        });
      });
    } catch (err) { toast(err.message); }
  });

  document.getElementById('btn-sync-weather')?.addEventListener('click', async () => {
    await syncWeather({ force: true });
    await recompute();
    render();
  });

  document.getElementById('btn-export2')?.addEventListener('click', exportBackup);

  document.getElementById('file-backup')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const n = await store.importBackup(JSON.parse(await file.text()));
      await recompute(); render();
      toast(`Восстановила ${n} записей`);
    } catch (err) { toast(err.message); }
  });

  document.getElementById('btn-wipe')?.addEventListener('click', async () => {
    if (!confirm('Удалить все записи и погоду? Это нельзя отменить — сначала лучше сохранить копию.')) return;
    await store.wipe();
    await recompute(); render();
    toast('Всё удалено');
  });
}

async function syncWeather({ force = false } = {}) {
  try {
    const s = await store.stats();
    if (!s.entries && !force) return;
    toast('Смотрю, какая была погода…', 6000);
    const res = await weatherApi.sync({
      entriesFrom: s.from, entriesTo: s.to,
      onProgress: (m) => toast(m, 6000),
    });
    toast(`Погода собрана за ${res.days} дней`);
  } catch (err) {
    toast(`Погода не загрузилась: ${err.message}. Попробуй позже.`, 4000);
  }
}

/* ─── Старт ─── */

document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => go(b.dataset.screen));
});
document.getElementById('btn-settings').addEventListener('click', () => {
  go(state.screen === 'settings' ? 'today' : 'settings');
});

(async function boot() {
  await recompute();
  render();
  if (state.stats.entries && navigator.onLine) {
    // погода догоняется в фоне, экран не ждёт сети
    syncWeather().then(async () => { await recompute(); render(); });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
