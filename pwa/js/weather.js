/**
 * Погода подтягивается сама, по координатам города. Ни ключей, ни регистрации,
 * ни своего сервера: Open-Meteo отдаёт данные прямо в браузер.
 *
 * Два эндпоинта, потому что нужны разные вещи:
 *   archive  — реанализ ERA5, вся история, отстаёт от сегодня примерно на 5 дней;
 *   forecast — последние дни и прогноз вперёд, нужен для «риска на сегодня и завтра».
 * Всё, что скачано, лежит в IndexedDB — повторный запуск сеть не дёргает.
 */
import { weather as wStore, getSetting } from './store.js';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURLY = 'surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

async function coords() {
  return {
    latitude: await getSetting('lat'),
    longitude: await getSetting('lon'),
    timezone: await getSetting('tz'),
  };
}

/** Поиск города по названию — чтобы человек не искал свои координаты руками. */
export async function findCity(name) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=5&language=ru`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Не получилось найти город');
  const js = await r.json();
  return (js.results || []).map((c) => ({
    name: c.name, admin: c.admin1 || '', country: c.country || '',
    lat: c.latitude, lon: c.longitude, tz: c.timezone,
  }));
}

/** Часовые данные → суточные признаки. Для давления важны не средние, а размах. */
function toDaily(hourly, kind) {
  if (!hourly || !hourly.time) return [];
  const buckets = new Map();
  hourly.time.forEach((t, i) => {
    const date = t.slice(0, 10);
    if (!buckets.has(date)) buckets.set(date, []);
    buckets.get(date).push(i);
  });
  const num = (arr) => arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const out = [];
  for (const [date, idx] of buckets) {
    const p = num(idx.map((i) => hourly.surface_pressure?.[i]));
    const t = num(idx.map((i) => hourly.temperature_2m?.[i]));
    const rh = num(idx.map((i) => hourly.relative_humidity_2m?.[i]));
    const w = num(idx.map((i) => hourly.wind_speed_10m?.[i]));
    const pr = num(idx.map((i) => hourly.precipitation?.[i]));
    if (!p.length && !t.length) continue;
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    out.push({
      date, kind,
      hours: idx.length,
      p_mean: round(mean(p)), p_min: round(Math.min(...p)), p_max: round(Math.max(...p)),
      t_mean: round(mean(t)), t_min: round(Math.min(...t)), t_max: round(Math.max(...t)),
      rh_mean: round(mean(rh)), wind_max: w.length ? round(Math.max(...w)) : null,
      precip: pr.length ? round(pr.reduce((s, v) => s + v, 0)) : null,
    });
  }
  return out;
}

const round = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

async function fetchArchive(from, to) {
  const c = await coords();
  const q = new URLSearchParams({ ...c, start_date: from, end_date: to, hourly: HOURLY });
  const r = await fetch(`${ARCHIVE_URL}?${q}`);
  if (!r.ok) throw new Error(`Архив погоды недоступен (${r.status})`);
  const rows = toDaily((await r.json()).hourly, 'archive');
  await wStore.putMany(rows);
  return rows.length;
}

async function fetchRecent(pastDays = 10, forecastDays = 3) {
  const c = await coords();
  const q = new URLSearchParams({ ...c, hourly: HOURLY, past_days: pastDays, forecast_days: forecastDays });
  const r = await fetch(`${FORECAST_URL}?${q}`);
  if (!r.ok) throw new Error(`Прогноз погоды недоступен (${r.status})`);
  const rows = toDaily((await r.json()).hourly, 'forecast');
  await wStore.putMany(rows);
  return rows.length;
}

/**
 * Догоняет погоду до полного покрытия дневника и до завтрашнего дня.
 * Тянет только недостающие куски, поэтому обычный запуск занимает секунды.
 */
export async function sync({ entriesFrom, entriesTo, padDays = 7, onProgress = () => {} } = {}) {
  const today = iso(new Date());
  const needFrom = entriesFrom ? shift(entriesFrom, -padDays) : shift(today, -90);
  const archiveTo = shift(today, -6);              // ERA5 отстаёт, дальше берём из прогноза
  const [haveFrom, haveTo] = await wStore.range('archive');

  let fetched = 0;
  if (!haveFrom) {
    onProgress('качаю историю погоды за весь период дневника…');
    fetched += await fetchArchive(needFrom, archiveTo);
  } else {
    if (needFrom < haveFrom) {
      onProgress('дополняю историю назад…');
      fetched += await fetchArchive(needFrom, haveFrom);
    }
    if (haveTo < archiveTo) {
      onProgress('дополняю историю до свежих дней…');
      fetched += await fetchArchive(haveTo, archiveTo);
    }
  }
  onProgress('беру свежую погоду и прогноз…');
  fetched += await fetchRecent();

  const all = await wStore.all();
  return {
    fetched,
    days: all.length,
    from: all.length ? all[0].date : null,
    to: all.length ? all[all.length - 1].date : null,
  };
}

export async function byDate() {
  const rows = await wStore.all();
  const map = new Map();
  // архивная запись точнее прогнозной: если есть обе, оставляем архив
  rows.forEach((r) => {
    const prev = map.get(r.date);
    if (!prev || (prev.kind === 'forecast' && r.kind === 'archive')) map.set(r.date, r);
  });
  return map;
}
