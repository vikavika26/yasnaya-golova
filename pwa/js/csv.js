/**
 * Импорт из чужих дневников: обычный CSV и выгрузки вроде Migraine Buddy.
 *
 * Главная тонкость, из-за которой нельзя просто «прочитать столбцы»: такие
 * выгрузки почти всегда содержат **только приступы**. Спокойных дней в них нет.
 * Если записать отсутствующие дни как «не болело», статистика поедет: контрольная
 * группа окажется выдуманной. Поэтому дни, которых нет в файле, остаются
 * неизвестными — и приложение прямо говорит, что для выводов нужны отметки
 * в спокойные дни тоже.
 */
import { entries as entriesStore } from './store.js';

/** Разбор CSV с учётом кавычек и автоопределением разделителя. */
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');           // BOM из Excel
  const head = clean.slice(0, 4000);
  const delim = [';', ',', '\t']
    .map((d) => ({ d, n: (head.match(new RegExp(`\\${d}`, 'g')) || []).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const NORM = (s) => String(s ?? '').trim().toLowerCase();

/** Ищем нужные столбцы по ключевым словам — русским и английским. */
const FIELD_HINTS = {
  date: ['дата', 'date', 'start time', 'начало', 'день', 'day', 'time'],
  intensity: ['интенсивность', 'сила', 'pain level', 'severity', 'intensity', 'уровень боли'],
  headache: ['головная боль', 'headache', 'болела', 'приступ', 'attack'],
  meds: ['медикамент', 'препарат', 'таблет', 'medication', 'medicine', 'drug'],
  triggers: ['триггер', 'trigger', 'причин'],
  note: ['коммент', 'note', 'заметк', 'symptom', 'симптом'],
  mens: ['менструац', 'menstru', 'period', 'цикл'],
};

export function detectColumns(header) {
  const map = {};
  header.forEach((raw, i) => {
    const h = NORM(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(FIELD_HINTS)) {
      if (map[field] !== undefined) continue;
      if (hints.some((k) => h.includes(k))) { map[field] = i; return; }
    }
  });
  return map;
}

/**
 * Порядок чисел в датах через косую черту определяем по всему файлу, а не по
 * строке: «8/5/2026» это и 5 августа (США), и 8 мая (Европа). Если хоть где-то
 * первое число больше 12 — значит первым идёт день. Иначе считаем формат
 * американским: так отдаёт Migraine Buddy и большинство англоязычных дневников.
 */
export function detectSlashOrder(samples) {
  for (const s of samples) {
    const m = String(s ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) return 'dmy';
    if (+m[2] > 12) return 'mdy';
  }
  return 'mdy';
}

export function normalizeDate(v, slashOrder = 'mdy') {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);                 // 05.08.2026 — всегда день первым
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [day, month] = slashOrder === 'dmy' ? [m[1], m[2]] : [m[2], m[1]];
    return `${m[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const yesNo = (v) => {
  const s = NORM(v);
  if (['да', 'yes', 'true', '1', 'y'].includes(s)) return 1;
  if (['нет', 'no', 'false', '0', 'n'].includes(s)) return 0;
  return null;
};

/**
 * Строки → записи дневника.
 * @returns {{entries: Array, attacksOnly: boolean, skipped: number, columns: object}}
 */
export function rowsToEntries(rows) {
  if (rows.length < 2) throw new Error('В файле нет данных');
  const columns = detectColumns(rows[0]);
  if (columns.date === undefined) {
    throw new Error('Не нашла столбец с датой — проверь, что в первой строке есть заголовки');
  }

  // порядок чисел в датах определяем один раз по всему файлу
  const slashOrder = detectSlashOrder(rows.slice(1).map((r) => r[columns.date]));

  const out = new Map();
  let skipped = 0, explicitNo = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const at = (f) => (columns[f] === undefined ? null : row[columns[f]]);
    const date = normalizeDate(at('date'), slashOrder);
    if (!date) { skipped++; continue; }

    // Если столбца «болела ли голова» нет, файл — список приступов: каждая
    // строка это приступ, значит в этот день болело.
    let headache = yesNo(at('headache'));
    if (headache === null) headache = 1;
    else if (headache === 0) explicitNo++;

    const intensityRaw = at('intensity');
    const intensity = intensityRaw === null || String(intensityRaw).trim() === ''
      ? null : Number(String(intensityRaw).replace(',', '.').match(/[\d.]+/)?.[0]);
    const meds = at('meds');
    const note = [at('note'), at('triggers')].filter((x) => x && String(x).trim()).join('; ');

    const prev = out.get(date);
    out.set(date, {
      date,
      headache: prev ? Math.max(prev.headache, headache) : headache,
      intensity: Number.isFinite(intensity) ? Math.min(10, Math.max(1, Math.round(intensity))) : (prev?.intensity ?? null),
      mens: yesNo(at('mens')) ?? prev?.mens ?? null,
      med_taken: meds && NORM(meds) !== 'нет' ? 1 : (prev?.med_taken ?? 0),
      med_text: meds ? String(meds).trim() : (prev?.med_text ?? null),
      med_helped: prev?.med_helped ?? null,
      self_triggers: at('triggers') ? String(at('triggers')).trim() : (prev?.self_triggers ?? null),
      note: note || prev?.note || null,
      source: 'csv',
    });
  }

  const entries = [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    entries,
    // список приступов без спокойных дней — об этом надо предупредить
    attacksOnly: explicitNo === 0,
    skipped,
    columns,
    slashOrder,
  };
}

export async function importCsvFile(file) {
  const text = await file.text();
  const rows = parseCsv(text);
  const res = rowsToEntries(rows);
  if (!res.entries.length) throw new Error('Не нашла ни одной строки с датой');
  await entriesStore.putMany(res.entries);
  return {
    imported: res.entries.length,
    headacheDays: res.entries.filter((e) => e.headache === 1).length,
    from: res.entries[0].date,
    to: res.entries[res.entries.length - 1].date,
    attacksOnly: res.attacksOnly,
    skipped: res.skipped,
  };
}
