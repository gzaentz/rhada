import { BODY, readDraft, readContext, replaceDraft } from './gmail.js';
import { textToHtml, textToNodes } from './format.js';

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
// Letters that look cut in stone, for the few labels that carry the look.
const CARVED = 'Optima, Candara, "Segoe UI", sans-serif';

// One look, always dark: basalt, marble text, a little gold.
const CSS = `
:host { all: initial; position: fixed; top: 12vh; left: 50%; transform: translateX(-50%);
  z-index: 2147483647; width: min(620px, calc(100vw - 32px)); }
.card { --fg: #e9e3d7; --bright: #f6f1e7; --muted: #9a9284; --line: #2a2723; --line-2: #3d3830;
  --gold: #c2a467; --danger: #dd927f;
  position: relative; display: flex; flex-direction: column; max-height: 76vh; overflow: hidden;
  color-scheme: dark; color: var(--fg); background: linear-gradient(180deg, #171614, #100f0e);
  border: 1px solid var(--line); border-radius: 6px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .55), 0 30px 80px rgba(0, 0, 0, .5), 0 6px 18px rgba(0, 0, 0, .3);
  font: 14px/21px ${FONT}; animation: rise .16s ease-out; }
/* A line of light along the lintel. It travels while the model works. */
.card::before { content: ''; position: absolute; inset: 0 0 auto; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(194, 164, 103, .7) 20%, rgba(194, 164, 103, .7) 80%, transparent); }
.card.loading::before { animation: glint 1.5s linear infinite;
  background: linear-gradient(90deg, transparent, rgba(194, 164, 103, .3) 35%, #f0deb0 50%, rgba(194, 164, 103, .3) 65%, transparent) 150% 0 / 200% 100%; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@keyframes glint { to { background-position: -50% 0; } }
@media (prefers-reduced-motion: reduce) {
  .card, .card.loading::before { animation: none; }
  .out, button { transition: none; }
}
.top { display: flex; align-items: flex-start; gap: 10px; padding: 14px 10px 13px 16px; }
.mark { flex: none; margin-top: 4px; color: var(--gold); }
slot { display: block; flex: 1; min-width: 0; }
.notice { padding: 11px 18px 12px; border-top: 1px solid var(--line); color: var(--muted); }
.notice.error { color: var(--danger); }
.out { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 18px 18px;
  border-top: 1px solid var(--line); overflow-wrap: anywhere; transition: opacity .15s;
  scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }
.out:empty { display: none; }
.out.stale { opacity: .38; }
.out a { color: var(--gold); text-underline-offset: 2px; text-decoration-color: rgba(194, 164, 103, .5); }
.out b { color: var(--bright); font-weight: 600; }
.out ul, .out ol { margin: 0; padding-left: 22px; }
::selection { background: rgba(194, 164, 103, .3); }
.note { padding: 0 18px 12px; color: var(--muted); font-size: 12px; line-height: 17px; }
.foot { box-sizing: border-box; display: flex; align-items: center; gap: 6px; min-height: 51px;
  padding: 9px 10px 9px 18px; border-top: 1px solid var(--line); background: rgba(0, 0, 0, .22); }
.hint { flex: 1; color: var(--muted); font-size: 12px; line-height: 18px; }
kbd { margin-right: 1px; padding: 1px 5px; border: 1px solid var(--line-2); border-radius: 3px;
  background: rgba(233, 227, 215, .04); color: var(--fg); font: 11px/16px ${CARVED}; letter-spacing: .04em; }
button { all: unset; box-sizing: border-box; cursor: pointer; border: 1px solid transparent;
  border-radius: 4px; padding: 5px 13px; color: var(--muted); font: 13px/20px ${CARVED};
  letter-spacing: .03em; transition: color .12s, background .12s, border-color .12s; }
button:hover { color: var(--fg); background: rgba(233, 227, 215, .06); }
button:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
button.primary { color: var(--gold); border-color: rgba(194, 164, 103, .5); background: rgba(194, 164, 103, .12); }
button.primary:hover { color: #e6cf99; border-color: var(--gold); background: rgba(194, 164, 103, .2); }
button:disabled { opacity: .4; cursor: default; pointer-events: none; }
button.icon { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; }
[hidden] { display: none !important; }
`;

