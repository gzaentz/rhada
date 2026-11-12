import { BODY, SEND, bodyOf, expandThread, isForward, readContext, readDraft, readOpenThread, replaceDraft, threadKey } from './gmail.js';
import { textToHtml, textToNodes } from './format.js';
import { BLANK } from './edits.js';
import { createDictation } from './dictation.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Black and white. The one bright thing is the next action.
const CSS = `
:host { all: initial; position: fixed; top: 12vh; left: 50%; transform: translateX(-50%);
  z-index: 2147483647; width: min(620px, calc(100vw - 32px)); }
.card { --fg: #ececec; --bright: #fff; --muted: #8c8c8c; --line: #1e1e1e; --line-2: #333; --danger: #f28b82;
  position: relative; display: flex; flex-direction: column; max-height: 76vh; overflow: hidden;
  color-scheme: dark; color: var(--fg); background: #0a0a0a; border: 1px solid #262626; border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, .34), 0 4px 14px rgba(0, 0, 0, .18);
  font: 14px/21px ${FONT}; -webkit-font-smoothing: antialiased; animation: rise .16s ease-out; }
/* While the model works, a thin light runs along the top edge. */
.card::before { content: ''; position: absolute; inset: 0 0 auto; height: 1px; pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .12) 35%, #fff 50%, rgba(255, 255, 255, .12) 65%, transparent) 150% 0 / 200% 100%; }
.card.loading::before { opacity: 1; animation: glint 1.4s linear infinite; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@keyframes glint { to { background-position: -50% 0; } }
@keyframes breathe { 50% { box-shadow: 0 0 0 4px rgba(255, 255, 255, .14); } }
@media (prefers-reduced-motion: reduce) {
  .card, .card.loading::before, .icon.listening { animation: none; }
  .out, button { transition: none; }
}
.top { display: flex; align-items: flex-start; gap: 4px; padding: 13px 10px 12px 16px; }
.mark { flex: none; margin: 4px 10px 0 0; color: var(--bright); }
slot { display: block; flex: 1; min-width: 0; padding-top: 1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 14px 42px; }
.notice { padding: 11px 18px 12px; border-top: 1px solid var(--line); color: var(--muted); }
.notice.error { color: var(--danger); }
.out { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 18px 18px;
  border-top: 1px solid var(--line); overflow-wrap: anywhere; transition: opacity .15s;
  scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }
.out:empty { display: none; }
.out.stale { opacity: .35; }
.out a { color: var(--bright); text-underline-offset: 2px; text-decoration-color: rgba(255, 255, 255, .4); }
.out b { color: var(--bright); font-weight: 600; }
.out mark { color: var(--bright); background: rgba(255, 255, 255, .14); border-radius: 3px; padding: 0 2px; }
.out ul, .out ol { margin: 0; padding-left: 22px; }
::selection { background: rgba(255, 255, 255, .25); }
.note { padding: 0 18px 12px; color: var(--muted); font-size: 12px; line-height: 17px; }
.foot { box-sizing: border-box; display: flex; align-items: center; gap: 6px; min-height: 52px;
  padding: 9px 10px 9px 18px; border-top: 1px solid var(--line); }
.hint { flex: 1; color: var(--muted); font-size: 12px; line-height: 18px; }
.meta { margin-right: 6px; color: var(--muted); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
kbd { margin-right: 1px; padding: 1px 5px; border: 1px solid var(--line-2); border-radius: 4px;
  background: rgba(255, 255, 255, .04); color: var(--fg); font: 500 11px/16px ${FONT}; }
button { all: unset; box-sizing: border-box; cursor: pointer; border-radius: 7px; padding: 5px 12px;
  color: var(--muted); font: 500 13px/20px ${FONT}; transition: color .12s, background .12s, border-color .12s; }
button:hover { color: var(--bright); background: rgba(255, 255, 255, .07); }
button:focus-visible { outline: 2px solid var(--bright); outline-offset: 2px; }
button.primary { color: #0a0a0a; background: var(--bright); }
button.primary:hover { color: #0a0a0a; background: #dcdcdc; }
button:disabled { opacity: .35; cursor: default; pointer-events: none; }
button.icon { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; }
button.icon.listening { color: #0a0a0a; background: var(--bright); animation: breathe 1.6s ease-in-out infinite; }
button.chip { padding: 3px 11px; border: 1px solid var(--line-2); border-radius: 999px; color: var(--fg);
  font-size: 12.5px; line-height: 18px; }
button.chip:hover { border-color: #5c5c5c; background: rgba(255, 255, 255, .04); }
[hidden] { display: none !important; }
`;

