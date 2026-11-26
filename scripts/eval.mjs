// Runs example emails through Rhada's real prompt and model and checks the
// replies: the template Auto picked, text that must or must not appear, and
// [blanks] left open. Your templates and Facts come from
// extension/templates.local.json, the cases from eval.local.json. Both stay
// out of git; eval.example.json shows the format.
//
//   npm run eval
//   npm run eval -- --runs 3 --model anthropic/claude-sonnet-5.5 --only cancel
//   npm run eval -- --mine --show   (your own edits and lessons; print every reply)
//
// Each run is one real request (about $0.0004 on the default model). It stops
// starting new ones once --max-cost dollars (default 0.50) are spent, and
// exits 1 if any check fails.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULTS, EDITS_SENT, fromLocalFile } from '../src/settings.js';
import { autoTemplates, buildMessages, inputsNeeded, templateLine } from '../src/prompt.js';
import { costOf, editRequest, endpointsFor, isAllowed, keepNothing, streamChat, zdrList } from '../src/openrouter.js';

const root = new URL('..', import.meta.url);
const { values: opts } = parseArgs({
  options: {
    cases: { type: 'string', default: 'eval.local.json' },
    templates: { type: 'string', default: 'extension/templates.local.json' },
    model: { type: 'string', default: process.env.RHADA_MODEL || DEFAULTS.model },
    runs: { type: 'string', default: '1' },
    only: { type: 'string' },
    'max-cost': { type: 'string', default: '0.50' },
    // Also send your own last 5 edits and lessons, read from Chrome, as the extension does.
    mine: { type: 'boolean', default: false },
    // Print every reply, not only failed ones.
    show: { type: 'boolean', default: false },
  },
});

const read = (path) => readFileSync(new URL(path, root), 'utf8');
const apiKey = process.env.OPENROUTER_API_KEY || chromeKey();
if (!apiKey) fail('No key found. Save one in Rhada\'s Options in Chrome, or set OPENROUTER_API_KEY.');
if (!existsSync(new URL(opts.cases, root))) fail(`No ${opts.cases}. Copy eval.example.json to eval.local.json and write your cases.`);
const file = existsSync(new URL(opts.templates, root)) ? read(opts.templates) : '';
const stored = opts.mine ? chromeStorage() : {};
const settings = { ...DEFAULTS, model: opts.model, ...(file && fromLocalFile({}, file)), ...(stored.lessons && { lessons: stored.lessons }) };
const myEdits = (stored.edits ?? []).slice(-EDITS_SENT);
if (opts.mine) console.log(`Using ${myEdits.length} of your edits${stored.lessons ? ' and your lessons' : ''}.`);
const cases = JSON.parse(read(opts.cases)).filter((c) => !opts.only || c.name.includes(opts.only));
const runs = Math.max(1, Number(opts.runs) || 1);
const cap = Number(opts['max-cost']);

const endpoints = endpointsFor(await zdrList(), settings.model);
const only = keepNothing(endpoints);
if (!only.length) fail(`No zero-retention endpoint runs "${settings.model}".`);

let spent = 0;
const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1 })));
const results = [];
for (let i = 0; i < jobs.length; i += 4) {
  if (spent >= cap) {
    console.log(`Stopped: $${spent.toFixed(4)} spent, the --max-cost cap. ${jobs.length - i} runs left out.`);
    break;
  }
  results.push(...(await Promise.all(jobs.slice(i, i + 4).map(run))));
}

