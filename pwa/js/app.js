/** Сборка приложения: состояние, переключение экранов, обработчики. */
import * as store from './store.js';
import * as weatherApi from './weather.js';
import { buildDays, analyze, riskModel, yearSummary } from './engine.js';
import { importMigrebotFile } from './import.js';
import { importCsvFile } from './csv.js';
import { buildReportHtml } from './report.js';
import * as ui from './ui.js';
import * as notify from './notify.js';

const view = document.getElementById('view');
const title = document.getElementById('screen-title');
const toastEl = document.getElementById('toast');

const TITLES = { today: 'Сегодня', triggers: 'Триггеры', diary: 'Дневник', doctor: 'Врачу', settings: 'Настройки' };
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

const state = { screen: 'today', days: [], analysis: null, risk: null, stats: null,
  settings: null, savedAt: null, year: null, onbStep: 0 };

/** Тема применяется к <html>, чтобы переменные цвета подхватились сразу. */
function applyTheme(choice) {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = choice === 'auto' ? (dark ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { light: '#FFF8F4', dark: '#16141A', dim: '#14131A' }[theme];
}
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
  state.year = yearSummary(state.days);
}

function currentWeather() {
  const t = todayIso();
  const d = state.days.find((x) => x.date === t);
  return d && d.p_mean !== null ? d : null;
}

function render() {
  if (state.screen === 'onboarding') {
    title.textContent = 'Ясная голова';
    view.innerHTML = ui.renderOnboarding(state.onbStep, state.settings || {});
    bindOnboarding();
    document.querySelector('.tabs').hidden = true;
    return;
  }
  document.querySelector('.tabs').hidden = false;
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
      savedAt: state.savedAt,
    });
    bindToday();
  } else if (state.screen === 'triggers') {
    view.innerHTML = ui.renderTriggers(state.analysis);
  } else if (state.screen === 'diary') {
    view.innerHTML = ui.renderDiary({ days: state.days, stats: state.stats });
    bindDiary();
  } else if (state.screen === 'doctor') {
    view.innerHTML = ui.renderDoctor({ analysis: state.analysis, risk: state.risk, year: state.year });
    bindDoctor();
  } else if (state.screen === 'settings') {
    view.innerHTML = ui.renderSettings(state.settings, state.stats, notify.isNative());
    bindSettings();
  }
}

function entryToForm(day) {
  return {
    headache: day.headache, intensity: day.intensity, mens: day.mens,
    med_text: day.medText || '', med_helped: day.medHelped,
    daily: day.daily || {}, note: day.note || '',
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
    const note = document.getElementById('note')?.value.trim() || null;
    await store.entries.put({
      date: todayIso(),
      headache: picked.headache,
      intensity: picked.headache === 1 ? Number(slider?.value || 4) : null,
      mens: picked.mens,
      med_taken: medText ? 1 : 0,
      med_text: medText,
      med_helped: medText ? picked.helped : null,
      daily: picked.daily,
      note,
      source: 'manual',
    });
    // видимое подтверждение: карточка меняет заголовок и показывает время записи
    state.savedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    await recompute();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Записала, спасибо ✨');
  });
}

/* ─── Дневник ─── */