// The instruction box stays in the page's own DOM, slotted into the panel, so
// Gmail's keyboard shortcuts see a real <textarea> and leave typing alone.
// Its placeholder is coloured in extension/content.css.
const INPUT_STYLE = `all: initial; display: block; box-sizing: border-box; width: 100%;
  field-sizing: content; min-height: 22px; max-height: 120px; overflow-y: auto; resize: none;
  font: 15px/22px ${FONT}; color: var(--fg); caret-color: var(--gold); background: transparent;
  cursor: text; white-space: pre-wrap; overflow-wrap: anywhere;`;

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// A 16-unit line drawing in the current text colour.
function icon(d) {
  const make = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const svg = make('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
  svg.append(make('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linecap': 'square' }));
  return svg;
}
// One turn of a Greek key.
const MEANDER = 'M1.5 14.5v-13h13v10h-9v-6h5v3';
const SLIDERS = 'M2 5h6m4 0h2M2 11h2m4 0h6M12 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z';
const CROSS = 'M4 4l8 8m0-8l-8 8';

let lastBody = null;
document.addEventListener(
  'focusin',
  (e) => {
    const body = e.target instanceof Element ? e.target.closest(BODY) : null;
    if (body) lastBody = body;
  },
  true,
);

function findBody() {
  const active = document.activeElement?.closest?.(BODY);
  if (active) return active;
  if (lastBody?.isConnected) return lastBody;
  const all = document.querySelectorAll(BODY);
  return all.length === 1 ? all[0] : null;
}

let panel = null;

// What the panel last wrote into each draft. Opening it again on that text
// carries on the same conversation instead of polishing its own work.
const written = new WeakMap();

