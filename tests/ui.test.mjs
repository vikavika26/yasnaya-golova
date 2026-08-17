/**
 * Smoke-тест отрисовки. Экран я глазами не вижу, поэтому проверяю то, что
 * проверяемо: шаблоны собираются без ошибок, статусы подписаны человеческими
 * словами, а не техническими, котики на месте и в разметку не попал «undefined».
 */
import { readFileSync, existsSync } from 'node:fs';
import { buildDays, analyze, riskModel } from '../pwa/js/engine.js';
import * as ui from '../pwa/js/ui.js';

let fails = 0;
const ok = (c, n, x = '') => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + n + (x ? '  ' + x : '')); if (!c) fails++; };

const fx = new URL('./fixtures/entries.json', import.meta.url);
if (!existsSync(fx)) { console.log('  пропуск: нет фикстур'); process.exit(0); }
const entries = JSON.parse(readFileSync(fx, 'utf-8'));
const weather = JSON.parse(readFileSync(new URL('./fixtures/weather.json', import.meta.url), 'utf-8'));
const days = buildDays(entries, new Map(weather.map((w) => [w.date, w])));
const analysis = analyze(days);
const risk = riskModel(days, analysis);
const stats = { entries: entries.length, headacheDays: 153, from: entries[0].date, to: entries.at(-1).date, weatherDays: weather.length };

const screens = {
  'Сегодня': ui.renderToday({ today: days.at(-1).date, risk, analysis, entry: null, weather: days.at(-1) }),
  'Триггеры': ui.renderTriggers(analysis),
  'Дневник': ui.renderDiary({ days, stats }),
  'Врачу': ui.renderDoctor({ analysis, risk }),
  'Настройки': ui.renderSettings({ city: 'Санкт-Петербург', lat: 59.9, lon: 30.3 }, stats),
};

for (const [name, html] of Object.entries(screens)) {
  ok(typeof html === 'string' && html.length > 400, `${name}: экран собрался`, `${html.length} символов`);
  ok(!html.includes('undefined'), `${name}: без «undefined» в разметке`);
  ok(!html.includes('NaN'), `${name}: без «NaN» в разметке`);
  const open = (html.match(/<div/g) || []).length, close = (html.match(/<\/div>/g) || []).length;
  ok(open === close, `${name}: теги div сбалансированы`, `${open} открыто, ${close} закрыто`);
  ok(html.includes('<svg class="cat"'), `${name}: котик на месте`);
}

// Статусы должны быть человеческими, а не техническими
const trig = screens['Триггеры'];
ok(trig.includes('похоже, влияет'), 'статус «похоже, влияет» вместо «подтверждён»');
ok(trig.includes('не больше случайной'), 'неподтверждённое объяснено по-человечески');
ok(!trig.includes('подтверждён<'), 'старого технического статуса нет');
ok(!/множественн|бутстрап|Беньямини|доверительн/i.test(trig), 'жаргона в интерфейсе нет');
ok(trig.includes('Как я это проверяю'), 'блок с объяснением метода есть');
ok(trig.includes('подозреваемых'), 'объяснение написано словами');
ok(trig.includes('<details'), 'подробности спрятаны в раскрывающийся блок');
ok(!/пока не умею проверять/.test(trig), 'непроверяемое не мусорит список статусов');
ok(!/нечего считать/.test(trig), 'пустые гипотезы вообще не показываются');
ok(!/гПа/.test(trig), 'гектопаскалей в интерфейсе нет');
ok(/мм|мм рт/.test(screens['Сегодня']), 'давление в мм рт. ст.');
ok(screens['Дневник'].includes('day pain') && screens['Дневник'].includes('day calm'),
   'дни с болью и без различаются классами');
ok(screens['Врачу'].includes('legend'), 'у графика месяцев есть легенда');
ok(trig.includes('Проверила и не подтвердилось'), 'неподтверждённое свёрнуто в одну строку');
const notConfirmedRows = (trig.match(/tag not_confirmed/g) || []).length;
ok(notConfirmedRows === 0, 'отдельных строк «просто совпадение» больше нет', `их ${notConfirmedRows}`);
const st = screens['Настройки'];
ok(st.includes('щажу глаза'), 'есть щадящий режим для светобоязни');
ok(st.includes('data-theme-opt="dark"'), 'есть выбор тёмной темы');

// Напоминания обещаем только там, где они действительно работают:
// в APK через нативный плагин, в браузере — нет.
ok(!st.includes('Напоминать отметить день'), 'без плагина напоминания не обещаются');
const withPlugin = ui.renderSettings({ city: 'Санкт-Петербург', lat: 59.9, lon: 30.3 }, stats, true);
ok(withPlugin.includes('Напоминать отметить день'), 'с плагином настройка появляется');
ok(withPlugin.includes('type="time"'), 'время напоминания выбирается');

// Источник погоды должен быть виден
ok(screens['Сегодня'].includes('Open-Meteo'), 'на экране «Сегодня» указан источник погоды');
ok(screens['Настройки'].includes('ERA5'), 'в настройках расшифрован архив погоды');

// Ничего не должно ломаться на пустых данных
ok(ui.renderTriggers(null).includes('Пока нечего показать'), 'пустой экран триггеров дружелюбный');
ok(ui.renderDoctor({ analysis: null }).includes('не из чего'), 'пустой экран врача дружелюбный');

console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
process.exit(fails ? 1 : 0);
