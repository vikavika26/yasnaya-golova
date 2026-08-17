/**
 * Минимальное чтение .xlsx — без внешних библиотек.
 *
 * xlsx это zip с несколькими xml внутри. Распаковка идёт через встроенный в
 * браузер DecompressionStream, разбор — узкими регулярками по конкретным тегам
 * SpreadsheetML. Библиотека на 800 КБ ради одного листа не нужна, а приложение
 * остаётся полностью офлайновым.
 */

const dec = new TextDecoder('utf-8');

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Разбор zip по центральному каталогу — надёжнее, чем идти по локальным заголовкам. */
export async function unzip(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 65558; i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не xlsx: не нашла структуру архива');

  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localOff = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = u16(b, localOff + 26);
    const lExtraLen = u16(b, localOff + 28);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const raw = b.subarray(dataOff, dataOff + compSize);
    files.set(name, { method, raw });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map();
  for (const [name, f] of files) {
    if (!/\.(xml|rels)$/i.test(name)) continue;          // картинки и прочее не нужны
    out.set(name, f.method === 0 ? f.raw : await inflateRaw(f.raw));
  }
  return out;
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // строка может быть разбита на несколько <t> внутри <r> — собираем все
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1]));
    out.push(parts.join(''));
  }
  return out;
}

const colToIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Серийная дата Excel → YYYY-MM-DD (база 1899-12-30, как в Windows-Excel). */
export function serialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Числовые форматы, которые Excel считает датами. */
function dateStyles(stylesXml) {
  if (!stylesXml) return new Set();
  const dateFmtIds = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  for (const m of stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    if (/[dmy]/i.test(m[2]) && !/[h]/i.test(m[2])) dateFmtIds.add(+m[1]);
  }
  const cellXfs = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
  const styles = new Set();
  if (cellXfs) {
    [...cellXfs[0].matchAll(/<xf\b[^>]*\/?>/g)].forEach((xf, i) => {
      const id = xf[0].match(/numFmtId="(\d+)"/);
      if (id && dateFmtIds.has(+id[1])) styles.add(i);
    });
  }
  return styles;
}

/** Первый лист книги → массив массивов значений. */
export async function readFirstSheet(arrayBuffer) {
  const files = await unzip(arrayBuffer);
  const text = (name) => (files.has(name) ? dec.decode(files.get(name)) : null);

  const strings = sharedStrings(text('xl/sharedStrings.xml'));
  const styles = dateStyles(text('xl/styles.xml'));

  const sheetName = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) throw new Error('В файле нет ни одного листа');
  const sheet = text(sheetName);

  const rows = [];
  for (const rowM of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    // Группа атрибутов обязательно нежадная: иначе она забирает слэш из
    // самозакрывающегося <c ... /> и одна пустая ячейка съедает следующие.
    for (const cM of rowM[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cM[1];
      const body = cM[2] || '';
      const ref = attrs.match(/r="([A-Z]+\d+)"/);
      const idx = ref ? colToIndex(ref[1]) : cells.length;
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      const styleId = (attrs.match(/s="(\d+)"/) || [])[1];

      let value = null;
      if (type === 'inlineStr') {
        const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = t ? unescapeXml(t[1]) : null;
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        if (v) {
          const rawV = unescapeXml(v[1]);
          if (type === 's') value = strings[+rawV] ?? null;
          else if (type === 'str') value = rawV;
          else {
            const num = Number(rawV);
            value = Number.isFinite(num)
              ? (styleId !== undefined && styles.has(+styleId) ? serialToDate(num) : num)
              : rawV;
          }
        }
      }
      cells[idx] = value === '' ? null : value;
    }
    rows.push(cells);
  }
  return rows;
}
