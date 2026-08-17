/** Проверка: свой распаковщик xlsx читает настоящую выгрузку Мигребота
 *  и даёт ровно те же записи, что pandas в референсной реализации. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { readFirstSheet } from '../pwa/js/xlsx.js';
import { rowsToEntries, parseMeds } from '../pwa/js/import.js';

// Настоящая выгрузка Мигребота — личные медданные, в репозитории её нет.
// Проверки разбора формата, не требующие файла, всё равно выполняются ниже.
// Берём любую выгрузку из private-data — имя файла у Мигребота каждый раз новое.
const dataDir = new URL('../private-data/', import.meta.url);
const found = existsSync(dataDir)
  ? readdirSync(dataDir).filter((f) => /^Migrebot_.*\.xlsx$/i.test(f)).sort()
  : [];
const xlsxPath = found.length ? new URL(found.at(-1), dataDir) : null;
const hasFile = !!xlsxPath && existsSync(new URL('./fixtures/entries.json', import.meta.url));

let fails = 0;
const ok = (c, n, x = '') => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + n + (x ? '  ' + x : '')); if (!c) fails++; };

if (hasFile) {
const buf = readFileSync(xlsxPath);
const rows = await readFirstSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
ok(rows.length === 689, 'лист прочитан целиком', `${rows.length} строк с заголовком`);
ok(String(rows[0][0]).trim() === 'Дата' && String(rows[0][2]).trim() === 'Головная боль',
   'заголовки на месте', rows[0].slice(0, 3).join(' | '));

const { entries, skipped } = rowsToEntries(rows);
ok(entries.length === 688, 'записей столько же, сколько у pandas', `${entries.length}, пропущено ${skipped}`);
ok(entries.filter((e) => e.headache === 1).length === 153, 'дней с болью 153');
ok(entries[0].date === '2024-08-31' && entries.at(-1).date === '2026-08-05', 'период совпал',
   `${entries[0].date} → ${entries.at(-1).date}`);
ok(entries.filter((e) => e.mens === 1).length === 92, 'дней менструации 92');
// 153 дня поле заполнено, но 36 из них — «Нет»: реальных приёмов 117
ok(entries.filter((e) => e.med_taken === 1).length === 117, 'дней с реальным приёмом препаратов 117');

// сверка запись-в-запись с эталонной фикстурой, собранной pandas
const ref = JSON.parse(readFileSync(new URL('./fixtures/entries.json', import.meta.url), 'utf-8'));
const refMap = new Map(ref.map((r) => [r.date, r]));
let diff = 0, firstDiff = null;
entries.forEach((e) => {
  const r = refMap.get(e.date);
  if (!r) { diff++; return; }
  for (const k of ['headache', 'mens', 'med_taken', 'med_helped', 'intensity']) {
    const a = e[k] ?? null, b = r[k] ?? null;
    if (a !== b) { diff++; firstDiff = firstDiff || `${e.date} поле ${k}: ${a} vs ${b}`; break; }
  }
});
ok(diff === 0, 'все записи совпали с эталоном pandas', diff ? `расхождений ${diff}: ${firstDiff}` : '');

} else {
  console.log('  пропуск проверок на реальном файле: выгрузки Мигребота нет в репозитории');
}

ok(parseMeds('Цитрамон 2 таб, Помогло').helped === 'помогло', 'эффект препарата распознан');
ok(parseMeds('Цитрамон 2 таб, Немного помогло\nЦитрамон 2 таб, Помогло').helped === 'немного помогло',
   'при двух приёмах берётся более слабый эффект');
ok(parseMeds('Нет').taken === 0, '«Нет» — это отсутствие приёма');
ok(parseMeds('Цитрамон 2 таб, Помогло').text === 'Цитрамон 2 таб', 'название препарата вычищено',
   parseMeds('Цитрамон 2 таб, Помогло').text);

console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
process.exit(fails ? 1 : 0);
