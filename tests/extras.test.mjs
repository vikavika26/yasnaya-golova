/**
 * Итоги года, импорт чужих дневников, печатный отчёт и первый запуск.
 *
 * Отдельно проверяю самое опасное место импорта: выгрузка списка приступов
 * не должна превращаться в «во все остальные дни не болело» — иначе контрольная
 * группа окажется выдуманной и все выводы поедут.
 */
import { readFileSync, existsSync } from 'node:fs';
import { buildDays, analyze, riskModel, yearSummary } from '../pwa/js/engine.js';
import { parseCsv, detectColumns, normalizeDate, rowsToEntries, detectSlashOrder } from '../pwa/js/csv.js';
import { buildReportHtml } from '../pwa/js/report.js';
import * as ui from '../pwa/js/ui.js';

let fails = 0;
const ok = (c, n, x = '') => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + n + (x ? '  ' + x : '')); if (!c) fails++; };

/* ── Разбор CSV ────────────────────────────────────────────────────── */

ok(parseCsv('a;b;c\n1;2;3').length === 2, 'CSV с точкой с запятой разобран');
ok(parseCsv('a,b\n"раз, два",3')[1][0] === 'раз, два', 'кавычки и запятая внутри поля');
ok(parseCsv('a\tb\n1\t2')[1][1] === '2', 'табуляция тоже понимается');
ok(parseCsv('﻿a,b\n1,2')[0][0] === 'a', 'BOM из Excel не мешает');

ok(normalizeDate('2026-08-05') === '2026-08-05', 'ISO-дата');
ok(normalizeDate('05.08.2026') === '2026-08-05', 'дата с точками');
ok(normalizeDate('8/5/2026') === '2026-08-05', 'по умолчанию формат американский (Migraine Buddy)');
ok(normalizeDate('8/5/2026', 'dmy') === '2026-05-08', 'европейский порядок тоже поддержан');
ok(detectSlashOrder(['3/4/2026', '25/4/2026']) === 'dmy', 'день первым распознан по всему файлу');
ok(detectSlashOrder(['3/4/2026', '4/25/2026']) === 'mdy', 'месяц первым распознан по всему файлу');
ok(detectSlashOrder(['3/4/2026']) === 'mdy', 'при полной двусмысленности берём американский');
ok(normalizeDate('чепуха') === null, 'мусор отбрасывается');

const cols = detectColumns(['Start Time', 'Pain Level', 'Medications', 'Triggers']);
ok(cols.date === 0 && cols.intensity === 1 && cols.meds === 2 && cols.triggers === 3,
   'столбцы Migraine Buddy распознаны', JSON.stringify(cols));

/* ── Список приступов не должен выдумывать спокойные дни ───────────── */

const mb = parseCsv([
  'Start Time,Pain Level,Medications,Triggers',
  '8/1/2026,7,Ибупрофен,Погода',
  '8/4/2026,5,,Стресс',
].join('\n'));
const res = rowsToEntries(mb);
ok(res.entries.length === 2, 'перенеслись только строки из файла', `${res.entries.length}`);
ok(res.entries.every((e) => e.headache === 1), 'каждая строка — день с болью');
ok(res.attacksOnly === true, 'файл опознан как список приступов');
ok(!res.entries.some((e) => e.headache === 0), 'спокойные дни НЕ выдуманы');
ok(res.entries[0].intensity === 7, 'сила боли прочитана');

const withCalm = rowsToEntries(parseCsv([
  'Дата;Головная боль;Интенсивность',
  '01.08.2026;Да;6',
  '02.08.2026;Нет;',
].join('\n')));
ok(withCalm.attacksOnly === false, 'дневник со спокойными днями опознан правильно');
ok(withCalm.entries[1].headache === 0, 'день без боли сохранён как таковой');

/* ── Дальше — на настоящих данных, если они есть ───────────────────── */

const fx = new URL('./fixtures/entries.json', import.meta.url);
if (!existsSync(fx)) {
  console.log('  пропуск проверок на реальных данных: нет фикстур');
  console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
  process.exit(fails ? 1 : 0);
}

const entries = JSON.parse(readFileSync(fx, 'utf-8'));
const weather = JSON.parse(readFileSync(new URL('./fixtures/weather.json', import.meta.url), 'utf-8'));
const days = buildDays(entries, new Map(weather.map((w) => [w.date, w])));
const analysis = analyze(days);
const risk = riskModel(days, analysis);
const year = yearSummary(days);

ok(year !== null, 'итоги года посчитались');
ok(year.thisYear.headacheDays > 0 && year.thisYear.headacheDays < 200,
   'дней с болью за год правдоподобно', `${year.thisYear.headacheDays}`);
ok(year.prevYear !== null, 'есть с чем сравнить — второй год данных тоже разобран');
ok(year.thisYear.longestCalm > 0, 'самая долгая передышка посчитана',
   `${year.thisYear.longestCalm} дней`);
ok(year.thisYear.worstMonth !== null, 'самый тяжёлый месяц найден',
   year.thisYear.worstMonth?.month);

const yearHtml = ui.renderYear(year);
ok(yearHtml.includes('Итоги года'), 'карточка итогов рисуется');
ok(!yearHtml.includes('undefined') && !yearHtml.includes('NaN'), 'в итогах нет мусора');
ok(ui.renderYear(null) === '', 'без данных карточка не показывается');

const doctor = ui.renderDoctor({ analysis, risk, year });
ok(doctor.includes('Итоги года'), 'итоги встали первыми на экране «Врачу»');
ok(doctor.includes('btn-print-report'), 'кнопка печатного отчёта есть');

/* ── Печатный отчёт ────────────────────────────────────────────────── */

const html = buildReportHtml({ analysis, risk, year, city: 'Санкт-Петербург' });
ok(html.startsWith('<!DOCTYPE html>'), 'отчёт — самостоятельная страница');
ok(html.includes('@media print'), 'есть стили для печати');
ok(!html.includes('http://') && !html.includes('https://'), 'ничего не подгружает извне');
ok(html.includes('Беньямини'), 'методика для врача описана точно, без упрощений');
ok(html.includes('Не является диагнозом'), 'дисклеймер на месте');
ok(!html.includes('undefined') && !html.includes('NaN'), 'в отчёте нет мусора');

/* ── Первый запуск ─────────────────────────────────────────────────── */

for (let step = 0; step < 3; step++) {
  const scr = ui.renderOnboarding(step, { city: 'Санкт-Петербург' });
  ok(scr.includes('<svg class="cat"'), `онбординг, экран ${step + 1}: котик на месте`);
  ok(!scr.includes('undefined'), `онбординг, экран ${step + 1}: без мусора`);
}
ok(ui.renderOnboarding(1, {}).includes('onb-city'), 'на втором экране спрашивается город');
ok(ui.renderOnboarding(2, {}).includes('спокойные дни'), 'на третьем объясняется главное');

/* ── Импорт CSV в дневнике ─────────────────────────────────────────── */

const diary = ui.renderDiary({ days, stats: { entries: 688, headacheDays: 153, from: '2024-08-31', to: '2026-08-05', weatherDays: 700 } });
ok(diary.includes('file-csv'), 'в дневнике есть перенос из другого приложения');

console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
process.exit(fails ? 1 : 0);
