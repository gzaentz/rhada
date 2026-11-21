// Files and images the writer adds for context. Each becomes one attachment:
//   { name, kind: 'image', data }  an image as a data URL, at most 1568 px a side
//   { name, kind: 'pdf', data }    a PDF as a data URL, read by the model itself
//   { name, kind: 'text', text }   Word, Excel and plain text, read here
// Word and Excel are read on this device. Only their text goes to the model.

export const MAX_FILES = 6;
const PDF_BYTES = 15 * 1024 * 1024;
const TEXT_CHARS = 60_000;
const ROWS = 2000;
// Anthropic's guidance: bigger images cost more and read no better.
const IMAGE_SIDE = 1568;
const IMAGE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const TEXT_TYPES = /\.(txt|csv|tsv|md|json|log|html?|xml|ics|vcf)$/i;

// A failure the writer can act on. Its message is shown as is.
export class FileProblem extends Error {}

export async function readAttachment(file) {
  const name = file.name || (file.type.startsWith('image/') ? 'Pasted image' : 'File');
  const lower = name.toLowerCase();
  if (file.type.startsWith('image/')) return { name, kind: 'image', data: await shrinkImage(file) };
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
    if (file.size > PDF_BYTES) throw new FileProblem(`${name} is over 15 MB. Attach a shorter PDF.`);
    return { name, kind: 'pdf', data: await dataUrl(file, 'application/pdf') };
  }
  if (lower.endsWith('.docx')) return { name, kind: 'text', text: cut(await docxText(await bytes(file))) };
  if (lower.endsWith('.xlsx')) return { name, kind: 'text', text: cut(await xlsxText(await bytes(file))) };
  if (/\.(doc|xls|ppt|pptx|pages|numbers|key)$/.test(lower)) {
    throw new FileProblem(`${name} can't be read. Save it as a PDF, .docx or .xlsx and attach that.`);
  }
  if (file.type.startsWith('text/') || TEXT_TYPES.test(lower)) return { name, kind: 'text', text: cut(await file.text()) };
  throw new FileProblem(`${name} can't be read. Attach an image, PDF, Word, Excel or text file.`);
}

const bytes = async (file) => new Uint8Array(await file.arrayBuffer());

function cut(text) {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) throw new FileProblem('That file has no text to read.');
  return clean.length > TEXT_CHARS ? `${clean.slice(0, TEXT_CHARS)}\n…(cut)` : clean;
}

async function dataUrl(blob, type = blob.type) {
  const all = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < all.length; i += 0x8000) binary += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

// A small image of a type every model reads goes as it is. Anything else is
// drawn again, at most IMAGE_SIDE a side, as a JPEG on white.
async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new FileProblem(`${file.name || 'That image'} can't be read. Attach a PNG, JPEG or screenshot.`);
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, IMAGE_SIDE / Math.max(width, height));
  if (scale === 1 && file.size <= IMAGE_BYTES && IMAGE_TYPES.includes(file.type)) {
    bitmap.close();
    return dataUrl(file);
  }
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const paint = canvas.getContext('2d');
  paint.fillStyle = '#fff';
  paint.fillRect(0, 0, canvas.width, canvas.height);
  paint.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return dataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 }));
}

// ---- Zip, as .docx and .xlsx are --------------------------------------------

// Every file in the archive by name, each read only when asked for.
export function unzip(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new FileProblem('That file is damaged or not a Word or Excel file.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count && view.getUint32(at, true) === 0x02014b50; n++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = data.subarray(start, start + size);
      if (method === 0) return decoder.decode(raw);
      if (method !== 8) throw new FileProblem('That file uses a kind of compression that cannot be read.');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    });
    at += 46 + skip;
  }
  return entries;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code) => {
    if (code[0] !== '#') return ENTITIES[code] ?? all;
    const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return String.fromCodePoint(point);
  });
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

async function part(entries, name) {
  const read = entries.get(name);
  return read ? read() : null;
}

// The body of a Word document: paragraphs as lines, table cells split by tabs.
export async function docxText(data) {
  const xml = await part(unzip(data), 'word/document.xml');
  if (xml === null) throw new FileProblem('That file is not a Word document.');
  let text = '';
  let inText = false;
  let cells = 0; // how deep in table cells
  for (const [, close, tag, , chars] of xml.matchAll(/<(\/?)(w:[a-zA-Z]+)\b([^>]*)>|([^<]+)/g)) {
    if (chars !== undefined) {
      if (inText) text += unescape(chars);
      continue;
    }
    if (tag === 'w:t') inText = !close;
    else if (tag === 'w:tab' && !close) text += '\t';
    else if ((tag === 'w:br' || tag === 'w:cr') && !close) text += cells ? ' ' : '\n';
    else if (tag === 'w:tc') {
      cells += close ? -1 : 1;
      if (close) text = `${text.trimEnd()}\t`;
    } else if (tag === 'w:tr' && close) text = `${text.replace(/\t$/, '')}\n`;
    else if (tag === 'w:p' && close) text += cells ? ' ' : '\n';
  }
  return text;
}

// Each sheet of a workbook, by name, as rows of tab-separated cells. Numbers
// are kept as Excel stores them: a date reads as its day count.
export async function xlsxText(data) {
  const entries = unzip(data);
  const book = await part(entries, 'xl/workbook.xml');
  if (book === null) throw new FileProblem('That file is not an Excel workbook.');
  const rels = (await part(entries, 'xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [attr(tag, 'Id'), attr(tag, 'Target')]));
  const shared = [...((await part(entries, 'xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) =>
    [...si.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map(([, t]) => unescape(t)).join(''),
  );
  const sheets = [];
  for (const [tag] of book.matchAll(/<sheet\b[^>]*>/g)) {
    const target = targets.get(attr(tag, 'r:id')) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = await part(entries, path);
    if (xml === null) continue;
    const rows = [];
    for (const [, row] of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (!row) continue;
      const cells = [];
      for (const [, open, body = ''] of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const column = columnOf(attr(open, 'r')) ?? cells.length;
        const type = attr(open, 't');
        const value = body.match(/<v>([^<]*)<\/v>/)?.[1];
        let text = '';
        if (type === 's') text = shared[Number(value)] ?? '';
        else if (type === 'inlineStr') text = [...body.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map(([, t]) => unescape(t)).join('');
        else if (type === 'b') text = value === '1' ? 'TRUE' : 'FALSE';
        else if (value !== undefined) text = unescape(value);
        cells[column] = text.replace(/[\t\n]+/g, ' ');
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, (cell) => cell ?? '').join('\t').trimEnd());
      if (rows.length === ROWS) {
        rows.push('…(more rows cut)');
        break;
      }
    }
    if (rows.length) sheets.push(`Sheet: ${unescape(attr(tag, 'name') ?? '')}\n${rows.join('\n')}`);
  }
  return sheets.join('\n\n');
}

// "C7" → 2.
function columnOf(ref) {
  const letters = ref?.match(/^[A-Z]+/)?.[0];
  if (!letters) return null;
  return [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}
