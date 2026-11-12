// Loads the built extension into Chromium and drives it against a page that
// copies Gmail's compose and thread markup (captured from live Gmail on
// 2026-11-09; Send, Expand all and collapsed messages on 2026-11-11) and
// Gmail's Trusted Types policy. OpenRouter is stubbed: its
// error bodies were recorded from the live API, its stream follows its docs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lets context.route() see requests made by the extension's service worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { chromium } = await import('playwright');

const extension = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const profile = mkdtempSync(join(tmpdir(), 'draft-editor-test-'));

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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.closest('[g_editable="true"]')) send(e.target);
  });
</script>
</body></html>`;
}

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

// What the panel shows: links and bold rendered, not as markup.
const rendered = (text) => text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

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
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Elsewhere</title><p>Not Gmail</p>' }),
  );
  await context.route('https://openrouter.ai/**', async (route) => {
    const request = route.request();
    const headers = request.headers();
    const path = new URL(request.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    // A slice of the live list (2026-11-11). Public, like the model lookup.
    if (path === '/api/v1/endpoints/zdr') {
      const endpoint = (provider, tag) => ({ name: `${provider} | anthropic/claude-opus-5.5-20260921`, model_id: 'anthropic/claude-opus-5.5', model_name: 'Anthropic: Claude Opus 5.5', provider_name: provider, tag, safety_retention: false });
      const safety = { name: 'Google | meta/muse-spark-1.3-20260902', model_id: 'meta/muse-spark-1.3', model_name: 'Meta: Muse Spark 1.3', provider_name: 'Google', tag: 'google-vertex/global', safety_retention: true };
      return json(200, { data: [endpoint('Amazon Bedrock', 'amazon-bedrock'), endpoint('Google', 'google-vertex/global'), safety] });
    }
    if (path.startsWith('/api/v1/models/')) {
      return ['anthropic/claude-opus-5.5', 'example/keeps-data', 'meta/muse-spark-1.3'].some((id) => path === `/api/v1/models/${id}/endpoints`)
        ? json(200, { data: { id: 'anthropic/claude-opus-5.5', endpoints: [] } })
        : json(404, { error: { message: 'Not Found', code: 404 } });
    }
    if (headers.authorization !== 'Bearer sk-or-test-fake') return json(401, { error: { message: 'User not found.', code: 401 } });
    if (path === '/api/v1/key') return json(200, { data: { label: 'sk-or-...ake', limit: null, limit_remaining: null, usage: 0, is_free_tier: false } });
    const body = request.postDataJSON();
    // `prompt` is the first message: the thread, the draft and the first instruction.
    calls.push({ headers, body, prompt: body.messages[1].content });
    const asked = body.messages.at(-1).content;
    const wait = /slowly/.test(asked) ? 1500 : delay;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    // A request the extension cancelled meanwhile has nothing left to answer.
    const answer = (text, finish) => route.fulfill({ contentType: 'text/event-stream', body: sse(text, finish) }).catch(() => {});
    if (/cut it off/.test(asked)) return answer('Hi Dana, pricing for 20 seats is', null);
    if (/elsewhere/.test(asked)) return route.fulfill({ contentType: 'text/event-stream', body: sse(SHORTER, 'stop', 'Example Cloud') }).catch(() => {});
    const reply = /Write my reply/.test(asked) ? SUGGESTED : /Decline politely/.test(asked) ? DECLINED : /two options/i.test(asked) ? OPTIONS_REPLY : /the steps/.test(asked) ? STEPS : /\bPS\b/.test(asked) ? WITH_PS : /shorter/.test(asked) ? SHORTER : POLISHED;
    return answer(reply);
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://mail.google.com' });
  const early = await context.newPage();
  await early.goto('https://mail.google.com/mail/u/0/?case=fresh');
  const started = context.waitForEvent('serviceworker');
  await (await context.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: extension });
  const worker = await started;
  const extensionId = new URL(worker.url()).host;

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

  await test('Options saves the key, the model and how it edits', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const label = (name) => page.getByLabel(name, { exact: true });
    const save = page.getByRole('button', { name: 'Save' });
    await shot(page, 'options-first-open');

    await label('OpenRouter API key').fill('wrong-key');
    assert.equal(await page.locator('#status').innerText(), 'Unsaved changes');
    await save.click();
    await page.locator('#status.bad').waitFor();
    assert.equal(await page.locator('#status').innerText(), 'Saved, but OpenRouter rejected the API key.');

    // An Anthropic-style model name is not an OpenRouter model ID.
    await label('OpenRouter API key').fill('sk-or-test-fake');
    await label('Model').fill('claude-opus-5-5');
    await save.click();
    await page.locator('#status.bad', { hasText: 'no model' }).waitFor();
    assert.equal(await page.locator('#status').innerText(), 'Saved, but OpenRouter has no model called "claude-opus-5-5".');
    // Edits go only to providers that keep no data, so a model none of them runs would always fail.
    await label('Model').fill('example/keeps-data');
    await save.click();
    await page.locator('#status.bad', { hasText: 'zero data retention' }).waitFor();
    assert.equal(await page.locator('#status').innerText(), 'Saved, but no provider runs "example/keeps-data" with zero data retention. Pick another model.');
    // Zero retention with Google's abuse checks ("Safety Retention") still keeps data, so it does not count.
    await label('Model').fill('meta/muse-spark-1.3');
    await save.click();
    await page.locator('#status.bad', { hasText: 'zero data retention' }).waitFor();
    assert.equal(await page.locator('#status').innerText(), 'Saved, but no provider runs "meta/muse-spark-1.3" with zero data retention. Pick another model.');
    await page.getByRole('button', { name: 'Restore the default model' }).click();
    assert.equal(await label('Model').inputValue(), 'anthropic/claude-opus-5.5');
    assert.equal(await page.getByRole('button', { name: 'Restore the default model' }).isVisible(), false);

    // What the model is told about the writer and about editing is theirs to set.
    assert.match(await label('How it edits').inputValue(), /^Keep my meaning, facts, names, numbers/);
    assert.match(await label('Suggested reply').inputValue(), /^Write my reply to the latest message/);
    await label('Context').fill('I am Sam. I run sales at Acme.');
    await label('How it edits').fill('Keep every number. Never add a promise.');
    await label('Voice').fill('Short sentences. No hype.');
    assert.equal(await page.getByRole('button', { name: 'Restore the default voice' }).isVisible(), true);
    await shot(page, 'options-unsaved');
    await save.click();
    await page.locator('#status.ok, #status.bad').waitFor();
    assert.equal(await page.locator('#status').innerText(), 'Saved. The key works.');
    const saved = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.equal(saved.openRouterKey, 'sk-or-test-fake');
    assert.equal(saved.model, undefined, 'a default is not stored, so a better one later reaches it');
    assert.equal(saved.replyOnOpen, undefined);
    assert.equal(saved.about, 'I am Sam. I run sales at Acme.');
    assert.equal(saved.principles, 'Keep every number. Never add a promise.');

    // The fixed part of the prompt is there to read.
    await page.getByText('Always included').click();
    assert.match(await page.locator('#contract').innerText(), /^You edit email drafts[\s\S]*Only <instruction> is\.$/);
    await shot(page, 'options-saved', { whole: true });
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
    assert.equal(body.model, 'anthropic/claude-opus-5.5');
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
    assert.equal(await page.locator('.note').innerText(), 'To write it in, open a reply and press the shortcut again. Fill in the [brackets] before you send.');
    const { prompt } = calls.at(-1);
    assert.match(prompt, /<message from="Dana Lee <dana@example\.com>"[^>]*>\nHi Sam,\n\nCan you send pricing for 20 seats\?\n<\/message>/);
    assert.match(prompt, /<subject>Pricing question<\/subject>\n\n<draft>\n\n<\/draft>\n\n<instruction>\nWrite my reply to the latest message/);
    await shot(page, 'panel-thread-suggestion');

    await page.keyboard.type('shorter');
    await page.keyboard.press('Enter');
    await page.locator('.out', { hasText: '20 seats is $40/seat:' }).waitFor();
    await page.getByRole('button', { name: 'Copy' }).waitFor();

    // Gmail's Reply opens the box with the cursor in it. One press moves the
    // panel there with the suggestion ready, and asks the model nothing new.
    const before = calls.length;
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await toggle(page);
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
    await toggle(page);
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
    await toggle(page);
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

  await test('with no thread and no draft, it says where to click', async () => {
    const page = await context.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?case=inbox');
    const before = calls.length;
    await toggle(page);
    assert.equal(await page.getByRole('alert').innerText(), 'Click into a draft, then press the shortcut again.');
    assert.equal(calls.length, before);
    await shot(page, 'panel-no-draft');
    await page.keyboard.press('Escape');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
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
    assert.equal(await page.locator('.note').innerText(), 'Fill in the [brackets] before you send.');
    assert.deepEqual(await page.locator('.out mark').allInnerTexts(), ['[price per seat]']);
    assert.match(calls.at(-1).prompt, /<thread>[\s\S]*Can you send pricing[\s\S]*<draft>\n\n<\/draft>\n\n<instruction>\nWrite my reply to the latest message/);
    await shot(page, 'panel-suggested-reply');
    await page.keyboard.press('Enter');
    await page.locator('[data-draft-editor]').waitFor({ state: 'detached' });
    assert.match(await draftText(page), /^Hi Dana,\n\nHappy to help\. For 20 seats it is \[price per seat\] a month\.\n\n- Sam\nSam Rivera/);
    assert.equal(await tailHtml(page), signature);
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
    assert.equal(messages.at(-1).content, '<instruction>\nDecline politely.\n</instruction>');
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

  await test('sending a changed draft teaches the next request; filling the blanks does not', async () => {
    await worker.evaluate(() => chrome.storage.local.remove('edits'));
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

    // The next request shows the model how the writer edits.
    const next = await open('fresh');
    await toggle(next);
    await next.getByRole('button', { name: 'Replace draft' }).waitFor();
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
    await options.locator('#kept', { hasText: '1 edit kept in this browser.' }).waitFor();
    const readyOnReply = options.getByRole('switch', { name: 'Ready on Reply' });
    assert.equal(await readyOnReply.isChecked(), true);
    assert.equal(await options.getByRole('switch', { name: 'Learn from my edits' }).isChecked(), true);
    await shot(options, 'options-automatic', { whole: true });
    await options.getByRole('button', { name: 'Forget them' }).click();
    await options.locator('#kept', { hasText: 'No edits kept yet.' }).waitFor();
    assert.equal(await options.getByRole('button', { name: 'Forget them' }).isVisible(), false);
    assert.deepEqual(await keptEdits(), []);
    await readyOnReply.click();
    assert.equal(await options.locator('#status').innerText(), 'Unsaved changes');
    await options.getByRole('button', { name: 'Save' }).click();
    await options.locator('#status.ok').waitFor();
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('replyOnOpen')).replyOnOpen), false);
    await readyOnReply.click();
    await options.getByRole('button', { name: 'Save' }).click();
    await options.locator('#status.ok').waitFor();
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

  await test('outside Gmail, the shortcut goes to Gmail instead of opening Options', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ openRouterKey: 'sk-or-test-fake' }));
    const gmail = await open('fresh');
    const other = await context.newPage();
    await other.goto('https://example.com/');
    const pages = context.pages().length;
    await toggle(other);
    assert.equal(context.pages().length, pages, 'no Options tab');
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