// Ready on Reply's note at the bottom of the screen.
const PILL_CSS = `
:host { all: initial; position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483646; }
button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 9px; padding: 7px 9px 7px 14px;
  border-radius: 999px; cursor: pointer; color: #ececec; background: #0a0a0a; border: 1px solid #262626;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .28); font: 500 13px/20px ${FONT}; -webkit-font-smoothing: antialiased;
  animation: rise .18s ease-out; transition: background .12s; }
button:not(.ready) { padding-right: 14px; }
button:hover { background: #1a1a1a; }
button:focus-visible { outline: 2px solid #0a0a0a; outline-offset: 2px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: pulse 1.1s ease-in-out infinite alternate; }
.ready .dot { animation: none; }
kbd { padding: 1px 6px; border: 1px solid #333; border-radius: 999px; color: #ececec; background: rgba(255, 255, 255, .06);
  font: 500 11px/16px ${FONT}; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@keyframes pulse { to { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { button, .dot { animation: none; } }
`;

// The instruction box stays in the page's own DOM, slotted into the panel, so
// Gmail's keyboard shortcuts see a real <textarea> and leave typing alone.
// Its placeholder is coloured in extension/content.css.
const INPUT_STYLE = `all: initial; display: block; box-sizing: border-box; width: 100%;
  field-sizing: content; min-height: 22px; max-height: 120px; overflow-y: auto; resize: none;
  font: 15px/22px ${FONT}; color: var(--fg); caret-color: #fff; background: transparent;
  cursor: text; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-font-smoothing: antialiased;`;

