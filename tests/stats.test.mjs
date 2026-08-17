import {riskRatio, benjaminiHochberg, logisticFit, logisticPredict, auc, blockBootstrapRR, mulberry32, skillScore} from '../pwa/js/stats.js';
let fails = 0;
const ok = (cond, name, extra='') => { console.log((cond?'  ok  ':'  FAIL') + '  ' + name + (extra?'  '+extra:'')); if(!cond) fails++; };

// 1. RR против референса на питоне: окно ±2 дня → 30.4% vs 19.2%, RR=1.58 [1.19; 2.10]
const r = riskRatio(56, 184, 97, 504);
ok(Math.abs(r.rr - 1.58) < 0.02, 'RR совпал с референсом', `RR=${r.rr.toFixed(3)} [${r.lo.toFixed(2)}; ${r.hi.toFixed(2)}] p=${r.p.toFixed(5)}`);
ok(Math.abs(r.lo - 1.19) < 0.03 && Math.abs(r.hi - 2.10) < 0.05, 'границы CI совпали');

// 2. BH: из питоновского прогона выживает только первая гипотеза
const bh = benjaminiHochberg([0.0015, 0.0288, 0.0809, 0.2376, 0.9]);
ok(bh[0].survived && !bh[1].survived && !bh[2].survived, 'BH оставил только сильнейшую гипотезу');

// 3. Логистика восстанавливает известные коэффициенты
const rnd = mulberry32(7); const X = [], y = [];
for (let i = 0; i < 3000; i++) {
  const x1 = rnd() < 0.3 ? 1 : 0, x2 = rnd() < 0.5 ? 1 : 0;
  const p = 1 / (1 + Math.exp(-(-1.5 + 1.2 * x1)));
  X.push([1, x1, x2]); y.push(rnd() < p ? 1 : 0);
}
const b = logisticFit(X, y, { l2: 0.01 });
ok(Math.abs(b[0] + 1.5) < 0.2 && Math.abs(b[1] - 1.2) < 0.25 && Math.abs(b[2]) < 0.2,
   'коэффициенты восстановлены', `β=[${b.map(v=>v.toFixed(2)).join(', ')}] ожидали [-1.5, 1.2, 0]`);

// 4. AUC и skill score в разумных пределах
const s = X.map(row => logisticPredict(b, row));
const a = auc(s, y);
ok(a > 0.55 && a < 0.75, 'AUC осмысленный', `AUC=${a.toFixed(3)}`);
ok(skillScore(s, y) > 0, 'модель лучше базовой частоты');

// 5. Блочный бутстрап шире наивного CI (учёт зависимости дней)
const mask = X.map(row => row[1] === 1);
const bb = blockBootstrapRR(y, mask, { iters: 400 });
ok(bb && bb.lo > 1, 'бутстрап подтверждает реальный эффект', `CI [${bb.lo.toFixed(2)}; ${bb.hi.toFixed(2)}]`);

// 6. Воспроизводимость: один сид — один результат
const bb2 = blockBootstrapRR(y, mask, { iters: 400 });
ok(bb.lo === bb2.lo && bb.hi === bb2.hi, 'результат воспроизводим при том же сиде');

console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
process.exit(fails ? 1 : 0);