for (const r of results) {
  console.log(`${r.problems.length ? 'FAIL' : 'pass'}  ${r.name}${runs > 1 ? ` #${r.run}` : ''}  template: ${r.used || 'none'}`);
  for (const p of r.problems) console.log(`      - ${p}`);
  if (r.problems.length || opts.show) console.log(r.text.replace(/^/gm, '      | '));
}
const failed = results.filter((r) => r.problems.length).length;
console.log(`\n${results.length - failed}/${results.length} passed on ${settings.model}, $${spent.toFixed(4)}`);
process.exit(failed || results.length < jobs.length ? 1 : 0);

// One case, one real request, the way the extension makes it.
async function run({ c, run }) {
  const context = {
    thread: (c.thread ?? []).map((m) => ({ date: '', ...m })),
    to: c.to ?? [],
    subject: c.subject ?? '',
    draft: c.draft ?? '',
    // A box on another site: its page, and the text read around the box.
    page: c.page ?? null,
    onPage: c.onPage ?? '',
    instruction: c.instruction ?? '',
    templateMode: c.templateMode,
    // Files added in the panel, as the text Rhada reads from them.
    attachments: (c.attachments ?? []).map((a) => ({ kind: 'text', ...a })),
  };
  const now = c.today ? new Date(`${c.today}T12:00:00`) : new Date();
  // A case can carry past edits and the lessons drawn from them, as Learn from my edits keeps them.
  const messages = buildMessages({ ...settings, ...c.settings, lessons: c.lessons ?? settings.lessons }, context, c.pastEdits ?? myEdits, now);
  const line = templateLine(autoTemplates(settings, context).map((t) => t.name));
  let text = '';
  const problems = [];
  try {
    const { finish, usage } = await streamChat({
      apiKey,
      signal: AbortSignal.timeout(120_000),
      body: editRequest({ model: settings.model, messages, only, needed: inputsNeeded(messages) }),
      onText: (piece) => (text += line.push(piece)),
      onWait() {},
      onProvider(name) {
        if (!isAllowed(name, endpoints, only)) throw new Error(`answered by ${name}, not a zero-retention endpoint`);
      },
    });
    text += line.flush();
    spent += costOf(usage) ?? 0;
    if (finish !== 'stop') problems.push(`stopped early (${finish})`);
  } catch (err) {
    problems.push(`request failed: ${err.message}`);
  }
  problems.push(...check(c, line.used, text));
  return { name: c.name, run, used: line.used, text: text.trim(), problems };
}

function check(c, used, text) {
  const problems = [];
  const lower = text.toLowerCase();
  if (c.template !== undefined && used !== (c.template === 'none' ? '' : c.template)) {
    problems.push(`picked "${used || 'none'}", expected "${c.template}"`);
  }
  for (const s of c.has ?? []) if (!lower.includes(s.toLowerCase())) problems.push(`missing "${s}"`);
  for (const s of c.lacks ?? []) if (lower.includes(s.toLowerCase())) problems.push(`has "${s}"`);
  // A question in the latest message is answered in the first paragraph.
  const paragraphs = lower.trim().split(/\n\s*\n/);
  const opening = /^(hi|hey|hello|dear)\b[^\n.!?]{0,40},?$/.test(paragraphs[0]) ? paragraphs[1] ?? '' : paragraphs[0];
  for (const s of c.opens ?? []) if (!opening.includes(s.toLowerCase())) problems.push(`first paragraph lacks "${s}"`);
  // A markdown link's [text](url) is not a blank.
  const blanks = text.match(/\[[^\]\n]+\](?!\()/g) ?? [];
  if (c.blanks === false && blanks.length) problems.push(`left blanks: ${blanks.join(' ')}`);
  if (/^\s*Template:/im.test(text)) problems.push('the "Template:" line was shown');
  // Nothing goes with the email unless the case asks for it.
  const asked = (c.has ?? []).some((h) => /attach/i.test(h));
  if (!asked && /\b(attached|attaching|enclosed)\b/i.test(text)) problems.push('says something is attached');
  return problems;
}

// The key saved in Rhada's Options, read from Chrome's storage for this
// unpacked copy. Its ID comes from the extension folder's path. Never printed.
function chromeKey() {
  return storageFiles().flatMap((text) => text.match(/sk-or-v1-[0-9a-f]{64}/g) ?? []).at(-1) ?? '';
}

// The newest saved edits and lessons. Each write appends to the storage log,
// so the last value that reads whole is the current one.
function chromeStorage() {
  const text = storageFiles().join('');
  const edits = lastJson(text, '[{"after"', (v) => Array.isArray(v));
  // The lessons key is followed by its value, a JSON string of "- " lines.
  let lessons = '';
  for (let at = text.lastIndexOf('lessons'); at >= 0 && !lessons; at = text.lastIndexOf('lessons', at - 1)) {
    const quote = text.indexOf('"', at);
    const value = quote >= 0 && quote - at < 12 ? readJson(text, quote) : undefined;
    if (typeof value === 'string' && value.startsWith('- ')) lessons = value;
  }
  return { edits, lessons };
}

// The last value starting with `start` that parses as JSON and passes `ok`.
function lastJson(text, start, ok) {
  for (let i = text.lastIndexOf(start); i >= 0; i = text.lastIndexOf(start, i - 1)) {
    const value = readJson(text, i);
    if (value !== undefined && ok(value)) return value;
  }
  return undefined;
}

function readJson(text, from) {
  let depth = 0;
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '\\') i++;
      else if (ch === '"') {
        quoted = false;
        if (depth === 0) return parse(text.slice(from, i + 1));
      }
    } else if (ch === '"') quoted = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return parse(text.slice(from, i + 1));
    }
  }
  return undefined;
}

function parse(json) {
  try {
    return JSON.parse(Buffer.from(json, 'latin1').toString('utf8'));
  } catch {
    return undefined;
  }
}

function storageFiles() {
  const hash = createHash('sha256').update(fileURLToPath(new URL('extension', root))).digest('hex').slice(0, 32);
  const id = [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const home = homedir();
  const chrome = [
    join(home, 'Library/Application Support/Google/Chrome'),
    join(home, '.config/google-chrome'),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/User Data'),
  ].find((dir) => existsSync(dir));
  if (!chrome) return [];
  return readdirSync(chrome).flatMap((profile) => {
    const dir = join(chrome, profile, 'Local Extension Settings', id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /\.(log|ldb)$/.test(f))
      .map((f) => readFileSync(join(dir, f), 'latin1'));
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