// One tap for the replies most email needs. Each is an instruction like a typed one.
const QUICK = [
  ['Yes', 'Reply yes to what they ask.'],
  ['Decline politely', 'Decline politely.'],
  ['Ask a question', 'Reply with one short question about what they need.'],
  ['Propose times', 'Propose two or three times to talk, each as [day and time] for me to fill in.'],
];

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// A 16-unit line drawing in the current text colour.
function icon(d) {
  const make = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const svg = make('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
  svg.append(make('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
// One turn of a Greek key.
const MEANDER = 'M1.5 14.5v-13h13v10h-9v-6h5v3';
const SLIDERS = 'M2 5h6m4 0h2M2 11h2m4 0h6M12 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z';
const CROSS = 'M4 4l8 8m0-8l-8 8';
const MIC = 'M6 4a2 2 0 0 1 4 0v3.5a2 2 0 0 1-4 0zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5';

// A [what is needed] the model left for the writer to fill in, not a [link](url).
const BLANKS = new RegExp(`(${BLANK.source})`, 'g');

// "4.2 s · 1.3¢": how long the model took and what OpenRouter charged.
function describeMeta(meta) {
  if (!meta) return '';
  const parts = [];
  if (Number.isFinite(meta.ms)) parts.push(`${(meta.ms / 1000).toFixed(1)} s`);
  if (Number.isFinite(meta.cost)) {
    const cents = meta.cost * 100;
    parts.push(meta.cost === 0 ? 'free' : cents >= 100 ? `$${meta.cost.toFixed(2)}` : `${cents.toFixed(cents < 1 ? 2 : 1)}¢`);
  }
  return parts.join(' · ');
}

// Messages to the worker. One sent from a copy left behind by an extension
// reload has nowhere to go; the next request says so.
function tell(msg) {
  try {
    chrome.runtime.sendMessage(msg)?.catch?.(() => {});
  } catch {
    // Reloaded under this tab.
  }
}

// A question for the worker. No answer, as after a reload, counts as no.
async function ask(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    return null;
  }
}

// One request to the model, streamed through the worker. The panel and Ready
// on Reply both start them; whoever shows one sets job.watch. `build` gives the
// request, and may first expand the thread.
function startJob(build) {
  const job = { status: 'loading', text: '', result: '', meta: null, problem: null, shortcut: '', port: null, watcher: null };
  const emit = (type) => job.watcher?.(type);
  const end = (status, problem = null) => {
    if (job.status !== 'loading') return;
    job.status = status; // done | error | off | cancelled
    job.problem = problem;
    const port = job.port;
    job.port = null;
    port?.disconnect();
    emit(status);
  };
  job.cancel = () => end('cancelled');
  job.watch = (watcher) => {
    job.watcher = watcher;
  };
  Promise.resolve()
    .then(build)
    .then(
      (request) => {
        if (job.status !== 'loading') return;
        let port;
        try {
          port = chrome.runtime.connect({ name: 'edit' });
        } catch {
          end('error', { message: 'The extension was updated. Refresh this Gmail tab.' });
          return;
        }
        job.port = port;
        port.onMessage.addListener((msg) => {
          if (job.port !== port) return;
          if (msg.type === 'start') {
            job.shortcut = msg.shortcut || '';
            emit('start');
          } else if (msg.type === 'delta') {
            job.text += msg.text;
            emit('delta');
          } else if (msg.type === 'off') {
            end('off');
          } else if (msg.type === 'error') {
            end('error', { message: msg.message, code: msg.code });
          } else if (msg.type === 'done') {
            if (!msg.text) {
              end('error', { message: 'Nothing came back. Try again.' });
              return;
            }
            job.result = msg.text;
            job.meta = msg.meta ?? null;
            end('done');
          }
        });
        port.onDisconnect.addListener(() => {
          if (job.port !== port) return;
          job.port = null;
          // Chrome stopping the worker is worth a retry; a reloaded extension is not.
          end('error', {
            message: chrome.runtime?.id ? 'Lost contact with Rhada. Try again.' : 'The extension was updated. Refresh this Gmail tab.',
          });
        });
        port.postMessage(request);
      },
      (err) => end('error', { message: String(err?.message || err) }),
    );
  return job;
}

let panel = null;

// What the panel last wrote into each draft. Opening it again on that text
// carries on the same conversation instead of polishing its own work, and
// sending it teaches the model how the writer changed it.
const written = new WeakMap();

// The latest reply suggested for a thread: { threadId, turns }. Opening the
// panel on an empty reply to that thread picks it up instead of asking again.
let suggested = null;

let lastBody = null;

// ---- Ready on Reply ---------------------------------------------------------
// A reply box that opens empty on a thread starts its suggestion at once, so
// the panel opens with it written. The worker checks the setting: until it
// says `start`, nothing shows. Typing a reply of your own stops it.

let prefetch = null; // { body, threadId, job }, plus the panel's turns when it handed one over
let panelsOpened = 0;
const tried = new WeakSet();

const pill = (() => {
  let host = null;
  let timer = 0;
  function hide() {
    host?.remove();
    host = null;
    clearInterval(timer);
  }
  function show(ready, shortcut) {
    if (panel) return;
    if (!host) {
      host = el('div');
      host.dataset.rhadaPill = '';
      const button = el('button', { type: 'button' });
      // Clicking keeps the cursor in the reply, so the panel opens on it.
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => panel || openPanel(prefetch?.body.isConnected ? prefetch.body : undefined));
      const status = el('div');
      status.setAttribute('role', 'status');
      status.append(button);
      host.attachShadow({ mode: 'open' }).append(el('style', { textContent: PILL_CSS }), status);
      document.documentElement.append(host);
      // A reply that was sent, discarded or left behind takes its note with it.
      timer = setInterval(() => prefetch?.body.isConnected || dropPrefetch(), 1000);
    }
    const button = host.shadowRoot.querySelector('button');
    button.classList.toggle('ready', ready);
    button.replaceChildren(el('span', { className: 'dot' }), ready ? 'Reply ready' : 'Writing a reply…');
    if (ready && shortcut) button.append(el('kbd', { textContent: shortcut }));
    button.title = ready ? 'Open Rhada' : '';
  }
  return { show, hide };
})();

function dropPrefetch() {
  prefetch?.job.cancel();
  prefetch = null;
  pill.hide();
}

async function readyOnReply(body) {
  if (panel || tried.has(body) || !body.isConnected || prefetch?.body === body) return;
  if (readDraft(body).text) {
    tried.add(body);
    return;
  }
  const context = readContext(body);
  if (!context.thread.length) return;
  tried.add(body);
  const threadId = threadKey(context);
  if (isForward(context.subject) || suggested?.threadId === threadId) return;
  // With the setting off or no key saved, it does nothing, not even Expand all.
  const opened = panelsOpened;
  if (!(await ask({ type: 'ready-on-reply' }))) return;
  // A panel opened (and maybe closed) meanwhile is the writer's answer.
  if (panel || opened !== panelsOpened || !body.isConnected || readDraft(body).text) return;
  dropPrefetch();
  const job = startJob(async () => {
    await expandThread(body);
    // Discarded while the thread opened: there is nothing to write for.
    if (!body.isConnected) throw new Error('The reply was closed.');
    return { ...readContext(body), draft: '', turns: [], instruction: '', prefetch: true };
  });
  const mine = { body, threadId, job };
  prefetch = mine;
  job.watch((type) => {
    if (prefetch !== mine) return;
    if (type === 'start') pill.show(false, job.shortcut);
    else if (type === 'delta') body.isConnected || dropPrefetch();
    else if (type === 'done') {
      suggested = { threadId, turns: [{ instruction: '', result: job.result, meta: job.meta }] };
      pill.show(true, job.shortcut);
    } else dropPrefetch();
  });
}

const READY_AFTER = 1000;

function onFocus(e) {
  const body = e.target instanceof Element ? e.target.closest(BODY) : null;
  if (!body) return;
  lastBody = body;
  // Gmail fills in the reply's subject and recipients as the box opens. The
  // wait also lets a writer who starts typing at once skip it: a request,
  // once sent, is billed in full even if stopped (Bedrock cannot cancel).
  setTimeout(() => readyOnReply(body), READY_AFTER);
}

function onInput(e) {
  if (!prefetch || !(e.target instanceof Element) || e.target.closest(BODY) !== prefetch.body) return;
  if (readDraft(prefetch.body).text) dropPrefetch();
}

// ---- Learn from edits ---------------------------------------------------------
// Sending a draft the panel wrote tells the worker what the panel wrote and
// what went out. The worker keeps the pair only if the writer changed more
// than the [blanks], and only once the box closes. The send itself is never
// held up or changed.

const SENT_WITHIN = 5000;

function onSend(e) {
  if (!(e.target instanceof Element)) return;
  let body = null;
  if (e.type === 'mouseup') {
    const button = e.button === 0 ? e.target.closest(SEND) : null;
    body = button && bodyOf(button);
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    body = e.target.closest(BODY);
  } else if ((e.key === 'Enter' || e.key === ' ') && e.target.closest(SEND)) {
    body = bodyOf(e.target.closest(SEND));
  }
  const wrote = body && written.get(body);
  if (!wrote || wrote.sending) return;
  // Learn only once the box closes: Gmail refuses some sends and leaves the
  // box open, and a drag that ends on Send sends nothing.
  wrote.sending = true;
  const after = readDraft(body).text;
  const started = Date.now();
  const timer = setInterval(() => {
    if (!body.isConnected || !body.getClientRects().length) {
      clearInterval(timer);
      written.delete(body);
      tell({ type: 'learn', before: wrote.text, after });
    } else if (Date.now() - started > SENT_WITHIN) {
      clearInterval(timer);
      wrote.sending = false;
    }
  }, 200);
}

// ---- The panel ------------------------------------------------------------------

// The draft to work on: the one with the cursor. Without one, on a thread
// it is a reply to that thread or none, never a draft docked beside it.
function findBody() {
  const active = document.activeElement?.closest?.(BODY);
  if (active) return active;
  const last = lastBody?.isConnected ? lastBody : null;
  const all = [...document.querySelectorAll(BODY)];
  if (readOpenThread()) return [last, ...all].find((body) => body && readContext(body).thread.length) ?? null;
  return last ?? (all.length === 1 ? all[0] : null);
}

function openPanel(body = findBody()) {
  pill.hide();
  const draft = body ? readDraft(body) : { text: '', blocked: false, lossy: false };
  // With no draft open, a thread on screen is enough to suggest a reply.
  const context = body ? readContext(body) : readOpenThread();
  const threadId = context ? threadKey(context) : '';
  const earlier = body ? written.get(body) : null;
  const resumed = earlier?.text === draft.text;
  // A forward is not a reply: it never takes or leaves a suggested reply.
  const forward = Boolean(body) && isForward(context?.subject ?? '');
  // Still being written for this box (Ready on Reply, or a panel that moved
  // here): show it as it arrives. A finished one is picked up through
  // `suggested`; a later thread's reply may have replaced that, and then
  // this box asks again.
  const handed =
    !resumed && !forward && !draft.text && prefetch?.body === body && prefetch.threadId === threadId && prefetch.job.status === 'loading'
      ? prefetch
      : null;
  const live = handed?.job ?? null;
  const carried = !live && !resumed && !forward && !draft.text && threadId && suggested?.threadId === threadId ? suggested : null;
  panelsOpened += 1;
  // A box the panel opened on never starts Ready on Reply later, even after Esc.
  if (body) tried.add(body);
  if (body && prefetch?.body === body) {
    if (!live) prefetch.job.cancel();
    prefetch = null;
  }
  // Where the cursor was in the draft, to put it back on Esc.
  const selection = getSelection();
  const caret = body && selection.rangeCount && body.contains(selection.getRangeAt(0).startContainer) ? selection.getRangeAt(0).cloneRange() : null;
  const state = {
    status: carried ? 'done' : context ? 'idle' : 'nobody', // idle | loading | done | nobody
    // The draft as it was before any edit, and every finished edit since:
    // { instruction, result, meta }. Each request sends all of it.
    original: resumed ? earlier.original : draft.text,
    turns: [...(resumed ? earlier.turns : carried ? carried.turns : (handed?.turns ?? []))],
    // The version on screen, ready to replace the draft.
    result: carried ? carried.turns.at(-1).result : (handed?.result ?? ''),
    meta: carried ? carried.turns.at(-1).meta : (handed?.meta ?? null),
    problem: null, // { message, code } while the last request has failed
    lastInstruction: '',
    writeFailed: false,
    draftChanged: false, // the draft was edited while the panel was open
    job: null,
  };
  // A reply to the thread on screen gets one-tap replies.
  const replying = Boolean(context?.thread.length) && !state.original && !forward;

  const host = el('div');
  host.dataset.draftEditor = '';
  const input = el('textarea', { slot: 'input', rows: 1 });
  input.setAttribute('aria-label', 'Instruction');
  input.setAttribute('style', INPUT_STYLE);

  const notice = el('div', { className: 'notice', hidden: true });
  notice.setAttribute('role', 'alert');
  const out = el('div', { className: 'out' });
  out.setAttribute('aria-live', 'polite');
  const note = el('div', { className: 'note', hidden: true });
  const hint = el('span', { className: 'hint' });
  const meta = el('span', { className: 'meta', title: 'How long it took, and what OpenRouter charged' });
  const second = el('button', { type: 'button', hidden: true });
  const primary = el('button', { type: 'button', className: 'primary', textContent: 'Replace draft', hidden: true });
  const iconButton = (label, drawing) => {
    const button = el('button', { type: 'button', className: 'icon', title: label });
    button.setAttribute('aria-label', label);
    button.append(icon(drawing));
    return button;
  };
  const micButton = iconButton('Speak', MIC);
  const optionsButton = iconButton('Options', SLIDERS);
  const closeButton = iconButton('Close', CROSS);
  const mark = icon(MEANDER);
  mark.setAttribute('class', 'mark');

  const chips = el('div', { className: 'chips', hidden: !replying });
  for (const [label, instruction] of QUICK) {
    const chip = el('button', { type: 'button', className: 'chip', textContent: label });
    chip.addEventListener('click', () => {
      dictation.cancel();
      run(instruction);
      input.focus();
    });
    chips.append(chip);
  }

  const top = el('div', { className: 'top' });
  top.append(mark, el('slot', { name: 'input' }), micButton, optionsButton, closeButton);
  const foot = el('div', { className: 'foot' });
  foot.append(hint, meta, second, primary);
  const card = el('div', { className: 'card' });
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Edit draft');
  card.append(top, chips, notice, out, note, foot);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(el('style', { textContent: CSS }), card);

  // Speech goes into the box, never straight to the model.
  const names = [...(context?.to ?? []), ...(context?.thread ?? []).map((m) => m.from)].map((n) => n.replace(/\s*<[^>]*>\s*$/, ''));
  const dictation = createDictation({
    lang: navigator.language || 'en-US',
    names,
    getText: () => input.value,
    setText: (text) => {
      input.value = text;
    },
    onUpdate: () => render(),
  });

  // The result as it will look in the draft.
  function show(text) {
    out.replaceChildren(textToNodes(text));
    for (const link of out.querySelectorAll('a')) Object.assign(link, { target: '_blank', rel: 'noopener noreferrer' });
    // Blanks stand out here only. The draft gets them as plain text.
    const walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (BLANK.test(walker.currentNode.data)) texts.push(walker.currentNode);
    for (const node of texts) {
      node.replaceWith(...node.data.split(BLANKS).map((part, i) => (i % 2 ? el('mark', { textContent: part }) : part)));
    }
  }

  const key = (name) => el('kbd', { textContent: name });

  function render() {
    const { status, problem } = state;
    const ready = status === 'done';
    const locked = !body || draft.blocked || state.writeFailed || state.draftChanged;
    const fix = problem?.code === 'settings';
    card.classList.toggle('loading', status === 'loading');
    out.setAttribute('aria-busy', String(status === 'loading'));

    const message =
      status === 'nobody' ? 'Click into a draft, then press the shortcut again.' : (problem?.message ?? dictation.problem ?? '');
    // An alert is read out each time its text is set.
    if (notice.textContent !== message) notice.textContent = message;
    notice.hidden = !notice.textContent;
    notice.classList.toggle('error', Boolean(problem));

    primary.hidden = !ready;
    primary.disabled = locked;
    second.hidden = !ready && !fix;
    second.textContent = fix ? 'Open Options' : 'Copy';
    // When the fix is in Options, that is the one thing to do next.
    second.classList.toggle('primary', fix && !ready);
    meta.textContent = ready && !problem ? describeMeta(state.meta) : '';
    meta.hidden = !meta.textContent;

    const voice = dictation.state;
    micButton.hidden = voice === 'hidden' || status === 'nobody';
    micButton.disabled = voice === 'preparing';
    micButton.classList.toggle('listening', voice === 'listening');
    const speak = voice === 'listening' ? 'Stop speaking' : voice === 'preparing' ? 'Setting up voice' : 'Speak';
    micButton.title = speak;
    micButton.setAttribute('aria-label', speak);

    const closes = [key('Esc'), ' closes'];
    if (voice === 'listening') hint.replaceChildren('Listening… · ', key('Enter'), ' runs it');
    else if (status === 'loading') hint.replaceChildren('Working… · ', ...closes);
    else if (status === 'nobody') hint.replaceChildren(...closes);
    else if (problem) hint.replaceChildren(key('Enter'), ' tries again · ', ...closes);
    else if (!ready) hint.replaceChildren(key('Enter'), ' runs it · ', ...closes);
    else if (locked) hint.replaceChildren(...closes);
    else hint.replaceChildren(key('Enter'), ' replaces the draft · ', ...closes);

    const about = [];
    if (ready) {
      if (!body) about.push('To write it in, open a reply and press the shortcut again.');
      else if (state.writeFailed) about.push('Could not write into this draft. Copy the text instead.');
      else if (state.draftChanged) about.push('The draft changed while this was open, so replacing is off. Copy the text, or open Rhada again on the new draft.');
      else if (draft.blocked) about.push('This draft has an image or table, so replacing is off. Copy the text instead.');
      else if (draft.lossy) about.push('Only links, bold and lists are kept. Other formatting in this draft will be lost.');
      if (BLANK.test(state.result)) about.push('Fill in the [brackets] before you send.');
    }
    note.textContent = about.join(' ');
    note.hidden = !about.length;

    if (!state.original && !state.turns.length && !context?.thread.length) input.placeholder = 'Say what to write';
    else if (state.turns.length > 1 || resumed || carried) input.placeholder = 'Ask for another change';
    else input.placeholder = 'Ask for a change, e.g. shorter, warmer, more direct';
  }

  // A failed change costs nothing: the last full version comes back into view
  // and the instruction goes back into the box, selected, ready to resend.
  function fail(message, code) {
    state.job = null;
    state.problem = { message, code };
    state.status = state.result ? 'done' : 'idle';
    out.classList.remove('stale');
    if (state.result) show(state.result);
    else out.replaceChildren();
    if (state.lastInstruction && !input.value) {
      input.value = state.lastInstruction;
      input.select();
    }
    render();
  }

  // Shows a request as it streams in, and keeps it once it finishes.
  function follow(job, instruction) {
    if (state.job !== job) state.job?.cancel();
    state.job = job;
    state.lastInstruction = instruction;
    state.status = 'loading';
    state.problem = null;
    // The last version stays in view, dimmed, until the new one starts to arrive.
    out.classList.add('stale');
    if (job.text) {
      out.classList.remove('stale');
      show(job.text);
    }
    render();
    job.watch((type) => {
      if (state.job !== job) return;
      if (type === 'delta') {
        out.classList.remove('stale');
        show(job.text);
      } else if (type === 'done') {
        state.job = null;
        state.turns.push({ instruction, result: job.result, meta: job.meta });
        if (!state.original && !forward && threadId) suggested = { threadId, turns: [...state.turns] };
        state.result = job.result;
        state.meta = job.meta;
        state.status = 'done';
        out.classList.remove('stale');
        show(job.result);
        render();
      } else if (type === 'error') {
        fail(job.problem.message, job.problem.code);
      } else if (type === 'off') {
        // Ready on Reply was turned off as it started: ask now instead.
        run(instruction);
      }
    });
  }

  // Older messages are expanded and read once, before the first request.
  let reading = null;
  function run(instruction) {
    const turns = [...state.turns];
    follow(
      startJob(async () => {
        if (context.thread.length) {
          reading ??= expandThread(body).then(() => {
            const now = body ? (body.isConnected ? readContext(body) : null) : readOpenThread();
            const same = body || (now && threadKey(now) === threadId);
            if (now && same && now.thread.length > context.thread.length) context.thread = now.thread;
          });
          await reading;
        }
        return { ...context, draft: state.original, turns, instruction };
      }),
      instruction,
    );
  }

  function replace() {
    if (!body || draft.blocked || state.writeFailed || state.draftChanged) return;
    const now = readDraft(body);
    if (now.text !== draft.text || now.blocked !== draft.blocked) {
      state.draftChanged = true;
      render();
      input.focus();
      return;
    }
    if (replaceDraft(body, state.result)) {
      written.set(body, { text: readDraft(body).text, original: state.original, turns: state.turns });
      if (suggested?.threadId === threadId) suggested = null;
      close({ refocus: false });
      return;
    }
    // Keep the result on screen so it can still be copied.
    state.writeFailed = true;
    render();
    input.focus();
  }

  async function submit() {
    // Enter while speaking waits for the last words, then runs them.
    if (dictation.state === 'listening' && (await dictation.finish()) === null) return;
    if (dictation.state === 'preparing') dictation.cancel();
    if (!host.isConnected) return;
    const instruction = input.value.trim();
    if (instruction) {
      input.value = '';
      run(instruction);
    } else if (state.problem) {
      run(state.lastInstruction);
    } else if (state.status === 'done') {
      replace();
    }
  }

  // Keys pressed in the panel never reach Gmail's shortcut handlers.
  function onKey(e) {
    if (!e.composedPath().includes(host)) return;
    e.stopPropagation();
    if (e.type !== 'keydown' || e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Tab goes round the panel. Past its edge, keys would reach Gmail.
      const stops = [input, micButton, optionsButton, closeButton, ...chips.querySelectorAll('button'), second, primary].filter(
        (stop) => stop.isConnected && !stop.disabled && stop.getClientRects().length,
      );
      const at = stops.indexOf(e.composedPath()[0]);
      const next = e.shiftKey ? (at <= 0 ? stops.at(-1) : null) : at === stops.length - 1 || at < 0 ? stops[0] : null;
      if (next) {
        e.preventDefault();
        next.focus();
      }
    } else if (e.key === 'Enter' && !e.shiftKey && e.target === input) {
      e.preventDefault();
      submit();
    }
    // The key that closed the panel is released over the draft: hide that keyup too.
    if (!host.isConnected) {
      window.addEventListener('keyup', (up) => up.key === e.key && up.stopPropagation(), { capture: true, once: true });
    }
  }
  const KEY_EVENTS = ['keydown', 'keypress', 'keyup'];

  function close({ refocus = true } = {}) {
    state.job?.cancel();
    state.job = null;
    dictation.cancel();
    for (const type of KEY_EVENTS) window.removeEventListener(type, onKey, true);
    host.remove();
    panel = null;
    if (!refocus || !body?.isConnected) return;
    body.focus();
    if (caret && body.contains(caret.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
  }

  primary.addEventListener('click', replace);
  closeButton.addEventListener('click', () => close());
  optionsButton.addEventListener('click', () => tell({ type: 'open-options' }));
  micButton.addEventListener('click', () => {
    dictation.toggle();
    input.focus();
  });
  // Typing while speaking stops listening and keeps both.
  input.addEventListener('input', () => {
    if (dictation.state === 'listening' || dictation.state === 'preparing') dictation.cancel();
    else dictation.clearProblem();
  });
  second.addEventListener('click', async () => {
    if (state.problem?.code === 'settings') {
      tell({ type: 'open-options' });
      return;
    }
    // Rich text, so links and bold survive a paste into Gmail.
    const blob = (type, data) => new Blob([data], { type });
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blob('text/html', textToHtml(state.result)), 'text/plain': blob('text/plain', state.result) }),
      ]);
      second.textContent = 'Copied';
    } catch {
      second.textContent = 'Could not copy';
    }
    input.focus();
    setTimeout(() => {
      if (state.status === 'done' && !state.problem) second.textContent = 'Copy';
    }, 1500);
  });

  for (const type of KEY_EVENTS) window.addEventListener(type, onKey, true);
  document.documentElement.append(host);
  panel = {
    close,
    onDraft: Boolean(body),
    // A suggestion still being written for the thread, to hand to its reply box.
    handOff() {
      if (state.status !== 'loading' || state.original || !threadId || !state.job) return null;
      const { job, turns, lastInstruction: instruction, result, meta } = state;
      state.job = null;
      return { job, threadId, turns: [...turns], instruction, result, meta };
    },
  };

  if (state.status === 'nobody') {
    render();
    closeButton.focus();
    return;
  }
  host.append(input);
  input.focus();
  if (carried) show(state.result);
  if (live) {
    if (state.result) show(state.result);
    follow(live, handed.instruction ?? '');
  }
  // A draft with text gets the first pass. An empty reply gets a suggested one.
  else if (!resumed && !carried && (draft.text || context.thread.length)) run('');
  else render();
}

function onMessage(msg) {
  if (msg?.type !== 'toggle') return;
  if (!panel) {
    openPanel();
    return;
  }
  // Pressed again from a draft, a panel that had none moves onto it, and
  // takes along a suggestion it was still writing: it is not paid for twice.
  const move = !panel.onDraft && findBody();
  const running = move && !readDraft(move).text ? panel.handOff() : null;
  panel.close();
  if (!move) return;
  if (running) {
    prefetch?.job.cancel();
    prefetch = { body: move, ...running };
  }
  openPanel(move);
}

// One live copy per tab. Chrome adds one as Gmail loads, and the toolbar
// button adds one to a tab that was open before. A copy left from before an
// extension reload can no longer reach the extension, so it gives way.
if (!globalThis.rhadaLive?.()) {
  globalThis.rhadaLive = () => Boolean(chrome.runtime?.id);
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('input', onInput, true);
  window.addEventListener('mouseup', onSend, true);
  window.addEventListener('keydown', onSend, true);
  chrome.runtime.onMessage.addListener(onMessage);
}