function openPanel() {
  const body = findBody();
  const draft = body ? readDraft(body) : { text: '', blocked: false, lossy: false };
  const context = body ? readContext(body) : null;
  const earlier = body ? written.get(body) : null;
  const resumed = earlier?.text === draft.text;
  const state = {
    status: body ? 'idle' : 'nobody', // idle | loading | done | nobody
    // The draft as it was before any edit, and every finished edit since:
    // { instruction, result }. Each request sends all of it.
    original: resumed ? earlier.original : draft.text,
    turns: resumed ? [...earlier.turns] : [],
    result: '', // the version on screen, ready to replace the draft
    problem: null, // { message, code } while the last request has failed
    lastInstruction: '',
    writeFailed: false,
    port: null,
  };

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
  const second = el('button', { type: 'button', hidden: true });
  const primary = el('button', { type: 'button', className: 'primary', textContent: 'Replace draft', hidden: true });
  const iconButton = (label, drawing) => {
    const button = el('button', { type: 'button', className: 'icon', title: label });
    button.setAttribute('aria-label', label);
    button.append(icon(drawing));
    return button;
  };
  const optionsButton = iconButton('Options', SLIDERS);
  const closeButton = iconButton('Close', CROSS);
  const mark = icon(MEANDER);
  mark.setAttribute('class', 'mark');

  const top = el('div', { className: 'top' });
  top.append(mark, el('slot', { name: 'input' }), optionsButton, closeButton);
  const foot = el('div', { className: 'foot' });
  foot.append(hint, second, primary);
  const card = el('div', { className: 'card' });
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Edit draft');
  card.append(top, notice, out, note, foot);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(el('style', { textContent: CSS }), card);

  // The result as it will look in the draft.
  function show(text) {
    out.replaceChildren(textToNodes(text));
    for (const link of out.querySelectorAll('a')) Object.assign(link, { target: '_blank', rel: 'noopener noreferrer' });
  }

  const key = (name) => el('kbd', { textContent: name });

  function render() {
    const { status, problem } = state;
    const ready = status === 'done';
    const locked = draft.blocked || state.writeFailed;
    const fix = problem?.code === 'settings';
    card.classList.toggle('loading', status === 'loading');

    notice.textContent = status === 'nobody' ? 'Click into a draft, then press the shortcut again.' : (problem?.message ?? '');
    notice.hidden = !notice.textContent;
    notice.classList.toggle('error', Boolean(problem));

    primary.hidden = !ready;
    primary.disabled = locked;
    second.hidden = !ready && !fix;
    second.textContent = fix ? 'Open Options' : 'Copy';
    // When the fix is in Options, that is the one thing to do next.
    second.classList.toggle('primary', fix && !ready);

    const closes = [key('Esc'), ' closes'];
    if (status === 'loading') hint.replaceChildren('Working… · ', ...closes);
    else if (status === 'nobody') hint.replaceChildren(...closes);
    else if (problem) hint.replaceChildren(key('Enter'), ' tries again · ', ...closes);
    else if (!ready) hint.replaceChildren(key('Enter'), ' runs it · ', ...closes);
    else if (locked) hint.replaceChildren(...closes);
    else hint.replaceChildren(key('Enter'), ' replaces the draft · ', ...closes);

    let about = '';
    if (ready) {
      if (state.writeFailed) about = 'Could not write into this draft. Copy the text instead.';
      else if (draft.blocked) about = 'This draft has an image or table, so replacing is off. Copy the text instead.';
      else if (draft.lossy) about = 'Only links, bold and lists are kept. Other formatting in this draft will be lost.';
    }
    note.textContent = about;
    note.hidden = !about;

    if (!state.original && !state.turns.length) input.placeholder = 'Say what to write';
    else if (state.turns.length > 1 || resumed) input.placeholder = 'Ask for another change';
    else input.placeholder = 'Ask for a change, e.g. shorter, warmer, more direct';
  }

  // A failed change costs nothing: the last full version comes back into view
  // and the instruction goes back into the box, selected, ready to resend.
  function fail(message, code) {
    state.port?.disconnect();
    state.port = null;
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

  function run(instruction) {
    state.port?.disconnect();
    state.lastInstruction = instruction;
    state.status = 'loading';
    state.problem = null;
    // The last version stays in view, dimmed, until the new one starts to arrive.
    out.classList.add('stale');
    render();

    let port;
    try {
      port = chrome.runtime.connect({ name: 'edit' });
    } catch {
      fail('The extension was updated. Refresh this Gmail tab.');
      return;
    }
    state.port = port;
    let shown = '';
    port.onMessage.addListener((msg) => {
      if (state.port !== port) return;
      if (msg.type === 'delta') {
        shown += msg.text;
        out.classList.remove('stale');
        show(shown);
      } else if (msg.type === 'error') {
        fail(msg.message, msg.code);
      } else if (msg.type === 'done') {
        if (!msg.text) {
          fail('Nothing came back. Try again.');
          return;
        }
        state.port = null;
        port.disconnect();
        state.turns.push({ instruction, result: msg.text });
        state.result = msg.text;
        state.status = 'done';
        out.classList.remove('stale');
        show(msg.text);
        render();
      }
    });
    port.onDisconnect.addListener(() => {
      if (state.port === port) fail('Lost contact with the extension. Refresh this Gmail tab.');
    });
    port.postMessage({ ...context, draft: state.original, turns: state.turns, instruction });
  }

  function replace() {
    if (draft.blocked || state.writeFailed) return;
    if (replaceDraft(body, state.result)) {
      written.set(body, { text: readDraft(body).text, original: state.original, turns: state.turns });
      close({ refocus: false });
      return;
    }
    // Keep the result on screen so it can still be copied.
    state.writeFailed = true;
    render();
    input.focus();
  }

  function submit() {
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

  function openOptions() {
    try {
      chrome.runtime.sendMessage({ type: 'open-options' });
    } catch {
      // The extension was reloaded under this tab: the next edit says so.
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
    state.port?.disconnect();
    state.port = null;
    for (const type of KEY_EVENTS) window.removeEventListener(type, onKey, true);
    host.remove();
    panel = null;
    if (refocus && body?.isConnected) body.focus();
  }

  primary.addEventListener('click', replace);
  closeButton.addEventListener('click', () => close());
  optionsButton.addEventListener('click', openOptions);
  second.addEventListener('click', async () => {
    if (state.problem?.code === 'settings') {
      openOptions();
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
  panel = { close };

  if (!body) {
    render();
    closeButton.focus();
    return;
  }
  host.append(input);
  input.focus();
  if (draft.text && !resumed) run('');
  else render();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'toggle') return;
  if (panel) panel.close();
  else openPanel();
});