function bindOnboarding() {
  document.querySelectorAll('[data-onb]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.onb;
      if (act === 'next') { state.onbStep += 1; render(); return; }
      await store.setSetting('onboarded', true);
      state.settings = await store.allSettings();
      state.screen = act === 'import' ? 'diary' : 'today';
      render();
      if (act !== 'import') syncWeather({ force: true }).then(async () => { await recompute(); render(); });
    });
  });
  document.getElementById('onb-find')?.addEventListener('click', async () => {
    const name = document.getElementById('onb-city').value.trim();
    if (!name) return;
    try {
      const list = await weatherApi.findCity(name);
      const box = document.getElementById('onb-city-results');
      box.innerHTML = list.map((c, i) => `
        <div class="row"><div class="main"><div class="name">${c.name}</div>
        <div class="note">${[c.admin, c.country].filter(Boolean).join(', ')}</div></div>
        <button class="chip" data-city="${i}">выбрать</button></div>`).join('')
        || '<div class="note">Ничего не нашлось</div>';
      box.querySelectorAll('[data-city]').forEach((b) => {
        b.addEventListener('click', async () => {
          const c = list[+b.dataset.city];
          await store.setSetting('city', c.name);
          await store.setSetting('lat', c.lat);
          await store.setSetting('lon', c.lon);
          await store.setSetting('tz', c.tz);
          state.settings = await store.allSettings();
          toast(`Город: ${c.name}`);
          state.onbStep = 2;
          render();
        });
      });
    } catch (err) { toast(err.message); }
  });
}

function bindDiary() {
  document.getElementById('file-csv')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast('Читаю файл…', 8000);
    try {
      const res = await importCsvFile(file);
      await syncWeather();
      await recompute();
      render();
      toast(res.attacksOnly
        ? `Перенесла ${res.imported} приступов. В файле нет спокойных дней — отмечай их здесь,`
          + ' иначе сравнивать будет не с чем'
        : `Перенесла ${res.imported} дней`, 6000);
    } catch (err) {
      toast(`Не получилось: ${err.message}`, 5000);
    }
  });

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

  document.getElementById('btn-print-report')?.addEventListener('click', async () => {
    const html = buildReportHtml({
      analysis: state.analysis, risk: state.risk, year: state.year,
      city: state.settings?.city,
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {                       // всплывающие окна закрыты — отдаём файлом
      const link = document.createElement('a');
      link.href = url;
      link.download = `отчёт-для-врача-${todayIso()}.html`;
      link.click();
      toast('Отчёт сохранён файлом — открой его и распечатай', 5000);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
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

  document.querySelectorAll('[data-theme-opt]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await store.setSetting('theme', btn.dataset.themeOpt);
      state.settings = await store.allSettings();
      applyTheme(state.settings.theme);
      render();
    });
  });

  const setReminder = async (on) => {
    if (on) {
      const granted = await notify.requestPermission();
      if (!granted) return toast('Без разрешения на уведомления не смогу напоминать', 4000);
    }
    await store.setSetting('reminderOn', on);
    state.settings = await store.allSettings();
    const res = await notify.sync({ enabled: on, time: state.settings.reminderTime });
    render();
    if (!on) toast('Напоминания выключены');
    else if (res.ok) toast(`Буду напоминать в ${state.settings.reminderTime}`);
    else toast(`Напоминания недоступны: ${res.reason}`, 4000);
  };
  document.querySelectorAll('[data-reminder]').forEach((btn) => {
    btn.addEventListener('click', () => setReminder(btn.dataset.reminder === 'on'));
  });
  document.getElementById('reminder-time')?.addEventListener('change', async (e) => {
    await store.setSetting('reminderTime', e.target.value);
    state.settings = await store.allSettings();
    if (state.settings.reminderOn) {
      await notify.sync({ enabled: true, time: e.target.value });
      toast(`Перенесла напоминание на ${e.target.value}`);
    }
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
  if (!state.settings?.onboarded && !state.stats?.entries) state.screen = 'onboarding';
  applyTheme(state.settings?.theme || 'auto');
  window.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => applyTheme(state.settings?.theme || 'auto'));
  render();
  // расписание напоминаний приводим в порядок при каждом запуске
  if (state.settings?.reminderOn) {
    notify.sync({ enabled: true, time: state.settings.reminderTime }).catch(() => {});
  }
  if (state.stats.entries && navigator.onLine) {
    // погода догоняется в фоне, экран не ждёт сети
    syncWeather().then(async () => { await recompute(); render(); });
  }
  // В APK файлы уже локальные, service worker там лишний и только мешает
  if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
