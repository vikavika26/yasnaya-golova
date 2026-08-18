/**
 * Отчёт для врача — отдельным файлом, который можно распечатать или сохранить
 * как PDF из системного диалога печати.
 *
 * Почему не генерирую PDF сам: без внешних библиотек в PDF нельзя положить
 * кириллицу — во встроенных шрифтах её нет, пришлось бы вшивать TTF на сотни
 * килобайт. Печать из браузера решает ту же задачу и даёт человеку выбор:
 * «сохранить как PDF» или сразу на принтер в поликлинике.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const fix = (v, n = 2) => (v === null || v === undefined ? '—' : v.toFixed(n));

/** Самодостаточная страница: стили внутри, ничего не подгружает. */
export function buildReportHtml({ analysis, risk, year, city }) {
  const m = analysis.meds;
  const confirmed = analysis.factors.filter((f) => f.verdict === 'confirmed');
  const notConfirmed = analysis.factors.filter((f) => f.verdict === 'not_confirmed');
  const perMonth = (analysis.headacheDays / Math.max(1, m.months.length)).toFixed(1);
  const today = new Date().toLocaleDateString('ru-RU');

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Дневник головной боли — сводка</title>
<style>
  @page { margin: 16mm; }
  body { font: 12pt/1.5 Georgia, "Times New Roman", serif; color: #111; max-width: 190mm; margin: 0 auto; padding: 12mm; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 3pt; }
  .sub { color: #555; font-size: 10pt; margin-bottom: 12pt; }
  table { border-collapse: collapse; width: 100%; font-size: 11pt; }
  td, th { border: 1px solid #bbb; padding: 4pt 6pt; text-align: left; }
  th { background: #f0f0f0; }
  .num { text-align: right; white-space: nowrap; }
  .warn { border-left: 3pt solid #a33; padding-left: 8pt; }
  .foot { margin-top: 18pt; font-size: 9.5pt; color: #555; }
  ul { margin: 4pt 0 0 16pt; padding: 0; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head><body>

<h1>Дневник головной боли — сводка</h1>
<div class="sub">Составлено ${esc(today)}${city ? ` · погода по городу: ${esc(city)}` : ''}
  · период наблюдения: ${analysis.knownDays} дней с записями</div>

<h2>Основные показатели</h2>
<table>
  <tr><td>Дней с головной болью</td><td class="num">${analysis.headacheDays} из ${analysis.knownDays} (${pct(analysis.baseRate)})</td></tr>
  <tr><td>В среднем дней с болью в месяц</td><td class="num">${perMonth}</td></tr>
  <tr><td>Максимум дней с приёмом обезболивающего за месяц</td><td class="num">${m.maxMedDays}</td></tr>
  <tr><td>Месяцев с приёмом 10 дней и более</td><td class="num">${m.riskyMonths}</td></tr>
  ${year ? `<tr><td>За последние 12 месяцев</td><td class="num">${year.thisYear.headacheDays} дней с болью,
    ${year.thisYear.medDays} с препаратом</td></tr>` : ''}
</table>
${m.riskyMonths > 0 ? `<p class="warn">Есть месяцы с приёмом обезболивающих 10 дней и чаще —
  требуется оценка риска лекарственно-индуцированной головной боли.</p>` : ''}

<h2>По месяцам</h2>
<table>
  <tr><th>Месяц</th><th class="num">Дней с болью</th><th class="num">Дней с препаратом</th></tr>
  ${m.months.slice(-14).map((x) => `<tr><td>${esc(x.month)}</td>
    <td class="num">${x.headacheDays}</td><td class="num">${x.medDays}</td></tr>`).join('')}
</table>

<h2>Что подтвердилось статистически</h2>
${confirmed.length ? `<table>
  <tr><th>Фактор</th><th class="num">Частота при факторе</th><th class="num">Без фактора</th><th class="num">Отношение рисков</th></tr>
  ${confirmed.map((f) => `<tr><td>${esc(f.label)}</td>
    <td class="num">${pct(f.p1)} (${f.exposedHeadache}/${f.exposedDays})</td>
    <td class="num">${pct(f.p0)}</td>
    <td class="num">${fix(f.rr)} [${fix(f.lo)}; ${fix(f.hi)}]</td></tr>`).join('')}
</table>` : '<p>Ни один из проверенных факторов не подтвердился.</p>'}

${notConfirmed.length ? `<h2>Проверено и не подтвердилось</h2>
<p>${notConfirmed.map((f) => esc(f.label.toLowerCase())).join('; ')}.</p>` : ''}

<h2>Методика</h2>
<ul>
  <li>Единица наблюдения — календарный день; учитываются и дни без боли.</li>
  <li>Список гипотез (${analysis.testedHypotheses}) фиксировался до расчёта.</li>
  <li>Факторы проверялись со сдвигом 0–2 суток.</li>
  <li>Поправка на множественные сравнения: процедура Беньямини — Хохберга, FDR 5%.</li>
  <li>Устойчивость: блочный бутстрап (учёт зависимости соседних дней).</li>
  ${risk?.backtest ? `<li>Прогноз риска проверен на отложенном по времени интервале
    (${risk.backtest.testDays} дней): AUC ${fix(risk.backtest.auc, 3)} при базовой частоте
    ${pct(risk.backtest.baseRate)}.</li>` : ''}
  <li>Данные о погоде — реанализ ERA5 (Open-Meteo), давление приведено к мм рт. ст.</li>
</ul>

<p class="foot">Сводка составлена приложением «Ясная голова» по самонаблюдениям пациента.
Не является диагнозом, медицинским заключением или назначением.</p>

<p class="noprint"><button onclick="window.print()">Печать или сохранить в PDF</button></p>
</body></html>`;
}
