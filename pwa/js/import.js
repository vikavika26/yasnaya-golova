/**
 * Импорт выгрузки Мигребота. Один тап по кнопке «Загрузить дневник» → два года
 * истории внутри приложения, и анализ сразу есть на чём считать.
 *
 * Мигребот отдаёт лист «Записи опросов», где строка = день опроса. Поля приступа
 * заполнены только в дни боли, поэтому спокойные дни надо сохранить как нули —
 * без них никакая статистика не работает.
 */
import { readFirstSheet } from './xlsx.js';
import { entries as entriesStore } from './store.js';

const HELP_WORDS = ['не помогло', 'немного помогло', 'помогло'];

const yes = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['да', 'yes', 'true', '1'].includes(s)) return 1;
  if (['нет', 'no', 'false', '0'].includes(s)) return 0;
  return null;
};

function normalizeDate(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {                       // серийная дата Excel
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})/);   // 05.08.2026
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** «Цитрамон 2 таб, Помогло» → сам препарат и самый слабый заявленный эффект. */
export function parseMeds(raw) {
  if (raw === null || raw === undefined) return { taken: 0, text: null, helped: null };
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === 'нет') return { taken: 0, text: null, helped: null };
  const low = s.toLowerCase();
  let helped = null;
  for (const w of HELP_WORDS) {                      // порядок важен: «не помогло» проверяем первым
    if (low.includes(w)) { helped = w; break; }
  }
  const text = s.replace(/\s*,?\s*(не\s+)?(немного\s+)?помогло/gi, '')
    .replace(/[\r\n]+/g, '; ').replace(/\s+/g, ' ').replace(/^[;,\s]+|[;,\s]+$/g, '');
  return { taken: 1, text: text || null, helped };
}

const COLS = {
  'дата': 'date',
  'головная боль': 'headache',
  'менструальный цикл': 'mens',
  'принятые медикаменты': 'meds',
  'интенсивность боли': 'intensity',
  'локализация': 'location',
  'характер': 'pain_char',
  'нагрузки': 'loads',
  'тошнота': 'nausea',
  'фотофобия': 'photophobia',
  'фонофобия': 'phonophobia',
  'триггеры': 'self_triggers',
  'начало боли': 'pain_start',
  'окончание боли': 'pain_end',
  'комментарии': 'comment',
};

/** Строки листа → записи дневника. Вынесено отдельно, чтобы можно было тестировать. */
export function rowsToEntries(rows) {
  if (!rows.length) throw new Error('Файл пустой');
  const header = (rows[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const map = {};
  header.forEach((h, i) => { if (COLS[h]) map[COLS[h]] = i; });
  if (map.date === undefined || map.headache === undefined) {
    throw new Error('Не похоже на выгрузку Мигребота: нет колонок «Дата» и «Головная боль»');
  }

  const out = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const at = (k) => (map[k] === undefined ? null : row[map[k]] ?? null);
    const date = normalizeDate(at('date'));
    const headache = yes(at('headache'));
    if (!date || headache === null) { skipped++; continue; }
    const meds = parseMeds(at('meds'));
    const intensity = at('intensity');
    out.push({
      date,
      headache,
      intensity: intensity === null || intensity === '' ? null : Number(intensity),
      mens: yes(at('mens')),
      med_taken: meds.taken,
      med_text: meds.text,
      med_helped: meds.helped,
      nausea: yes(at('nausea')),
      photophobia: yes(at('photophobia')),
      phonophobia: yes(at('phonophobia')),
      loads: yes(at('loads')),
      location: at('location') ? String(at('location')).trim() : null,
      pain_char: at('pain_char') ? String(at('pain_char')).trim() : null,
      self_triggers: at('self_triggers') ? String(at('self_triggers')).trim() : null,
      pain_start: at('pain_start') ? String(at('pain_start')).trim() : null,
      pain_end: at('pain_end') ? String(at('pain_end')).trim() : null,
      comment: at('comment') ? String(at('comment')).trim() : null,
      source: 'migrebot',
    });
  }
  // одна дата могла попасть дважды — оставляем последнюю запись
  const byDate = new Map(out.map((e) => [e.date, e]));
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { entries, skipped };
}

export async function importMigrebotFile(file) {
  const buf = await file.arrayBuffer();
  const rows = await readFirstSheet(buf);
  const { entries, skipped } = rowsToEntries(rows);
  if (!entries.length) throw new Error('В файле не нашлось ни одной пригодной записи');
  await entriesStore.putMany(entries);
  return {
    imported: entries.length,
    skipped,
    headacheDays: entries.filter((e) => e.headache === 1).length,
    from: entries[0].date,
    to: entries[entries.length - 1].date,
  };
}
