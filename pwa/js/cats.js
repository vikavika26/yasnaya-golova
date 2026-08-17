/**
 * Котики. Рисованы прямо в SVG — ни картинок, ни шрифтов, ни сети:
 * приложение остаётся офлайновым и лёгким, а иконки не мылятся на любом экране.
 *
 * Каждый котик — настроение состояния: спокойный день, больная голова,
 * «изучаю данные», «пока не знаю». Используются и в статусах, и в пустых экранах.
 */

const P = {
  fur: '#F6E7DC', furDark: '#E7D3C6', ink: '#5B5163',
  blush: '#F9BBCB', mint: '#A9E3C9', lav: '#C7B8F0',
  peach: '#FFC2A8', sun: '#FFE0A3',
};

/** Общая заготовка: голова, ушки, щёчки. */
function head(extra = '', { fur = P.fur } = {}) {
  return `
    <path d="M30 44 L26 20 L48 33 Z" fill="${fur}" stroke="${P.ink}" stroke-width="2.4"
          stroke-linejoin="round"/>
    <path d="M90 44 L94 20 L72 33 Z" fill="${fur}" stroke="${P.ink}" stroke-width="2.4"
          stroke-linejoin="round"/>
    <path d="M34 24 L31 34 L41 31 Z" fill="${P.blush}" opacity=".7"/>
    <path d="M86 24 L89 34 L79 31 Z" fill="${P.blush}" opacity=".7"/>
    <ellipse cx="60" cy="63" rx="34" ry="30" fill="${fur}" stroke="${P.ink}" stroke-width="2.4"/>
    <ellipse cx="38" cy="70" rx="7" ry="4.5" fill="${P.blush}" opacity=".65"/>
    <ellipse cx="82" cy="70" rx="7" ry="4.5" fill="${P.blush}" opacity=".65"/>
    <path d="M60 66 l-4 3 h8 z" fill="${P.peach}" stroke="${P.ink}" stroke-width="1.6"
          stroke-linejoin="round"/>
    ${extra}`;
}

const svg = (inner, size) => `<svg class="cat" viewBox="0 0 120 120" width="${size}" height="${size}"
  role="img" aria-hidden="true">${inner}</svg>`;

/** Спокойный: глаза-щёлочки, довольная улыбка. */
export function catCalm(size = 64) {
  return svg(head(`
    <path d="M44 57 q5 4 10 0" fill="none" stroke="${P.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M66 57 q5 4 10 0" fill="none" stroke="${P.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M54 73 q6 5 12 0" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M96 58 q8 2 12 -3" fill="none" stroke="${P.mint}" stroke-width="3" stroke-linecap="round"/>
  `), size);
}

/** Болит голова: компресс, зажмуренные глаза, волнистый рот. */
export function catAchy(size = 64) {
  return svg(head(`
    <path d="M42 55 l10 6 M52 55 l-10 6" stroke="${P.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M68 55 l10 6 M78 55 l-10 6" stroke="${P.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M52 75 q4 -4 7 0 q3 4 7 0" fill="none" stroke="${P.ink}" stroke-width="2.2"
          stroke-linecap="round"/>
    <rect x="36" y="36" width="48" height="13" rx="6.5" fill="${P.lav}" stroke="${P.ink}"
          stroke-width="2.2"/>
    <circle cx="48" cy="42" r="1.8" fill="#fff"/><circle cx="60" cy="42" r="1.8" fill="#fff"/>
    <circle cx="72" cy="42" r="1.8" fill="#fff"/>
    <path d="M24 30 q4 -6 8 0 q4 6 8 0" fill="none" stroke="${P.lav}" stroke-width="2.6"
          stroke-linecap="round" opacity=".9"/>
  `), size);
}

/** Изучаю: приподнятая бровь и лупа. */
export function catCurious(size = 64) {
  return svg(head(`
    <circle cx="48" cy="58" r="4.2" fill="${P.ink}"/>
    <circle cx="49.4" cy="56.6" r="1.5" fill="#fff"/>
    <circle cx="72" cy="58" r="4.2" fill="${P.ink}"/>
    <circle cx="73.4" cy="56.6" r="1.5" fill="#fff"/>
    <path d="M42 47 q6 -4 12 -1" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M55 74 q5 3 10 0" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="93" cy="84" r="12" fill="none" stroke="${P.lav}" stroke-width="3.4"/>
    <path d="M101 93 l8 8" stroke="${P.lav}" stroke-width="4" stroke-linecap="round"/>
  `), size);
}

/** Пока не знаю: наклон головы и вопрос. */
export function catUnsure(size = 64) {
  return svg(`<g transform="rotate(-8 60 63)">${head(`
    <circle cx="49" cy="59" r="3.6" fill="${P.ink}"/>
    <circle cx="71" cy="59" r="3.6" fill="${P.ink}"/>
    <path d="M55 74 q5 2 10 -1" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"/>
  `)}</g>
    <text x="98" y="34" font-size="26" font-weight="700" fill="${P.sun}"
          font-family="-apple-system, Segoe UI, Roboto, sans-serif">?</text>`, size);
}

/** Спит — для пустых экранов. */
export function catSleepy(size = 64) {
  return svg(head(`
    <path d="M44 58 q5 4 10 0" fill="none" stroke="${P.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M66 58 q5 4 10 0" fill="none" stroke="${P.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="60" cy="75" rx="4" ry="5" fill="${P.peach}" stroke="${P.ink}" stroke-width="1.8"/>
    <text x="90" y="30" font-size="16" font-weight="700" fill="${P.lav}"
          font-family="-apple-system, Segoe UI, Roboto, sans-serif">z</text>
    <text x="101" y="20" font-size="11" font-weight="700" fill="${P.lav}"
          font-family="-apple-system, Segoe UI, Roboto, sans-serif">z</text>
  `), size);
}

/** Котик по уровню риска — для главного экрана. */
export function catForRisk(prob, base, size = 96) {
  if (prob === null || prob === undefined) return catUnsure(size);
  const rel = base ? prob / base : 1;
  if (rel >= 1.4) return catAchy(size);
  if (rel <= 0.75) return catCalm(size);
  return catCurious(size);
}

/** Котик по статусу проверки — рядом с каждой гипотезой. */
export function catForVerdict(verdict, size = 34) {
  switch (verdict) {
    case 'confirmed': return catAchy(size);
    case 'protective': return catCalm(size);
    case 'not_confirmed': return catCalm(size);
    case 'few_data': return catUnsure(size);
    default: return catSleepy(size);
  }
}
