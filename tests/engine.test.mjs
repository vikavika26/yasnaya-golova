/**
 * Проверка движка на настоящем двухлетнем дневнике.
 *
 * Эталон — независимая реализация того же анализа на Python (папка reference).
 * Если JS и Python расходятся, значит в одном из них ошибка: это и есть смысл
 * держать две реализации.
 */
import { readFileSync, existsSync } from 'node:fs';
import { buildDays, analyze, riskModel } from '../pwa/js/engine.js';

// Фикстуры собраны из личного дневника и в репозиторий не попадают (.gitignore).
// Без них тест не падает, а честно сообщает, что проверить нечего.
const fixture = new URL('./fixtures/entries.json', import.meta.url);
if (!existsSync(fixture)) {
  console.log('  пропуск: нет tests/fixtures/entries.json — соберите фикстуры из своей выгрузки');
  process.exit(0);
}

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf-8'));
const entries = load('entries');
const weather = load('weather');
const weatherMap = new Map(weather.map((w) => [w.date, w]));

let fails = 0;
const ok = (cond, name, extra = '') => {
  console.log((cond ? '  ok  ' : '  FAIL') + '  ' + name + (extra ? `  ${extra}` : ''));
  if (!cond) fails++;
};

const days = buildDays(entries, weatherMap);
ok(days.length >= 688, 'ряд дней собран без дыр', `${days.length} дней`);
ok(days.filter((d) => d.headache !== null).length === 688, 'все записи дневника на месте');
ok(days.every((d, i) => i === 0 || d.date > days[i - 1].date), 'дни идут строго по возрастанию');

const withWeather = days.filter((d) => d.p_mean !== null).length;
ok(withWeather > 680, 'погода подклеилась к дневнику', `${withWeather} дней с погодой`);

const a = analyze(days);
console.log(`\n  база: ${(a.baseRate * 100).toFixed(1)}% дней с болью (${a.headacheDays} из ${a.knownDays}), проверено гипотез: ${a.testedHypotheses}`);

// Эталон — независимый пересчёт на Python по календарной логике (reference/).
// Окно ±2 дня: RR = 1.454 [1.05; 2.01], 113 дней, 34 из них с болью.
const peri = a.factors.find((f) => f.key === 'peri');
ok(Math.abs(peri.rr - 1.454) < 0.005, 'окно цикла: RR совпал с эталоном',
  `RR=${peri.rr.toFixed(3)} [${peri.lo.toFixed(2)}; ${peri.hi.toFixed(2)}]`);
ok(peri.exposedDays === 113 && peri.exposedHeadache === 34, 'окно цикла: те же дни, что в эталоне');
// Само окно поправку на 14 проверок не переживает — и приложение честно это говорит.
ok(peri.verdict === 'not_confirmed', 'широкое окно цикла не выдаётся за подтверждённое',
  `p=${peri.p.toFixed(4)} против порога BH ${peri.bh.threshold.toFixed(4)}`);

// А вот сам день менструации — устойчивый фактор: RR = 1.851 [1.36; 2.53]
const mensDay = a.factors.find((f) => f.key === 'mens_day');
ok(Math.abs(mensDay.rr - 1.851) < 0.005, 'день менструации: RR совпал с эталоном',
  `RR=${mensDay.rr.toFixed(3)} [${mensDay.lo.toFixed(2)}; ${mensDay.hi.toFixed(2)}]`);
ok(mensDay.verdict === 'confirmed', 'день менструации признан подтверждённым фактором');
ok(mensDay.bootstrap && mensDay.bootstrap.lo > 1, 'он выжил и после блочного бутстрапа',
  mensDay.bootstrap ? `CI [${mensDay.bootstrap.lo.toFixed(2)}; ${mensDay.bootstrap.hi.toFixed(2)}]` : '');

// эталон: падение давления не подтверждается
const drop = a.factors.find((f) => f.key === 'p_drop_l0');
// порог теперь в мм рт. ст. (4 мм); эталон Python на тех же данных даёт 0.881
ok(Math.abs(drop.rr - 0.881) < 0.02, 'давление: RR совпал с эталоном', `RR=${drop.rr.toFixed(3)}`);
ok(drop.verdict === 'not_confirmed', 'падение давления честно не подтверждено');

const weatherConfirmed = a.factors.filter((f) => f.group === 'Погода' && f.verdict === 'confirmed');
ok(weatherConfirmed.length === 0, 'ни один погодный фактор не признан подтверждённым',
  `подтверждено погодных: ${weatherConfirmed.length}`);

// абузус: в эталоне ни одного месяца с 10+ днями приёма, максимум 9
ok(a.meds.riskyMonths === 0 && a.meds.maxMedDays === 9, 'счётчик обезболивающих совпал с эталоном',
  `макс ${a.meds.maxMedDays} дн/мес, месяцев с риском: ${a.meds.riskyMonths}`);

// сверка убеждений
const weatherBelief = a.beliefs.find((b) => b.label === 'Погода');
const mensBelief = a.beliefs.find((b) => b.label === 'Менструация');
ok(weatherBelief && weatherBelief.namedTimes === 32, 'погода названа причиной 32 раза',
  `${weatherBelief?.namedTimes}`);
ok(weatherBelief && weatherBelief.status === 'not_supported', 'убеждение про погоду данными не поддержано');
ok(mensBelief && mensBelief.status === 'supported', 'убеждение про цикл данными поддержано',
  `названо ${mensBelief?.namedTimes} раз`);
const notMeasurable = a.beliefs.filter((b) => b.status === 'needs_daily' || b.status === 'not_measurable');
ok(notMeasurable.length > 0, 'признаки без ежедневных отметок помечены как непроверяемые',
  notMeasurable.map((b) => b.label).join(', '));

// профиль лага
ok(a.lagProfiles.p_drop.points.length === 4, 'профиль лага построен по 4 сдвигам');

// прогноз
const risk = riskModel(days, a);
ok(risk && !risk.insufficient, 'модель риска обучилась');
console.log(`\n  бэктест: обучение ${risk.backtest.trainDays} дн., проверка ${risk.backtest.testDays} дн. `
  + `(${risk.backtest.testFrom} → ${risk.backtest.testTo})`);
console.log(`  AUC=${risk.backtest.auc?.toFixed(3)}  skill=${risk.backtest.skill?.toFixed(4)}  `
  + `база на тесте=${(risk.backtest.baseRate * 100).toFixed(1)}%`);
ok(risk.backtest.testDays > 100, 'на проверку отведён честный кусок будущего');
ok(risk.backtest.auc !== null, 'AUC посчитан');
ok(risk.forecast.length > 0, 'прогноз на последние дни считается',
  risk.forecast.map((f) => `${f.date}: ${(f.probability * 100).toFixed(0)}%`).join(', '));

console.log('\n  вердикты по всем гипотезам:');
a.factors.forEach((f) => {
  const rr = f.rr ? `RR=${f.rr.toFixed(2)}` : '—';
  console.log(`    ${f.verdict.padEnd(14)} ${rr.padEnd(10)} ${f.label}`);
});

console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
process.exit(fails ? 1 : 0);
