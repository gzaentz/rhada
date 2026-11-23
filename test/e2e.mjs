// Loads the built extension into Chromium and drives it against a page that
// copies Gmail's compose and thread markup (captured from live Gmail on
// 2026-11-09; Send, Expand all and collapsed messages on 2026-11-11) and
// Gmail's Trusted Types policy. OpenRouter is stubbed: its
// error bodies were recorded from the live API, its stream follows its docs.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lets context.route() see requests made by the extension's service worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { chromium } = await import('playwright');

const extension = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const profile = mkdtempSync(join(tmpdir(), 'draft-editor-test-'));
// On another site, Rhada gets in when the shortcut is pressed (activeTab). A
// press faked by the test does not count, so this copy is let into example.net
// up front. example.com stays out, as a page Chrome keeps extensions out of.
const loaded = join(profile, 'extension');
cpSync(extension, loaded, { recursive: true });
const manifest = JSON.parse(readFileSync(join(loaded, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('https://example.net/*');
writeFileSync(join(loaded, 'manifest.json'), JSON.stringify(manifest));
// A local templates file is added when Rhada loads (replacing any real one in the copy).
const LOCAL_TEMPLATES = JSON.stringify([{ name: 'Batch delivered', when: 'New leads are uploaded', text: 'Hey [first name],\n\nJust uploaded your batch.' }]);
writeFileSync(join(loaded, 'templates.local.json'), LOCAL_TEMPLATES);

// SHOTS=<folder> npm test also saves a picture of each state, to look at.
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name, { whole = false, ...options } = {}) => {
  if (!SHOTS) return;
  await page.waitForTimeout(300); // the panel has finished fading in
  // A whole page is taken by growing the window, so a sticky bar sits where it belongs.
  if (whole) await page.setViewportSize({ width: 1280, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), ...options });
};

const SIGNATURE =
  '<div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div dir="ltr"><span>Sam Rivera</span></div></div></div><br>';

const BODIES = {
  // New message: one <div> per line, signature wrapped in a bare <div>.
  fresh: `<div>hey dana,</div><div><br></div><div>thx for reaching out. pricing for 20 seats is <b>$40/seat</b>, see <a href="https://example.com/pricing">our pricing page</a>.</div><div><br></div><div>lmk if u want a call</div><div><br></div>${SIGNATURE}`,
  // Reopened draft: Gmail wraps everything, signature included, in one div.
  reopened: `<div dir="ltr">hey dana,<div><br></div><div>thx for reaching out</div><div><br clear="all"></div><div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div dir="ltr">Sam Rivera</div></div></div></div>`,
  // No signature, bare text nodes and <br>.
  bare: 'hey dana,<br><br>thx for reaching out',
  // Forward: quoted mail follows the user's text.
  forward: `<div dir="ltr">fyi see below<br></div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: Dana Lee</div><br><br><div>Original pricing question</div></div>`,
  // Untouched reply: only Gmail's non-editable hint, then the signature.
  empty: `<div><span class="jKzJCd" contenteditable="false">Press / for Help me write</span><br></div>${SIGNATURE}`,
  // The user removed the empty line above the signature.
  signatureOnly: SIGNATURE,
  // Gmail's Bold around a link, and around a line break.
  boldLink: `<div>hi dana,</div><div><b><a href="https://example.com/call">book a call</a></b></div><div><b>Monday<br>Tuesday</b></div><div><br></div>${SIGNATURE}`,
  // Chrome's markup for bold typed with Cmd+B across a blank line, then an emoji from Gmail's picker.
  boldSpaces: `<div>hi dana,</div><b>Agenda</b><div><b><br></b></div><div>Item one<b> Note: </b>call me <img data-emoji="👍" alt="👍" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><div><br></div>${SIGNATURE}`,
  image: `<div>see the chart</div><div><img alt="chart" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>${SIGNATURE}`,
};

const composeBox = (name, subject) => `<table><tbody><tr><td class="I5">
    <form>
      <div role="listbox" aria-label="Search Field"><div role="option" data-hovercard-id="dana@example.com" data-name="Dana Lee">Dana Lee</div></div>
      <input name="subjectbox" aria-label="Subject" value="${subject}">
    </form>
    <div class="Am aiL Al editable" role="textbox" aria-label="Message Body" aria-multiline="true" contenteditable="true" g_editable="true" style="min-height:120px">${BODIES[name]}</div>
    <div role="button" class="T-I J-J5-Ji aoO v7 T-I-atl L3" tabindex="0" data-tooltip="Send ‪(⌘Enter)‬" aria-label="Send ‪(⌘Enter)‬">Send</div>
    <div role="button" class="T-I J-J5-Ji hG T-I-atl L3" tabindex="0" aria-haspopup="true" data-tooltip="More send options" aria-label="More send options">▾</div>
  </td></tr></tbody></table>`;

// An earlier message, collapsed the way Gmail shows it: a snippet, no body.
// "Expand all" loads it a moment later.
const OLDER_COLLAPSED = `<div role="listitem"><div class="kv"><span class="gD" email="lee@example.com" name="Lee Park">Lee Park</span> <span class="y2">Hi Dana, looping in Sam…</span></div></div>`;
const OLDER_FULL = `<template id="olderFull"><div class="adn ads">
    <span class="gD" email="lee@example.com" name="Lee Park">Lee Park</span>
    <span class="g3" title="Nov 7, 2026, 4:02 PM">Nov 7</span>
    <div class="a3s aiL"><div dir="ltr">Hi Dana, looping in Sam for pricing.</div></div>
  </div></template>`;
const EXPAND_ALL = '<div role="button" tabindex="0" aria-label="Expand all" id="expandAll" class="bjJ">Expand all</div>';

// `none` is a thread with no reply open yet, and a Reply button that opens one.
// `inbox` has neither a thread nor a draft. `older` adds a collapsed message.
function gmailPage(name, { subject = 'Re: Pricing question', older = false, mine = false } = {}) {
  const compose =
    name === 'none'
      ? `<div role="button" tabindex="0" id="reply">Reply</div><template id="replyBox">${composeBox('empty', subject)}</template>`
      : composeBox(name, subject);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pricing question - sam@example.com - Gmail</title><style>
  body { margin: 0; padding: 28px 56px; background: #f6f8fc; color: #202124; font: 14px/20px Arial, sans-serif; }
  [role="main"] { padding: 20px 28px 28px; border-radius: 16px; background: #fff; }
  .hP { margin: 0 0 16px; font-size: 22px; font-weight: 400; }
  .gD { font-weight: bold; } .g3 { margin-left: 8px; color: #5f6368; font-size: 12px; }
  .a3s { margin: 12px 0 20px; } .gmail_quote { color: #5f6368; }
  table { width: 100%; } .I5 { padding: 12px 16px; border: 1px solid #dadce0; border-radius: 8px; }
  input { display: block; width: 100%; margin: 8px 0; padding: 6px 0; border: 0; border-bottom: 1px solid #eee; font: inherit; }
  [contenteditable] { outline: none; }
  #reply { display: inline-block; padding: 8px 20px; border: 1px solid #dadce0; border-radius: 18px; cursor: pointer; }
</style></head><body>
<div role="main">${name === 'inbox' ? '<p>Inbox</p></div>' : `
  <h2 class="hP">Pricing question</h2>${older ? EXPAND_ALL + OLDER_FULL : ''}
  <div role="list">${older ? OLDER_COLLAPSED : ''}<div role="listitem"><div class="adn ads">
    <span class="gD" email="dana@example.com" name="Dana Lee">Dana Lee</span>
    <span class="g3" title="Nov 8, 2026, 9:14 AM">9:14 AM</span>
    <div class="a3s aiL"><div dir="ltr">Hi Sam,<div><br></div><div>Can you send pricing for 20 seats?</div><div class="gmail_quote">an older quoted message</div></div></div>
  </div></div>${mine ? `<div role="listitem"><div class="adn ads">
    <span class="gD" email="Sam@example.com" name="Sam Rivera">Sam Rivera</span>
    <span class="g3" title="Nov 8, 2026, 4:02 PM">4:02 PM</span>
    <div class="a3s aiL"><div dir="ltr">Hi Dana, pricing for 20 seats is $40 a seat. Want to start this week?</div></div>
  </div></div>` : ''}</div>
  ${compose}
</div>`}
<div role="combobox" aria-label="Ask Gemini" contenteditable="true"></div>
<script>
  // Stands in for Gmail's page-level keyboard shortcuts.
  window.__keys = [];
  for (const type of ['keydown', 'keypress', 'keyup']) {
    document.addEventListener(type, (e) => window.__keys.push(type + ':' + e.key), true);
    document.addEventListener(type, (e) => window.__keys.push(type + ':' + e.key));
  }
  // Like Gmail's Reply: the reply box opens in the thread with the cursor in it.
  document.getElementById('reply')?.addEventListener('click', (e) => {
    e.target.replaceWith(document.getElementById('replyBox').content.cloneNode(true));
    document.querySelector('[g_editable="true"]').focus();
  });
  // Like Gmail's Expand all: the collapsed messages load a moment later.
  document.getElementById('expandAll')?.addEventListener('click', (e) => {
    const button = e.currentTarget;
    setTimeout(() => {
      document.querySelector('.kv').replaceWith(document.getElementById('olderFull').content.cloneNode(true));
      button.setAttribute('aria-label', 'Collapse all');
      button.textContent = 'Collapse all';
    }, 120);
  });
  // Like Gmail's Send, by button or Cmd+Enter: the compose box goes away.
  window.__sent = 0;
  const send = (from) => {
    from.closest('table').remove();
    window.__sent += 1;
  };
  document.addEventListener('click', (e) => e.target.closest('.aoO') && send(e.target));
  // Like Gmail's More send options: a menu at the end of the page whose
  // Schedule send item (here in Spanish) asks when, then closes the box.
  document.addEventListener('click', (e) => {
    const more = e.target.closest('.hG');
    if (more) {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      // Built node by node: the page enforces Trusted Types, like Gmail.
      const item = document.createElement('div');
      Object.entries({ role: 'menuitem', class: 'J-N yr', selector: 'scheduledSend' }).forEach(([k, v]) => item.setAttribute(k, v));
      item.textContent = 'Programar envío';
      menu.append(item);
      menu.box = more.closest('table');
      document.body.append(menu);
    }
    const item = e.target.closest('[selector="scheduledSend"]');
    if (item) {
      const menu = item.closest('[role="menu"]');
      menu.remove();
      setTimeout(() => send(menu.box), 600);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.closest('[g_editable="true"]')) send(e.target);
  });
</script>
</body></html>`;
}

const LESSONS = '- Opens warmly and casually.\n- Keeps replies short.';

const POLISHED = `Hi Dana,

Thanks for reaching out. Pricing for 20 seats is **$40/seat**. See [our pricing page](https://example.com/pricing).

Happy to jump on a call.

- Sam`;
const SHORTER = `Hi Dana,

20 seats is **$40/seat**: [our pricing page](https://example.com/pricing).

- Sam`;
const WITH_PS = `${SHORTER}

PS: the trial is free.`;
const SUGGESTED = `Hi Dana,

Happy to help. For 20 seats it is [price per seat] a month.

- Sam`;
const STEPS = `Hi Dana,

1. Pick a plan
2. Add seats

Then:

3. Invite the team
4. Start

- Sam`;
const OPTIONS_REPLY = `Hi Dana,

Two options:

- Monthly at $40 <per seat>
- Annual at $32

Which works?`;

const DECLINED = `Hi Dana,

Thanks for thinking of us. We can't take on 20 seats right now, but I'll reach out if that changes.

- Sam`;

// Another site's text boxes: a plain one, a plain editable one, and an editor
// that writes pastes into its own model, as chat and post editors do.
const FIELDS_PAGE = `<!doctype html><title>Messages | Example</title>
<textarea id="plain" rows="8" cols="80">hey dana, thx for reaching out. pricing for 20 seats is $40/seat. lmk if u want a call</textarea>
<div id="editable" contenteditable="true" style="min-height: 60px"><div>hey dana, thx</div></div>
<div id="editor" contenteditable="true" style="min-height: 60px"><p>hey dana</p></div>
<section id="chat">
  <p><b>Dana Lee</b> 9:12 AM</p>
  <p>Hi! We are a team of 20 and looking at tools for our support inbox. Could you tell me what the yearly price would be for 20 seats, and whether you offer a pilot first? We would want to start in March if the numbers work, and our IT team will need to see your security overview before we sign anything.</p>
  <p><b>Dana Lee</b> 9:14 AM</p>
  <p>Also, is there a discount if we pay for the whole year upfront? Our finance team asked me to check before Friday.</p>
  <textarea id="reply" rows="3" cols="80"></textarea>
</section>
<script>
  let inputs = 0;
  document.getElementById('plain').addEventListener('input', () => (inputs += 1));
  window.inputs = () => inputs;
  const editor = document.getElementById('editor');
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    window.pasted = e.clipboardData.getData('text/plain');
    editor.replaceChildren(...window.pasted.split('\\n').map((line) => Object.assign(document.createElement('p'), { textContent: line })));
  });
</script>`;

// What the panel shows: links and bold rendered, not as markup.
const rendered = (text) => text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// A message's text, also when it carries images or files as parts.
const textOf = (content) => (typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));
const partsOf = (content) => (typeof content === 'string' ? [] : content.filter((part) => part.type !== 'text'));

function sse(text, finish = 'stop', provider = 'Amazon Bedrock') {
  const chunk = (delta, reason = null, extra = {}) =>
    `data: ${JSON.stringify({ id: 'gen-test', object: 'chat.completion.chunk', created: 1794000000, model: 'anthropic/claude-opus-5.5', provider, choices: [{ index: 0, delta, finish_reason: reason, native_finish_reason: reason }], ...extra })}\n\n`;
  return [
    ': OPENROUTER PROCESSING\n\n',
    chunk({ role: 'assistant', content: '', reasoning: 'Tighten it, keep the facts.' }),
    ...text.match(/[\s\S]{1,24}/g).map((piece) => chunk({ role: 'assistant', content: piece })),
    // A finished stream repeats the finish reason on a last chunk that carries the usage.
    ...(finish ? [chunk({ role: 'assistant', content: '' }, finish), chunk({ role: 'assistant', content: '' }, finish, { usage: { prompt_tokens: 1840, completion_tokens: 212, total_tokens: 2052, cost: 0.0123, is_byok: false, cost_details: { upstream_inference_cost: null } } }), 'data: [DONE]\n\n'] : []),
  ].join('');
}

// The extension is loaded once a Gmail tab is already open, the way it was
// installed for real, so that tab starts without the panel's script.
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  deviceScaleFactor: SHOTS ? 2 : 1,
  args: ['--enable-unsafe-extension-debugging'],
  ignoreDefaultArgs: ['--disable-extensions'],
});

const calls = [];
// How long the stubbed model takes to start answering, in ms. Screenshots
// get a pause like a real model's, so the time under a result is not 0.0 s.
const PACE = SHOTS ? 1200 : 0;
let delay = PACE;
let passed = 0;
try {
  await context.route('https://mail.google.com/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "require-trusted-types-for 'script'" },
      body: gmailPage(url.searchParams.get('case'), { subject: url.searchParams.get('subject') ?? undefined, older: url.searchParams.has('older'), mine: url.searchParams.has('mine') }),
    });
  });
  await context.route('https://example.net/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "require-trusted-types-for 'script'" },
      body: FIELDS_PAGE,
    }),
  );
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Elsewhere</title><p>Not Gmail</p>' }),
  );
  const dropped = new Set();
  await context.route('https://openrouter.ai/**', async (route) => {
    const request = route.request();
    const headers = request.headers();
    const path = new URL(request.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    // A slice of the live list (2026-11-11). Public, like the model lookup.
    if (path === '/api/v1/endpoints/zdr') {
      const endpoint = (provider, tag) => ({ name: `${provider} | anthropic/claude-haiku-5.5-20261015`, model_id: 'anthropic/claude-haiku-5.5', model_name: 'Anthropic: Claude Haiku 5.5', provider_name: provider, tag, safety_retention: false });
      const safety = { name: 'Google | meta/muse-spark-1.3-20260902', model_id: 'meta/muse-spark-1.3', model_name: 'Meta: Muse Spark 1.3', provider_name: 'Google', tag: 'google-vertex/global', safety_retention: true };
      const textOnly = { ...endpoint('Amazon Bedrock', 'amazon-bedrock'), name: 'Amazon Bedrock | example/reads-text', model_id: 'example/reads-text', model_name: 'Example: Reads Text' };
      return json(200, { data: [endpoint('Amazon Bedrock', 'amazon-bedrock'), endpoint('Google', 'google-vertex/global'), safety, textOnly] });
    }
    if (path.startsWith('/api/v1/models/')) {
      const id = ['anthropic/claude-haiku-5.5', 'example/keeps-data', 'meta/muse-spark-1.3', 'example/reads-text'].find((known) => path === `/api/v1/models/${known}/endpoints`);
      const input_modalities = id === 'example/reads-text' ? ['text'] : ['text', 'image', 'file'];
      return id
        ? json(200, { data: { id, architecture: { modality: 'text+image+file->text', input_modalities, output_modalities: ['text'] }, endpoints: [] } })
        : json(404, { error: { message: 'Not Found', code: 404 } });
    }
    if (headers.authorization !== 'Bearer sk-or-test-fake') return json(401, { error: { message: 'User not found.', code: 401 } });
    if (path === '/api/v1/key') return json(200, { data: { label: 'sk-or-...ake', limit: null, limit_remaining: null, usage: 0, is_free_tier: false } });
    const body = request.postDataJSON();
    // `prompt` is the first message: the thread, the draft and the first instruction.
    calls.push({ headers, body, prompt: textOf(body.messages[1].content) });
    // Folding a sent edit into the lessons.
    if (body.messages[0].content.startsWith('You keep a short list of lessons')) {
      return route.fulfill({ contentType: 'text/event-stream', body: sse(LESSONS, 'stop') }).catch(() => {});
    }
    const asked = textOf(body.messages.at(-1).content);
    const wait = /slowly/.test(asked) ? 1500 : delay;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    // A request the extension cancelled meanwhile has nothing left to answer.
    const answer = (text, finish) => route.fulfill({ contentType: 'text/event-stream', body: sse(text, finish) }).catch(() => {});
    if (/cut it off/.test(asked)) return answer('Hi Dana, pricing for 20 seats is', null);
    // The connection drops before any answer: once, or every time.
    if (/drop (once|always)/.test(asked) && (/always/.test(asked) || !dropped.has(asked))) {
      dropped.add(asked);
      return route.abort('connectionreset');
    }
    // An answer to a [blank] goes in its place.
    if (/<to_fill>/.test(asked) && /\$40/.test(asked)) return answer(SUGGESTED.replace('[price per seat]', '$40'));
    if (/elsewhere/.test(asked)) return route.fulfill({ contentType: 'text/event-stream', body: sse(SHORTER, 'stop', 'Example Cloud') }).catch(() => {});
    const reply = /Reply to them/.test(asked) ? `Template: Research share\n\n${SUGGESTED}` : /Write my reply/.test(asked) ? SUGGESTED : /Decline politely/.test(asked) ? DECLINED : /two options/i.test(asked) ? OPTIONS_REPLY : /the steps/.test(asked) ? STEPS : /\bPS\b/.test(asked) ? WITH_PS : /shorter/.test(asked) ? SHORTER : POLISHED;
    return answer(reply);
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://mail.google.com' });
  const early = await context.newPage();
  await early.goto('https://mail.google.com/mail/u/0/?case=fresh');
  const started = context.waitForEvent('serviceworker');
  await (await context.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: loaded });
  const worker = await started;
  const extensionId = new URL(worker.url()).host;
  // The local templates file was added on install; the tests below start without templates.
  let seeded;
  for (let i = 0; i < 50 && !seeded?.templates; i++) { seeded = await worker.evaluate(() => chrome.storage.local.get(['templates', 'templatesFile'])); await new Promise((r) => setTimeout(r, 100)); }
  assert.deepEqual(seeded.templates, JSON.parse(LOCAL_TEMPLATES));
  assert.equal(seeded.templatesFile, LOCAL_TEMPLATES);
  await worker.evaluate(() => chrome.storage.local.remove('templates'));

  // Same entry point as the toolbar button and the keyboard shortcut.
  const toggle = async (page) => {
    await page.bringToFront();
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      chrome.action.onClicked.dispatch(tab);
    });
  };
  const open = async (name, query = '') => {
    const page = await context.newPage();
    await page.goto(`https://mail.google.com/mail/u/0/?case=${name}${query}`);
    await page.locator('[g_editable="true"]').click();
    return page;
  };
  // Chrome reports an empty line (<div><br></div>) as two newlines.
  const shownText = async (page) => (await page.locator('.out').innerText()).replace(/\n{3,}/g, '\n\n');
  const draftText = (page) =>
    page.locator('[g_editable="true"]').evaluate((body) => body.innerText.replace(/\n{3,}/g, '\n\n'));
  const draftHtml = (page) => page.locator('[g_editable="true"]').evaluate((body) => body.innerHTML);
  // The signature or quoted mail, with every wrapper Gmail put around it.
  const tailHtml = (page) =>
    page.locator('[g_editable="true"]').evaluate((body) => {
      let tail = body.querySelector('.gmail_signature, .gmail_quote');
      while (tail.parentElement !== body && !tail.previousSibling) tail = tail.parentElement;
      return tail.outerHTML;
    });
  const signatures = (page) => page.locator('[g_editable="true"] .gmail_signature').count();
  // Selects some text in the draft, the way a mouse would, so typing replaces it.
  const selectInDraft = (page, text) =>
    page.locator('[g_editable="true"]').evaluate((body, text) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const at = node.data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return;
      }
      throw new Error(`"${text}" is not in the draft`);
    }, text);
  const keptEdits = () => worker.evaluate(async () => (await chrome.storage.local.get('edits')).edits ?? []);
  const waitFor = async (check, what) => {
    for (let waited = 0; waited < 3000; waited += 50) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  // Stands in for Chrome's speech recognizer, in the panel's own script world.
  // `local` hears "make it shorter" on this device, `unavailable` has no
  // model for the language, and `none` is a browser without the on-device API.
  const fakeVoice = async (page, mode) => {
    await page.bringToFront();
    await worker.evaluate(async (mode) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [mode],
        func: (mode) => {
          if (mode === 'none') {
            globalThis.SpeechRecognition = undefined;
            globalThis.webkitSpeechRecognition = undefined;
            return;
          }
          class Recognition {
            static available = async () => (mode === 'local' ? 'available' : 'unavailable');
            static install = async () => false;
            #local = false;
            get processLocally() {
              return this.#local;
            }
            set processLocally(value) {
              this.#local = value === true;
            }
            start() {
              const phrases = (this.phrases ?? []).map((p) => [p.phrase, p.boost]);
              document.documentElement.dataset.heard = JSON.stringify({ lang: this.lang, local: this.processLocally, continuous: this.continuous, phrases });
              const results = [];
              const say = (transcript, at) =>
                setTimeout(() => {
                  results.push([{ transcript }]);
                  this.onresult?.({ results });
                }, at);
              say('make it', 60);
              say(' shorter', 140);
            }
            stop() {
              setTimeout(() => this.onend?.(), 40);
            }
            abort() {
              setTimeout(() => this.onend?.(), 0);
            }
          }
          globalThis.SpeechRecognition = undefined;
          globalThis.webkitSpeechRecognition = Recognition;
          globalThis.SpeechRecognitionPhrase = class {
            constructor(phrase, boost) {
              Object.assign(this, { phrase, boost });
            }
          };
        },
      });
    }, mode);
  };
  const test = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  };

  await test('without a key, the panel says so and offers Options', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'Add your OpenRouter API key to start.');
    assert.equal(await page.getByRole('button', { name: 'Open Options' }).isVisible(), true);
    assert.equal(calls.length, 0);
    await shot(page, 'panel-no-key');
    // Options is always one click away from the panel.
    const [options] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Options', exact: true }).click(),
    ]);
    assert.match(options.url(), /\/options\.html$/);
    await options.close();
    await page.close();
  });

  await test('Options saves as you go and checks the key and model', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const label = (name) => page.getByLabel(name, { exact: true });
    const stored = () => worker.evaluate(() => chrome.storage.local.get(null));
    const problem = page.locator('#check.bad');
    await shot(page, 'options-first-open');
    // There is nothing to press: the page has no Save button.
    assert.equal(await page.getByRole('button', { name: 'Save' }).count(), 0);
    assert.equal(await label('OpenRouter API key').evaluate((el) => el === document.activeElement), true);

    await label('OpenRouter API key').fill('wrong-key');
    await label('Model').focus();
    await problem.waitFor();
    assert.equal(await problem.innerText(), 'OpenRouter rejected the API key.');
    assert.equal((await stored()).openRouterKey, 'wrong-key');

    // An Anthropic-style model name is not an OpenRouter model ID.
    await label('OpenRouter API key').fill('sk-or-test-fake');
    await label('Model').fill('claude-opus-5-5');
    await label('About you').focus();
    await page.locator('#check.bad', { hasText: 'no model' }).waitFor();
    assert.equal(await problem.innerText(), 'OpenRouter has no model called "claude-opus-5-5".');
    // Edits go only to providers that keep no data, so a model none of them runs would always fail.
    await label('Model').fill('example/keeps-data');
    await label('About you').focus();
    await page.locator('#check.bad', { hasText: 'zero data retention' }).waitFor();
    assert.equal(await problem.innerText(), 'No provider runs "example/keeps-data" with zero data retention. Pick another model.');
    // Zero retention with Google's abuse checks ("Safety Retention") still keeps data, so it does not count.
    await label('Model').fill('meta/muse-spark-1.3');
    await label('About you').focus();
    await page.locator('#check.bad', { hasText: 'muse-spark' }).waitFor();
    await page.getByRole('button', { name: 'Restore the default model' }).click();
    await problem.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#check').innerText(), '');
    assert.equal(await label('Model').inputValue(), 'anthropic/claude-haiku-5.5');
    assert.equal(await page.getByRole('button', { name: 'Restore the default model' }).isVisible(), false);
    // Emptied, a field shows its default again.
    await label('Model').fill('');
    await label('About you').focus();
    assert.equal(await label('Model').inputValue(), 'anthropic/claude-haiku-5.5');

    // The everyday settings are up front; the rest wait under Advanced.
    assert.equal(await label('How it edits').isVisible(), false);
    await page.getByText('Advanced').click();
    assert.match(await label('How it edits').inputValue(), /^Keep my meaning, facts, names, numbers/);
    assert.match(await label('Suggested reply').inputValue(), /^Write my reply to the latest message/);
    assert.match(await page.locator('#contract').innerText(), /^You edit email drafts[\s\S]*Only <instruction> is\.$/);
    await label('About you').fill('I am Sam. I run sales at Acme.');
    await label('How it edits').fill('Keep every number. Never add a promise.');
    // Typing saves after a pause, without leaving the field.
    await label('How you write').fill('Short sentences. No hype.');
    assert.equal(await page.getByRole('button', { name: 'Restore the default voice' }).isVisible(), true);
    await page.locator('#status', { hasText: 'Saved' }).waitFor();
    await waitFor(async () => (await stored()).rules === 'Short sentences. No hype.', 'the voice to save');
    // A wide window shows every setting at once, in two columns. A narrow one stacks them.
    await page.locator('summary').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight);
    const left = (id) => page.locator(id).evaluate((node) => Math.round(node.getBoundingClientRect().left));
    assert.equal(await fits(), true, 'nothing to scroll at 1440 × 900');
    assert.ok((await left('#about')) > (await left('#openRouterKey')) + 300, 'the voice sits beside the key');
    await shot(page, 'options-wide');
    await page.setViewportSize({ width: 720, height: 900 });
    assert.equal(await left('#about'), await left('#openRouterKey'));
    await shot(page, 'options-narrow', { fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('summary').click();
    await shot(page, 'options-saved', { whole: true });
    await page.locator('#status:empty').waitFor({ state: 'attached', timeout: 4000 });
    const saved = await stored();
    assert.equal(saved.openRouterKey, 'sk-or-test-fake');
    assert.equal(saved.model, undefined, 'a default is not stored, so a better one later reaches it');
    assert.equal(saved.replyOnOpen, undefined);
    assert.equal(saved.about, 'I am Sam. I run sales at Acme.');
    assert.equal(saved.principles, 'Keep every number. Never add a promise.');

    // Opened again, it checks the saved key quietly and shows no problem.
    await page.reload();
    await label('OpenRouter API key').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await problem.count(), 0);
    assert.equal(await label('About you').inputValue(), 'I am Sam. I run sales at Acme.');
    await page.close();
  });

  await test('new message: polish, two more changes, replace, undo', async () => {
    const page = await open('fresh');
    const original = await draftHtml(page);
    const signature = await tailHtml(page);
    // The mock page enforces Trusted Types the way Gmail does.
    const sink = await page.evaluate(() => {
      try {
        document.createElement('div').innerHTML = '<b>x</b>';
        return 'allowed';
      } catch {
        return 'blocked';
      }
    });
    assert.equal(sink, 'blocked');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await shownText(page), rendered(POLISHED));
    assert.equal(await page.locator('.out b').innerText(), '$40/seat');
    assert.equal(await page.locator('.out a').getAttribute('href'), 'https://example.com/pricing');
    await shot(page, 'panel-first-pass');
    await shot(page, 'panel-in-gmail', { clip: { x: 40, y: 12, width: 1200, height: 500 } });

    const { headers, body, prompt } = calls.at(-1);
    assert.equal(headers.authorization, 'Bearer sk-or-test-fake');
    assert.equal(body.model, 'anthropic/claude-haiku-5.5');
    assert.equal(body.stream, true);
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.deepEqual(body.provider, { zdr: true, data_collection: 'deny', only: ['amazon-bedrock', 'google-vertex/global'] }, 'only endpoints that keep no data');
    assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
    // The system message is the fixed contract, then the writer's own settings from Options.
    const system = body.messages[0].content;
    assert.match(system, /^You edit email drafts/);
    assert.match(system, /Never guess a fact[\s\S]*\[what is needed\] in square brackets/);
    assert.match(system, /<about_the_writer>\nI am Sam\. I run sales at Acme\.\n<\/about_the_writer>/);
    assert.match(system, /<how_to_edit>\nKeep every number\. Never add a promise\.\n<\/how_to_edit>/);
    assert.match(system, /<voice>\nShort sentences\. No hype\.\n<\/voice>/);
    assert.doesNotMatch(system, /Keep my meaning/, 'the default it replaced is not sent');
    assert.match(prompt, /<draft>\nhey dana,\n\nthx for reaching out\. pricing for 20 seats is \*\*\$40\/seat\*\*, see \[our pricing page\]\(https:\/\/example\.com\/pricing\)\.\n\nlmk if u want a call\n<\/draft>/);
    assert.match(prompt, /<message from="Dana Lee <dana@example\.com>" date="Nov 8, 2026, 9:14 AM">\nHi Sam,\n\nCan you send pricing for 20 seats\?\n<\/message>/);
    assert.doesNotMatch(prompt, /older quoted message|Sam Rivera/);
    assert.match(prompt, /<to>Dana Lee <dana@example\.com><\/to>/);
    assert.match(prompt, /<subject>Re: Pricing question<\/subject>/);
    assert.match(prompt, /<instruction>\nPolish this draft/);

    // Typing in the panel must not reach the page's shortcut handlers.
    await page.evaluate(() => (window.__keys.length = 0));
    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__keys), []);
    // Each change sends the whole conversation, so "undo that" has something to go back to.
    const second = calls.at(-1).body.messages;
    assert.deepEqual(second.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(second[1].content, prompt);
    assert.equal(second[2].content, POLISHED);
    assert.equal(second[3].content, '<instruction>\nshorter\n</instruction>');
    assert.equal(await shownText(page), rendered(SHORTER));

    await page.keyboard.type('add a PS about the free trial');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: 'PS: the trial is free.' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const third = calls.at(-1).body.messages;
    assert.deepEqual(third.map((m) => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    assert.equal(third[4].content, SHORTER);
    assert.equal(third[5].content, '<instruction>\nadd a PS about the free trial\n</instruction>');
    assert.equal(await shownText(page), rendered(WITH_PS));
    assert.equal(await page.locator('[data-draft-editor] textarea').getAttribute('placeholder'), 'Ask for another change');
    await shot(page, 'panel-third-version');

    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.__keys), [], 'the Enter that replaces never reaches the page');
    const text = await draftText(page);
    assert.match(text, /^Hi Dana,\n\n20 seats is \$40\/seat: our pricing page\.\n\n- Sam\n\nPS: the trial is free\.\n\nSam Rivera/);
    assert.doesNotMatch(text, /thx|lmk/);
    assert.equal(await tailHtml(page), signature, 'the signature markup is untouched');
    assert.equal(await page.locator('[g_editable="true"] a[href="https://example.com/pricing"]').innerText(), 'our pricing page');
    assert.equal(await page.locator('[g_editable="true"] b').innerText(), '$40/seat');
    assert.equal(await page.locator('[g_editable="true"] ul').count(), 0, 'a lone "- Sam" is not a list');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('g_editable')), 'true');

    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await draftHtml(page), original, 'undo restores the draft exactly');
    await page.close();
  });

  await test('opened again after a replace, it carries on the same conversation', async () => {
    const page = await open('fresh');
    const signature = await tailHtml(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const first = calls.at(-1).prompt;
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });

    // The draft is now the panel's own text: it waits instead of polishing that again.
    const before = calls.length;
    await toggle(page);
    await page.locator('.hint', { hasText: 'Enter runs it' }).waitFor();
    assert.equal(await page.locator('[data-draft-editor] textarea').getAttribute('placeholder'), 'Ask for another change');
    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(calls.length, before + 1);
    const messages = calls.at(-1).body.messages;
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(messages[1].content, first, 'the original draft is still where the conversation starts');
    assert.equal(messages[2].content, POLISHED);
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftText(page), /^Hi Dana,\n\n20 seats is \$40\/seat: our pricing page\.\n\n- Sam\n\nSam Rivera/);
    assert.equal(await tailHtml(page), signature);

    // Once the user changes the draft by hand it is a new draft, polished from scratch.
    await page.keyboard.type(' Thanks!');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.deepEqual(calls.at(-1).body.messages.map((m) => m.role), ['system', 'user']);
    assert.match(calls.at(-1).prompt, /<draft>\nHi Dana,[\s\S]*Thanks![\s\S]*<\/draft>/);
    await page.close();
  });

  await test('a change that fails keeps the last version and the instruction', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.type('cut it off');
    await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'The edit was cut off before it finished. Try again.');
    // Half an email is never offered as the result. The last full version still is.
    assert.equal(await shownText(page), rendered(POLISHED));
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isVisible(), true);
    assert.equal(await page.locator('[data-draft-editor] textarea').inputValue(), 'cut it off');
    await shot(page, 'panel-failed-change');

    // The instruction came back selected: typing replaces it.
    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    const messages = calls.at(-1).body.messages;
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user'], 'the failed change left no trace');
    assert.equal(messages[3].content, '<instruction>\nshorter\n</instruction>');
    await page.close();
  });

  await test('a dropped connection is tried once more; only a second drop says so', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const before = calls.length;
    await page.keyboard.type('shorter, drop once');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(calls.length - before, 2, 'the same request, sent twice');

    await page.keyboard.type('drop always');
    await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'Could not reach OpenRouter. Check your connection and try again.');
    assert.equal(calls.length - before, 4, 'tried twice, not more');
    await page.close();
  });

  await test('while it works the last version stays, and Esc cancels', async () => {
    const page = await open('fresh');
    const before = await draftText(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.type('slowly, make it shorter');
    await page.keyboard.press('Enter');
    await page.locator('.hint', { hasText: 'Working' }).waitFor();
    assert.equal(await shownText(page), rendered(POLISHED));
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isVisible(), false);
    await page.waitForTimeout(400);
    await shot(page, 'panel-working');
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.equal(await draftText(page), before);
    await page.close();
  });

  await test('reading a thread, it suggests a reply, then writes it into the reply box', async () => {
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=none');
    await toggle(page);
    await page.getByRole('button', { name: 'Copy' }).waitFor();
    assert.equal(await shownText(page), rendered(SUGGESTED));
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isDisabled(), true);
    assert.equal(await page.locator('.note').innerText(), 'To write it in, open a reply and click into it. Type what goes in the [brackets], or fill them in before you send.');
    const { prompt } = calls.at(-1);
    assert.match(prompt, /<message from="Dana Lee <dana@example\.com>"[^>]*>\nHi Sam,\n\nCan you send pricing for 20 seats\?\n<\/message>/);
    assert.match(prompt, /<subject>Pricing question<\/subject>\n\n<draft>\n\n<\/draft>\n\n<instruction>\nWrite my reply to the latest message/);
    await shot(page, 'panel-thread-suggestion');

    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Copy' }).waitFor();

    // Gmail's Reply opens the box with the cursor in it. That moves the
    // panel there with the suggestion ready, and asks the model nothing new.
    const before = calls.length;
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByRole('button', { name: 'Replace draft', disabled: false }).waitFor();
    assert.equal(await shownText(page), rendered(SHORTER));
    assert.equal(await page.locator('[data-draft-editor] textarea').getAttribute('placeholder'), 'Ask for another change');
    assert.equal(calls.length, before);
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftText(page), /^Hi Dana,\n\n20 seats is \$40\/seat: our pricing page\.\n\n- Sam\nSam Rivera/);
    await page.close();
  });

  await test('a suggestion still being written moves to the reply box, asked once', async () => {
    delay = 1500;
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=none');
    const before = calls.length;
    await toggle(page);
    await waitFor(async () => calls.length === before + 1, 'the suggestion to be asked for');
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByRole('button', { name: 'Replace draft', disabled: false }).waitFor();
    assert.equal(await shownText(page), rendered(SUGGESTED));
    assert.equal(calls.length, before + 1, 'not paid for twice');
    delay = PACE;
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('a change still being written moves to the reply box with its history', async () => {
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=none');
    await toggle(page);
    await page.getByRole('button', { name: 'Copy' }).waitFor();
    delay = 1500;
    const before = calls.length;
    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await waitFor(async () => calls.length === before + 1, 'the change to be asked for');
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByRole('button', { name: 'Replace draft', disabled: false }).waitFor();
    delay = PACE;
    assert.equal(await shownText(page), rendered(SHORTER));
    assert.equal(calls.length, before + 1, 'not paid for twice');
    await page.keyboard.type('add a PS');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: 'PS: the trial is free.' }).waitFor();
    const contents = calls.at(-1).body.messages.map((m) => m.content);
    assert.ok(contents.includes(SUGGESTED) && contents.includes(SHORTER), 'the next change sees both earlier versions');
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('with no thread and no draft, it says where to click, and a click into a draft starts it', async () => {
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=inbox');
    const before = calls.length;
    await toggle(page);
    assert.equal(await page.getByRole('alert').innerText(), 'Click into a draft.');
    assert.equal(calls.length, before);
    await shot(page, 'panel-no-draft');
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });

    // Two drafts open, so the panel cannot tell which one is meant.
    await page.evaluate(() => {
      for (const text of ['first draft', 'hi dana, sending the pricing over']) {
        const box = document.createElement('div');
        box.setAttribute('contenteditable', 'true');
        box.setAttribute('g_editable', 'true');
        box.textContent = text;
        // Clear of the panel, as a docked compose is.
        box.style.cssText = 'position: fixed; right: 20px; bottom: 20px; width: 200px;';
        if (text === 'first draft') box.style.bottom = '80px';
        document.body.append(box);
      }
    });
    await toggle(page);
    assert.equal(await page.getByRole('alert').innerText(), 'Click into a draft.');
    assert.equal(calls.length, before);
    await page.locator('[g_editable="true"]').last().click();
    await page.getByRole('button', { name: 'Replace draft', disabled: false }).waitFor();
    assert.equal(calls.length, before + 1);
    assert.match(calls.at(-1).prompt, /<draft>\nhi dana, sending the pricing over\n<\/draft>/);
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('reopened draft: signature inside the wrapper survives', async () => {
    const page = await open('reopened');
    const signature = await tailHtml(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).click();
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    const text = await draftText(page);
    assert.match(text, /^Hi Dana,[\s\S]*Happy to jump on a call\.\n\n- Sam\n\nSam Rivera/);
    assert.doesNotMatch(text, /thx/);
    assert.equal(await tailHtml(page), signature);
    await page.close();
  });

  await test('bare text, a typed instruction, and a real list', async () => {
    const page = await open('bare');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.match(calls.at(-1).prompt, /<draft>\nhey dana,\n\nthx for reaching out\n<\/draft>/);
    await page.keyboard.type('offer two options');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: 'Which works?' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).click();
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.deepEqual(await page.locator('[g_editable="true"] ul li').allInnerTexts(), ['Monthly at $40 <per seat>', 'Annual at $32']);
    assert.match(await draftText(page), /^Hi Dana,\n\nTwo options:[\s\S]*Which works\?\s*$/);
    await page.close();
  });

  await test('forward: quoted mail is neither sent as the draft nor replaced', async () => {
    const page = await open('forward', '&subject=Fwd%3A%20Pricing%20question');
    const quoted = await tailHtml(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.match(calls.at(-1).prompt, /<draft>\nfyi see below\n<\/draft>/);
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    const text = await draftText(page);
    assert.match(text, /^Hi Dana,[\s\S]*- Sam\n\n-+ Forwarded message -+\nFrom: Dana Lee[\s\S]*Original pricing question/);
    assert.doesNotMatch(text, /fyi see below/);
    assert.equal(await tailHtml(page), quoted);
    await page.close();
  });

  await test('empty reply: suggests one at once, with blanks to fill in', async () => {
    const page = await open('empty');
    const signature = await tailHtml(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await shownText(page), rendered(SUGGESTED));
    assert.equal(await page.locator('.note').innerText(), 'Type what goes in the [brackets], or fill them in before you send.');
    assert.deepEqual(await page.locator('.out mark').allInnerTexts(), ['[price per seat]']);
    assert.equal(await page.locator('[data-draft-editor] textarea').getAttribute('placeholder'), 'Answer the [brackets], or ask for a change');
    assert.match(calls.at(-1).prompt, /<thread>[\s\S]*Can you send pricing[\s\S]*<draft>\n\n<\/draft>\n\n<instruction>\nWrite my reply to the latest message/);
    await shot(page, 'panel-suggested-reply');
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftText(page), /^Hi Dana,\n\nHappy to help\. For 20 seats it is \[price per seat\] a month\.\n\n- Sam\nSam Rivera/);
    assert.equal(await tailHtml(page), signature);
    await page.close();
  });

  await test('the next message answers the blanks: a click names one, and the model is told which are open', async () => {
    const page = await open('empty');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.locator('.out mark').click();
    const box = page.locator('[data-draft-editor] textarea');
    assert.equal(await box.inputValue(), 'price per seat: ');
    await page.keyboard.type('$40');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: 'it is $40 a month' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(calls.at(-1).body.messages.at(-1).content, '<to_fill>\n[price per seat]\n</to_fill>\n\n<instruction>\nprice per seat: $40\n</instruction>');
    assert.equal(await page.locator('.out mark').count(), 0);
    assert.equal(await page.locator('.note').isHidden(), true);
    assert.equal(await box.getAttribute('placeholder'), 'Ask for another change');
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('empty new message: waits for an instruction, then writes', async () => {
    const page = await open('empty', '&subject=Intro');
    const signature = await tailHtml(page);
    const before = calls.length;
    await toggle(page);
    await page.locator('.hint', { hasText: 'Enter runs it' }).waitFor();
    assert.equal(await page.locator('[data-draft-editor] textarea').getAttribute('placeholder'), 'Say what to write');
    await shot(page, 'panel-empty-reply');
    await page.keyboard.press('Enter');
    assert.equal(calls.length, before, 'nothing is sent without an instruction');
    await page.keyboard.type('say yes and share pricing');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.match(calls.at(-1).prompt, /<draft>\n\n<\/draft>[\s\S]*<instruction>\nsay yes and share pricing\n<\/instruction>/);
    assert.doesNotMatch(calls.at(-1).prompt, /<thread>/);
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    // Like typing on that line: the text sits right above the signature.
    assert.match(await draftText(page), /^Hi Dana,[\s\S]*- Sam\nSam Rivera/);
    assert.doesNotMatch(await draftText(page), /Help me write/);
    assert.equal(await tailHtml(page), signature);
    await page.close();
  });

  await test('a draft with an image can be copied but not replaced', async () => {
    const page = await open('image');
    await toggle(page);
    await page.locator('.note', { hasText: 'image or table' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isDisabled(), true);
    await shot(page, 'panel-copy-only');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[g_editable="true"] img').count(), 1);
    assert.match(await draftText(page), /see the chart/);
    assert.equal(await page.getByRole('button', { name: 'Copy' }).isVisible(), true);
    await page.close();
  });

  await test('no line to write on: the result stays on screen to copy', async () => {
    const page = await open('signatureOnly');
    const original = await draftHtml(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).click();
    await page.locator('.note', { hasText: 'Could not write into this draft' }).waitFor();
    assert.equal(await shownText(page), rendered(SHORTER));
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isDisabled(), true);
    assert.equal(await draftHtml(page), original);
    await page.getByRole('button', { name: 'Copy' }).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor();
    const copied = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
    });
    assert.match(copied.html, /<b>\$40\/seat<\/b>.*<a href="https:\/\/example\.com\/pricing">our pricing page<\/a>/);
    assert.equal(copied.text, SHORTER);
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await page.close();
  });

  await test('a draft on another subject does not send the open thread', async () => {
    const page = await open('fresh', '&subject=Intro');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.doesNotMatch(calls.at(-1).prompt, /<thread>|Can you send pricing/);
    await page.close();
  });

  await test('on a thread, a draft docked beside it is left alone', async () => {
    const page = await open('fresh', '&subject=Intro');
    const before = await draftHtml(page);
    // The cursor leaves the draft for the thread.
    await page.locator('h2.hP').click();
    await toggle(page);
    await page.getByRole('button', { name: 'Copy' }).waitFor();
    assert.match(calls.at(-1).prompt, /<thread>[\s\S]*Can you send pricing[\s\S]*<draft>\n\n<\/draft>/);
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await draftHtml(page), before);
    await page.close();
  });

  await test('typing in the draft while the panel is open turns Replace off', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.locator('[g_editable="true"]').evaluate((body) => {
      body.focus();
      document.execCommand('insertText', false, 'P.S. one more thing. ');
    });
    const typed = await draftHtml(page);
    await page.getByRole('button', { name: 'Replace draft' }).click();
    await page.locator('.note', { hasText: 'The draft changed while this was open' }).waitFor();
    assert.equal(await draftHtml(page), typed, 'what was typed is kept');
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('bold around a link keeps the link, and bold lines stay lines', async () => {
    const page = await open('boldLink');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.match(calls.at(-1).prompt, /<draft>\nhi dana,\n\*\*\[book a call\]\(https:\/\/example\.com\/call\)\*\*\n\*\*Monday\*\*\n\*\*Tuesday\*\*\n<\/draft>/);
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('bold keeps its spaces and blank lines, and an emoji is text', async () => {
    const page = await open('boldSpaces');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft', disabled: false }).waitFor();
    assert.match(calls.at(-1).prompt, /<draft>\nhi dana,\n\*\*Agenda\*\*\n\nItem one \*\*Note:\*\* call me 👍\n<\/draft>/);
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('a numbered list that carries on keeps its numbers', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.type('list the steps');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: 'Invite the team' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftHtml(page), /<ol start="3"><li>Invite the team<\/li><li>Start<\/li><\/ol>/);
    await page.close();
  });

  await test('Tab goes round the panel and never into Gmail', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const where = () => page.evaluate(() => {
      const host = document.querySelector('[data-draft-editor]');
      const active = document.activeElement === host ? host.shadowRoot.activeElement : document.activeElement;
      return active?.getAttribute('aria-label') || active?.textContent || active?.tagName;
    });
    assert.equal(await where(), 'Instruction');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await where(), 'Replace draft');
    await page.keyboard.press('Tab');
    assert.equal(await where(), 'Instruction');
    assert.equal(await page.locator('[role="dialog"]').getAttribute('aria-modal'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await page.close();
  });

  await test('Esc puts the cursor back where it was', async () => {
    const page = await open('fresh');
    await selectInDraft(page, 'lmk');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => getSelection().toString()), 'lmk');
    await page.close();
  });

  await test('Esc closes, hands focus back, and leaves the draft alone', async () => {
    const page = await open('fresh');
    const before = await draftText(page);
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.evaluate(() => (window.__keys.length = 0));
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.__keys), [], 'the Esc that closes the panel never reaches the page');
    assert.equal(await draftText(page), before);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('g_editable')), 'true');
    await toggle(page);
    await page.locator('[data-draft-editor]').waitFor();
    await toggle(page);
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await page.close();
  });

  await test('Ready on Reply: opening a reply writes one, with the whole thread read', async () => {
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=none&older=1');
    const before = calls.length;
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    const ready = page.getByRole('button', { name: /^Reply ready/ });
    await ready.waitFor();
    assert.equal(calls.length, before + 1);
    // The collapsed message was expanded and read, oldest first.
    const { prompt } = calls.at(-1);
    assert.match(prompt, /<thread>\n<message from="Lee Park <lee@example\.com>" date="Nov 7, 2026, 4:02 PM">\nHi Dana, looping in Sam for pricing\.\n<\/message>\n<message from="Dana Lee/);
    assert.match(prompt, /<draft>\n\n<\/draft>\n\n<instruction>\nWrite my reply to the latest message/);
    assert.equal(await page.getByRole('button', { name: 'Collapse all' }).count(), 1);
    // The cursor stays in the reply, so writing your own is one keystroke away.
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('g_editable')), 'true');
    await shot(page, 'pill-ready');

    // One click shows it, already written, with what it took and cost.
    await ready.click();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(calls.length, before + 1, 'nothing is asked twice');
    assert.equal(await shownText(page), rendered(SUGGESTED));
    assert.equal(await page.locator('[data-rhada-pill]').count(), 0);
    assert.match(await page.locator('.meta').innerText(), /^\d+\.\d s · 1\.2¢$/);
    await shot(page, 'panel-ready-on-reply');
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftText(page), /^Hi Dana,\n\nHappy to help\. For 20 seats it is \[price per seat\] a month\.\n\n- Sam\nSam Rivera/);
    await page.close();
  });

  await test('Ready on Reply stops when you type, and stays quiet when off', async () => {
    delay = 1500;
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=none');
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByRole('button', { name: /^Writing a reply/ }).waitFor();
    await shot(page, 'pill-writing');
    await page.keyboard.type('Thanks Dana, ');
    await page.locator('[data-rhada-pill]').waitFor({ state: 'detached' });
    delay = PACE;
    // The panel then works on what was typed, not on the reply it dropped.
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.match(calls.at(-1).prompt, /<draft>\nThanks Dana,\n<\/draft>\n\n<instruction>\nPolish this draft/);
    assert.equal(await shownText(page), rendered(POLISHED));
    await page.close();

    await worker.evaluate(() => chrome.storage.local.set({ replyOnOpen: false }));
    const off = await context.newPage();
    await off.goto('https://mail.google.com/mail/u/0/?case=none&older=1');
    const before = calls.length;
    await off.getByRole('button', { name: 'Reply', exact: true }).click();
    await off.waitForTimeout(800);
    assert.equal(calls.length, before, 'nothing is sent until asked');
    assert.equal(await off.locator('[data-rhada-pill]').count(), 0);
    assert.equal(await off.locator('.kv').count(), 1, 'the thread is left as it was');
    await toggle(off);
    await off.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await shownText(off), rendered(SUGGESTED));
    assert.equal(calls.length, before + 1);
    await off.close();
    await worker.evaluate(() => chrome.storage.local.set({ replyOnOpen: true }));

    // Esc on a reply the panel was writing is a no: closing it starts nothing else.
    delay = 1500;
    const esc = await context.newPage();
    await esc.goto('https://mail.google.com/mail/u/0/?case=none');
    const first = calls.length;
    await esc.getByRole('button', { name: 'Reply', exact: true }).click();
    await toggle(esc);
    await esc.locator('[data-draft-editor] .card.loading').waitFor();
    await esc.keyboard.press('Escape');
    await esc.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await esc.waitForTimeout(1000);
    assert.ok(calls.length - first <= 1, 'one request at most, the one Esc cancelled');
    assert.equal(await esc.locator('[data-rhada-pill]').count(), 0);
    delay = PACE;
    await esc.close();
  });

  await test('one-tap replies on a reply, and none on a draft with text', async () => {
    const page = await open('empty');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.deepEqual(await page.locator('.chips button').allInnerTexts(), ['Yes', 'Decline politely', 'Ask a question', 'Propose times']);
    await shot(page, 'panel-quick-replies');
    await page.getByRole('button', { name: 'Decline politely' }).click();
    await page.locator('.out', { hasText: "We can't take on 20 seats" }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const messages = calls.at(-1).body.messages;
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(messages.at(-1).content, '<to_fill>\n[price per seat]\n</to_fill>\n\n<instruction>\nDecline politely.\n</instruction>');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA', 'the box keeps the cursor for the next change');
    await page.close();

    const draft = await open('fresh');
    await toggle(draft);
    await draft.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await draft.locator('.chips').isVisible(), false);
    await draft.close();
  });

  await test('when the writer sent the last message, an empty reply is a follow-up', async () => {
    const page = await open('empty', '&mine');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const prompt = calls.at(-1).prompt;
    assert.match(prompt, /<message from="Sam Rivera <Sam@example.com>" date="[^"]*" writer="yes">/);
    assert.match(prompt, /<message from="Dana Lee <dana@example.com>" date="[^"]*">/);
    assert.match(prompt, /<instruction>\nMy last message has no answer yet\./);
    assert.deepEqual(await page.locator('.chips button').allInnerTexts(), ['Follow up', 'One-line nudge', 'Propose times']);
    await page.close();
  });

  await test('a changed draft sent with Schedule send is learned from, in any language', async () => {
    await worker.evaluate(() => chrome.storage.local.remove(['edits', 'lessons']));
    const page = await open('empty');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await selectInDraft(page, 'Happy to help.');
    await page.keyboard.type('Glad to.');
    await page.getByRole('button', { name: 'More send options' }).click();
    await page.getByRole('menuitem', { name: 'Programar envío' }).click();
    assert.equal(await page.evaluate(() => window.__sent), 0, 'nothing is sent until a time is picked');
    await waitFor(async () => (await keptEdits()).length === 1, 'the scheduled edit to be kept');
    assert.match((await keptEdits())[0].after, /Glad to\./);
    await waitFor(async () => (await worker.evaluate(() => chrome.storage.local.get('lessons'))).lessons === LESSONS, 'the lessons to update');
    await page.close();
  });

  await test('sending a changed draft teaches the next request; filling the blanks does not', async () => {
    await worker.evaluate(() => chrome.storage.local.remove(['edits', 'lessons']));
    const write = async (page) => {
      await toggle(page);
      await page.getByRole('button', { name: 'Replace draft' }).waitFor();
      await page.keyboard.press('Enter');
      await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    };

    // Only the [blank] filled in, sent with Cmd+Enter: nothing to learn.
    const filled = await open('empty');
    await write(filled);
    await selectInDraft(filled, '[price per seat]');
    await filled.keyboard.type('$40 a seat');
    await filled.keyboard.press('ControlOrMeta+Enter');
    assert.equal(await filled.evaluate(() => window.__sent), 1);
    await filled.waitForTimeout(400);
    assert.deepEqual(await keptEdits(), []);
    await filled.close();

    // A real change, sent with the Send button: kept, before and after.
    const changed = await open('empty');
    await write(changed);
    await selectInDraft(changed, 'Happy to help.');
    await changed.keyboard.type('Sure thing, glad you asked.');
    await changed.getByRole('button', { name: /^Send/ }).click();
    assert.equal(await changed.evaluate(() => window.__sent), 1);
    await waitFor(async () => (await keptEdits()).length === 1, 'the edit to be kept');
    const [edit] = await keptEdits();
    assert.equal(edit.before, 'Hi Dana,\n\nHappy to help. For 20 seats it is [price per seat] a month.\n\n- Sam');
    assert.equal(edit.after, 'Hi Dana,\n\nSure thing, glad you asked. For 20 seats it is [price per seat] a month.\n\n- Sam');
    await changed.close();

    // The edit is folded into the lessons, which go with every request after.
    await waitFor(async () => (await worker.evaluate(() => chrome.storage.local.get('lessons'))).lessons === LESSONS, 'the lessons to update');
    const fold = calls.at(-1).body;
    assert.match(fold.messages[1].content, /^<lessons>\n\(none yet\)\n<\/lessons>\n\n<before>\nHi Dana,[\s\S]*<after>\nHi Dana,\n\nSure thing/);
    assert.deepEqual(fold.provider, { zdr: true, data_collection: 'deny', only: ['amazon-bedrock', 'google-vertex/global'] });

    // The next request shows the model how the writer edits.
    const next = await open('fresh');
    await toggle(next);
    await next.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.match(calls.at(-1).body.messages[0].content, /<lessons>\n- Opens warmly and casually\.\n- Keeps replies short\.\n<\/lessons>/);
    assert.match(calls.at(-1).body.messages[0].content, /\n\n<past_edits>\n<edit>\n<before>\nHi Dana,\n\nHappy to help\.[\s\S]*<\/before>\n<after>\nHi Dana,\n\nSure thing, glad you asked\.[\s\S]*- Sam\n<\/after>\n<\/edit>\n<\/past_edits>$/);

    // Turned off: none are sent, and none are kept.
    await worker.evaluate(() => chrome.storage.local.set({ learnFromEdits: false }));
    await next.keyboard.type('shorter');
    await next.keyboard.press('Enter');
    await next.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await next.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.doesNotMatch(calls.at(-1).body.messages[0].content, /<edit>/);
    await next.keyboard.press('Enter');
    await next.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await next.keyboard.type(' Talk soon.');
    await next.keyboard.press('ControlOrMeta+Enter');
    await next.waitForTimeout(400);
    assert.equal((await keptEdits()).length, 1);
    await worker.evaluate(() => chrome.storage.local.set({ learnFromEdits: true }));
    await next.close();

    // Options says how many are kept, forgets them, and saves both switches.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#kept', { hasText: '1 edit kept.' }).waitFor();
    assert.equal(await options.locator('#lessons').inputValue(), LESSONS);
    // A new lesson shows up while Options is open.
    await worker.evaluate((lessons) => chrome.storage.local.set({ lessons }), `${LESSONS}\n- Signs off with a first name.`);
    await waitFor(async () => (await options.locator('#lessons').inputValue()).endsWith('first name.'), 'new lessons to show');
    const readyOnReply = options.getByRole('switch', { name: 'Ready on Reply' });
    assert.equal(await readyOnReply.isChecked(), true);
    assert.equal(await options.getByRole('switch', { name: 'Learn from my edits' }).isChecked(), true);
    await shot(options, 'options-automatic', { whole: true });
    await options.getByRole('button', { name: 'Forget them' }).click();
    await waitFor(async () => (await options.locator('#kept').innerText()) === '', 'the count to clear');
    assert.equal(await options.getByRole('button', { name: 'Forget them' }).isVisible(), false);
    assert.deepEqual(await keptEdits(), []);
    // A switch saves the moment it flips.
    await readyOnReply.click();
    await waitFor(async () => (await worker.evaluate(async () => (await chrome.storage.local.get('replyOnOpen')).replyOnOpen)) === false, 'the switch to save');
    await readyOnReply.click();
    await waitFor(async () => !('replyOnOpen' in (await worker.evaluate(() => chrome.storage.local.get('replyOnOpen')))), 'the default to clear');
    // Back on, which is the default, so nothing is stored.
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('replyOnOpen')).replyOnOpen), undefined);
    assert.equal(await readyOnReply.isChecked(), true);
    await options.close();
  });

  await test('the mic types what you say into the box, heard on this computer', async () => {
    const page = await open('fresh');
    await fakeVoice(page, 'local');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.getByRole('button', { name: 'Speak' }).click();
    await page.getByRole('button', { name: 'Stop speaking' }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-draft-editor] textarea').value === 'make it shorter');
    // On-device only, in the browser's language, listening for the names in the thread.
    const heard = JSON.parse(await page.evaluate(() => document.documentElement.dataset.heard));
    assert.deepEqual(heard, { lang: await page.evaluate(() => navigator.language), local: true, continuous: true, phrases: [['Dana Lee', 2]] });
    assert.match(await page.locator('.hint').innerText(), /^Listening/);
    await shot(page, 'panel-listening');
    // Enter waits for the last words, then runs them.
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(calls.at(-1).body.messages.at(-1).content, '<instruction>\nmake it shorter\n</instruction>');
    assert.equal(await page.getByRole('button', { name: 'Speak' }).isVisible(), true);
    await page.close();

    // No local model for the language: it says so once, and the mic goes away.
    const missing = await open('fresh');
    await fakeVoice(missing, 'unavailable');
    await toggle(missing);
    await missing.getByRole('button', { name: 'Replace draft' }).waitFor();
    await missing.getByRole('button', { name: 'Speak' }).click();
    await missing.getByRole('alert').filter({ hasText: "Voice isn't available in this browser. Type instead." }).waitFor();
    assert.equal(await missing.getByRole('button', { name: 'Speak' }).count(), 0);
    await missing.keyboard.type('s');
    assert.equal(await missing.getByRole('alert').count(), 0);
    await missing.close();

    // A browser that cannot promise on-device recognition gets no mic at all.
    const none = await open('fresh');
    await fakeVoice(none, 'none');
    await toggle(none);
    await none.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await none.getByRole('button', { name: 'Speak' }).count(), 0);
    await none.close();
  });

  await test('a model with no endpoint that keeps nothing is never asked', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ model: 'meta/muse-spark-1.3' }));
    const page = await open('fresh');
    const before = calls.length;
    await toggle(page);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'No provider runs "meta/muse-spark-1.3" with zero data retention. Pick another model in Options.');
    assert.equal(await page.getByRole('button', { name: 'Open Options' }).isVisible(), true);
    assert.equal(calls.length, before, 'nothing was sent');
    await worker.evaluate(() => chrome.storage.local.remove('model'));
    await page.close();
  });

  await test('an answer from a provider outside the list is never shown', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const before = await shownText(page);
    await page.keyboard.type('answer from elsewhere');
    await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'OpenRouter sent this to Example Cloud, which is not on the zero-retention list. Nothing was shown.');
    assert.equal(await shownText(page), before, 'the last version stays');
    await page.keyboard.press('Escape');
    await page.close();
  });

  // A small PNG, made in the page, pasted the way a screenshot is.
  const pasteImage = (page) =>
    page.locator('textarea[slot="input"]').evaluate(async (box) => {
      const canvas = new OffscreenCanvas(40, 30);
      const paint = canvas.getContext('2d');
      paint.fillStyle = '#c33';
      paint.fillRect(0, 0, 40, 30);
      const file = new File([await canvas.convertToBlob({ type: 'image/png' })], 'image.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
  const fixture = (name) => join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

  await test('a pasted screenshot goes to the model with its request, and stays with that turn', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await pasteImage(page);
    await page.locator('.file:not(.reading) canvas').waitFor();
    assert.equal(await page.locator('textarea[slot="input"]').inputValue(), '', 'the paste is not typed into the box');
    await page.keyboard.type('shorter');
    await shot(page, 'pasted-image');
    await page.keyboard.press('Enter');
    await page.locator('.file').waitFor({ state: 'detached' });
    await waitFor(async () => (await shownText(page)) === rendered(SHORTER), 'the shorter version');
    const sent = calls.at(-1).body;
    const [image] = partsOf(sent.messages.at(-1).content);
    assert.equal(image.type, 'image_url');
    assert.match(image.image_url.url, /^data:image\/png;base64,/);
    assert.equal(sent.plugins, undefined, 'no file reader for an image');
    assert.match(textOf(sent.messages.at(-1).content), /<instruction>\nshorter\n<\/instruction>/);
    // The next change still sees the image, in the turn it came with.
    await page.keyboard.type('Give two options');
    await page.keyboard.press('Enter');
    await waitFor(async () => calls.at(-1).body.messages.length === sent.messages.length + 2, 'the follow-up');
    const next = calls.at(-1).body.messages;
    assert.equal(partsOf(next.at(-1).content).length, 0, 'the new request has no image of its own');
    assert.equal(partsOf(next.at(-3).content)[0].image_url.url, image.image_url.url);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('Word and Excel are read here and sent as text, and a PDF goes to the model itself', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    const picker = page.locator('input[type="file"]');
    const file = (name, mimeType) => ({ name, mimeType, buffer: readFileSync(fixture(name)) });
    await picker.setInputFiles([file('table.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), file('prices.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), { name: 'terms.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') }]);
    await picker.setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Not this one.') }]);
    await waitFor(async () => (await page.locator('.file:not(.reading)').count()) === 4, 'four files read');
    await page.getByRole('button', { name: 'Remove notes.txt' }).click();
    assert.equal(await page.locator('.file').count(), 3);
    // An old Word file says what to do instead, and the others stay.
    await picker.setInputFiles([{ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('binary') }]);
    await waitFor(async () => (await page.getByRole('alert').innerText()) === "old.doc can't be read. Save it as a PDF, .docx or .xlsx and attach that.", 'the old file to be refused');
    assert.equal(await page.locator('.file').count(), 3);
    await shot(page, 'attachments');
    await page.locator('textarea[slot="input"]').fill('shorter');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await shownText(page)) === rendered(SHORTER), 'the shorter version');
    const sent = calls.at(-1).body;
    const text = textOf(sent.messages.at(-1).content);
    assert.match(text, /<attachment name="table\.docx">\nSeat pricing\nTier\tPrice\nTeam\t\$40 per seat/);
    assert.match(text, /<attachment name="prices\.xlsx">\nSheet: Pricing\nTier\tSeats\tPrice/);
    assert.doesNotMatch(text, /Not this one/);
    const [pdf] = partsOf(sent.messages.at(-1).content);
    assert.equal(pdf.type, 'file');
    assert.equal(pdf.file.filename, 'terms.pdf');
    assert.match(pdf.file.file_data, /^data:application\/pdf;base64,/);
    assert.deepEqual(sent.plugins, [{ id: 'file-parser', pdf: { engine: 'native' } }], 'the model reads the PDF itself');
    assert.equal(await page.getByRole('alert').count(), 0, 'the old problem is gone');
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('a model that cannot read images says so, and keeps the image for another try', async () => {
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await worker.evaluate(() => chrome.storage.local.set({ model: 'example/reads-text' }));
    await pasteImage(page);
    await page.locator('.file:not(.reading)').waitFor();
    const before = calls.length;
    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), `"example/reads-text" can't read images. Remove them, or pick a model that can in Options.`);
    assert.equal(await page.getByRole('button', { name: 'Open Options' }).isVisible(), true);
    assert.equal(calls.length, before, 'nothing was sent');
    assert.equal(await page.locator('.file').count(), 1, 'the image is back, ready to resend');
    assert.equal(await page.locator('textarea[slot="input"]').inputValue(), 'shorter');
    await worker.evaluate(() => chrome.storage.local.remove('model'));
    await page.locator('textarea[slot="input"]').focus();
    await page.keyboard.press('Enter');
    await waitFor(async () => (await shownText(page)) === rendered(SHORTER), 'the shorter version');
    assert.equal(partsOf(calls.at(-1).body.messages.at(-1).content)[0].type, 'image_url');
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('a rejected key shows the reason and a way to fix it', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ openRouterKey: 'revoked' }));
    const page = await open('fresh');
    await toggle(page);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'OpenRouter rejected the API key.');
    assert.equal(await page.getByRole('button', { name: 'Open Options' }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Replace draft' }).isVisible(), false);
    await page.close();
  });

  const site = async (box) => {
    await worker.evaluate(() => chrome.storage.local.set({ openRouterKey: 'sk-or-test-fake' }));
    const page = await context.newPage();
    await page.goto('https://example.net/compose');
    if (box) await page.locator(box).click();
    return page;
  };

  await test('on any site, a text box is polished, then written in as typed text that Cmd+Z undoes', async () => {
    const page = await site('#plain');
    const before = await page.locator('#plain').inputValue();
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await shot(page, 'any-site');
    const { prompt } = calls.at(-1);
    assert.match(prompt, /<page site="example\.net">Messages \| Example<\/page>/);
    assert.match(prompt, /<draft>\nhey dana, thx for reaching out/);
    assert.doesNotMatch(prompt, /<thread>/);
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#plain').inputValue(), POLISHED);
    assert.ok((await page.evaluate(() => window.inputs())) > 0, 'the page heard the input');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'plain');
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await page.locator('#plain').inputValue(), before);
    await page.close();
  });

  await test('on any site, an editor gets the text as a paste, and a plain editable box with its lines', async () => {
    const page = await site('#editor');
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.pasted), POLISHED);
    await page.locator('#editable').click();
    await toggle(page);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.equal((await page.locator('#editable').innerText()).replace(/\n{3,}/g, '\n\n'), rendered(POLISHED));
    assert.equal(await page.locator('#editable a').getAttribute('href'), 'https://example.com/pricing');
    await page.close();
  });

  await test('on any site, with no box chosen the panel waits, then moves onto the box clicked into', async () => {
    const page = await site();
    await toggle(page);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'Click into a text box.');
    await page.locator('#plain').click();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await page.locator('[data-draft-editor]').count(), 1);
    await page.keyboard.press('Escape');
    await page.close();
  });

  await test('on any site, Read this page sends the conversation around the box, and is remembered for the site', async () => {
    const page = await site('#reply');
    const asked = calls.length;
    await toggle(page);
    const chip = page.getByRole('button', { name: 'Read this page' });
    await chip.waitFor();
    assert.equal(await chip.getAttribute('aria-pressed'), 'false');
    await page.waitForTimeout(300);
    assert.equal(calls.length, asked, 'an empty box with the page off asks for nothing');
    await chip.click();
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await chip.getAttribute('aria-pressed'), 'true');
    await shot(page, 'read-page');
    const { prompt } = calls.at(-1);
    assert.match(prompt, /<on_page>\nDana Lee 9:12 AM\n\nHi! We are a team of 20[\s\S]*before Friday\.\n<\/on_page>/);
    assert.match(prompt, /<draft>\n\n<\/draft>/);
    assert.doesNotMatch(prompt, /hey dana/, 'only the part of the page around the box');
    await waitFor(async () => (await worker.evaluate(() => chrome.storage.local.get('pageSites'))).pageSites?.['example.net'], 'the site to be remembered');
    await page.close();

    // Opened again on the site, it reads the page and suggests a reply at once.
    const again = await site('#reply');
    await toggle(again);
    await again.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await again.getByRole('button', { name: 'Read this page' }).getAttribute('aria-pressed'), 'true');
    assert.match(calls.at(-1).prompt, /<on_page>/);
    await again.getByRole('button', { name: 'Read this page' }).click();
    await waitFor(async () => !(await worker.evaluate(() => chrome.storage.local.get('pageSites'))).pageSites?.['example.net'], 'the site to be forgotten');
    await again.keyboard.press('Escape');
    await again.close();
  });

  await test('templates are made in Options, and the panel menu writes with one or lets Rhada pick by "use when"', async () => {
    await worker.evaluate(() => chrome.storage.local.remove('templates'));
    const options = await context.newPage();
    await options.setViewportSize({ width: 1440, height: 900 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel('Facts to reuse').fill('Book a call: https://cal.example.com/sam');
    await waitFor(async () => (await worker.evaluate(() => chrome.storage.local.get('facts'))).facts === 'Book a call: https://cal.example.com/sam', 'the facts to save');
    await options.getByRole('button', { name: 'Add template' }).click();
    await options.getByLabel('Template name').fill('Research share');
    await options.getByLabel('Use when').fill('They replied with interest');
    await options.getByLabel('Template message').fill('Hi [first name],\n\nThese 3 stood out:\n[Company] - [why it fits]');
    await options.getByRole('button', { name: 'Add template' }).click();
    await options.getByLabel('Template name').nth(1).fill('Fellow names');
    await options.getByLabel('Template message').nth(1).fill('[Name], found your 3 fellow [Name]s.');
    await options.getByLabel('Template name').nth(0).focus();
    const stored = async () => (await worker.evaluate(() => chrome.storage.local.get('templates'))).templates;
    await waitFor(async () => (await stored())?.length === 2, 'both templates to save');
    assert.deepEqual((await stored())[0], { name: 'Research share', when: 'They replied with interest', text: 'Hi [first name],\n\nThese 3 stood out:\n[Company] - [why it fits]' });
    await shot(options, 'template-options', { whole: true });
    // Remove takes a card out of storage too.
    await options.getByLabel('Template name').nth(1).fill('Spare');
    await options.getByRole('button', { name: 'Add template' }).click();
    await options.getByLabel('Template name').nth(2).fill('Gone soon');
    await options.getByLabel('Template message').nth(2).fill('x');
    await waitFor(async () => (await stored())?.length === 3, 'the third template');
    await options.getByRole('button', { name: 'Remove template Gone soon' }).click();
    await waitFor(async () => (await stored())?.length === 2, 'the removal');
    await options.getByLabel('Template name').nth(1).fill('Fellow names');
    await waitFor(async () => (await stored())?.[1]?.name === 'Fellow names', 'the rename');
    await options.close();

    const page = await site('#reply');
    await toggle(page);
    const menu = page.getByRole('combobox', { name: 'Template' });
    await menu.waitFor();
    assert.deepEqual(await menu.locator('option').allTextContents(), ['Template: Auto', 'No template', 'Research share', 'Fellow names', 'Edit templates…']);
    // On Auto, a request carries the saved list with each "use when".
    let asked = calls.length;
    await page.locator('[data-draft-editor] textarea').fill('Reply to them');
    await page.keyboard.press('Enter');
    await waitFor(() => calls.length > asked, 'the auto request');
    assert.match(calls.at(-1).body.messages[0].content, /<facts>\nBook a call: https:\/\/cal\.example\.com\/sam\n<\/facts>/);
    await page.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(await page.getByRole('option', { name: 'Auto: Research share' }).count(), 1, 'the menu names the template Auto used');
    assert.doesNotMatch(await page.locator('[data-draft-editor]').evaluate((h) => h.shadowRoot.textContent), /Template: Research/, 'the marker line is never shown');
    assert.match(calls.at(-1).prompt, /<templates>\n<template name="Research share" use_when="They replied with interest">\nHi \[first name\],[\s\S]*<template name="Fellow names" use_when="not said">/);
    await page.keyboard.press('Escape');
    await page.close();

    const chosen = await site('#reply');
    await toggle(chosen);
    await chosen.getByRole('button', { name: 'Read this page' }).click();
    await chosen.getByRole('button', { name: 'Replace draft' }).waitFor();
    await chosen.locator('input[type="file"]').setInputFiles([{ name: 'prices.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(fixture('prices.xlsx')) }]);
    await waitFor(async () => (await chosen.locator('.file:not(.reading)').count()) === 1, 'the sheet to be read');
    asked = calls.length;
    await chosen.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'Research share' });
    await waitFor(() => calls.length > asked, 'the template request');
    await chosen.getByRole('button', { name: 'Replace draft' }).waitFor();
    await shot(chosen, 'template');
    const latest = () => textOf(calls.at(-1).body.messages.at(-1).content);
    const all = () => calls.at(-1).body.messages.map((m) => textOf(m.content)).join('\n');
    const prompt = latest();
    assert.match(prompt, /<attachment name="prices\.xlsx">\nSheet: Pricing/);
    assert.match(prompt, /<template name="Research share" chosen="yes">\nHi \[first name\],\n\nThese 3 stood out:\n\[Company\] - \[why it fits\]\n<\/template>\n\n(<to_fill>[\s\S]*<\/to_fill>\n\n)?<instruction>\nWrite it with my "Research share" template\.\n<\/instruction>/);
    assert.match(calls.at(-1).prompt, /<on_page>\nDana Lee/);
    assert.doesNotMatch(all(), /<templates>\n<template/, 'a chosen template replaces the list');
    assert.equal(await chosen.locator('.file').count(), 0, 'the sheet went with it');
    // A later change still has the template and the sheet in the conversation.
    await chosen.locator('[data-draft-editor] textarea').fill('Shorter');
    await chosen.keyboard.press('Enter');
    await waitFor(() => latest().includes('Shorter'), 'the change');
    assert.match(all(), /<template name="Research share" chosen="yes">[\s\S]*<instruction>\nShorter\n<\/instruction>$/);
    // No template sends neither.
    await chosen.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'No template' });
    await chosen.getByRole('button', { name: 'Read this page' }).click();
    await chosen.keyboard.press('Escape');
    await worker.evaluate(() => chrome.storage.local.remove(['templates', 'pageSites', 'facts']));
    await chosen.close();
  });

  await test('where Rhada cannot run, the shortcut goes to Gmail instead of opening Options', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ openRouterKey: 'sk-or-test-fake' }));
    const gmail = await open('fresh');
    const other = await context.newPage();
    await other.goto('https://example.com/');
    const pages = context.pages().length;
    await toggle(other);
    assert.equal(context.pages().length, pages, 'no Options tab');
    const activeUrl = () => worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url ?? '');
    await waitFor(async () => (await activeUrl()).startsWith('https://mail.google.com/'), 'Gmail to come forward');
    // Pressed again, it is over the Gmail tab it went to.
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      chrome.action.onClicked.dispatch(tab);
    });
    await gmail.locator('[data-draft-editor]').waitFor();
    await gmail.getByRole('button', { name: 'Replace draft' }).waitFor();
    await other.close();
    await gmail.close();
  });

  await test('a Gmail tab open before the extension loaded still gets the panel', async () => {
    await early.locator('[g_editable="true"]').click();
    const pages = context.pages().length;
    await toggle(early);
    await early.getByRole('button', { name: 'Replace draft' }).waitFor();
    assert.equal(context.pages().length, pages, 'no Options tab');
    await early.keyboard.press('Enter');
    await early.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftText(early), /^Hi Dana,[\s\S]*Happy to jump on a call\./);
    // The script added then is the only copy listening: one press opens, the next closes.
    await toggle(early);
    await early.locator('[data-draft-editor]').waitFor();
    assert.equal(await early.locator('[data-draft-editor]').count(), 1);
    await toggle(early);
    await early.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    await early.close();
  });

  console.log(`\n${passed} passed`);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
