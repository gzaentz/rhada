// Runs example emails through Rhada's real prompt and model and checks the
// replies: the template Auto picked, text that must or must not appear, and
// [blanks] left open. Your templates and Facts come from
// extension/templates.local.json, the cases from eval.local.json. Both stay
// out of git; eval.example.json shows the format.
//
//   OPENROUTER_API_KEY=... npm run eval
//   npm run eval -- --runs 3 --model anthropic/claude-sonnet-5.5 --only cancel
//
// Each run is one real request (about $0.0004 on the default model). It stops
// starting new ones once --max-cost dollars (default 0.50) are spent, and
// exits 1 if any check fails.
import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEFAULTS, fromLocalFile } from '../src/settings.js';
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
  },
});

const read = (path) => readFileSync(new URL(path, root), 'utf8');
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) fail('Set OPENROUTER_API_KEY to the key Rhada uses.');
if (!existsSync(new URL(opts.cases, root))) fail(`No ${opts.cases}. Copy eval.example.json to eval.local.json and write your cases.`);
const file = existsSync(new URL(opts.templates, root)) ? read(opts.templates) : '';
const settings = { ...DEFAULTS, model: opts.model, ...(file && fromLocalFile({}, file)) };
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
  if (r.problems.length) console.log(r.text.replace(/^/gm, '      | '));
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
    instruction: c.instruction ?? '',
    templateMode: c.templateMode,
  };
  const now = c.today ? new Date(`${c.today}T12:00:00`) : new Date();
  const messages = buildMessages(settings, context, [], now);
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
  // A markdown link's [text](url) is not a blank.
  const blanks = text.match(/\[[^\]\n]+\](?!\()/g) ?? [];
  if (c.blanks === false && blanks.length) problems.push(`left blanks: ${blanks.join(' ')}`);
  if (/^\s*Template:/im.test(text)) problems.push('the "Template:" line was shown');
  return problems;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
