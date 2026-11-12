// Loads the built extension into Chromium and drives it against a page that
// copies Gmail's compose and thread markup (captured from live Gmail,
// 2026-11-09) and Gmail's Trusted Types policy. OpenRouter is stubbed: its
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
  image: `<div>see the chart</div><div><img alt="chart" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>${SIGNATURE}`,
};

const composeBox = (name, subject) => `<table><tbody><tr><td class="I5">
    <form>
      <div role="listbox" aria-label="Search Field"><div role="option" data-hovercard-id="dana@example.com" data-name="Dana Lee">Dana Lee</div></div>
      <input name="subjectbox" aria-label="Subject" value="${subject}">
    </form>
    <div class="Am aiL Al editable" role="textbox" aria-label="Message Body" aria-multiline="true" contenteditable="true" g_editable="true" style="min-height:120px">${BODIES[name]}</div>
  </td></tr></tbody></table>`;

// `none` is a thread with no reply open yet, and a Reply button that opens one.
// `inbox` has neither a thread nor a draft.
function gmailPage(name, { subject = 'Re: Pricing question' } = {}) {
  const compose =
    name === 'none'
      ? `<div role="button" tabindex="0" id="reply">Reply</div><template id="replyBox">${composeBox('empty', subject)}</template>`
      : composeBox(name, subject);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mock Gmail</title><style>
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
  <h2 class="hP">Pricing question</h2>
  <div role="list"><div role="listitem"><div class="adn ads">
    <span class="gD" email="dana@example.com" name="Dana Lee">Dana Lee</span>
    <span class="g3" title="Nov 8, 2026, 9:14 AM">9:14 AM</span>
    <div class="a3s aiL"><div dir="ltr">Hi Sam,<div><br></div><div>Can you send pricing for 20 seats?</div><div class="gmail_quote">an older quoted message</div></div></div>
  </div></div></div>
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
const OPTIONS_REPLY = `Hi Dana,

Two options:

- Monthly at $40 <per seat>
- Annual at $32

Which works?`;

// What the panel shows: links and bold rendered, not as markup.
const rendered = (text) => text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

function sse(text, finish = 'stop') {
  const chunk = (delta, reason = null, extra = {}) =>
    `data: ${JSON.stringify({ id: 'gen-test', object: 'chat.completion.chunk', created: 1794000000, model: 'anthropic/claude-opus-5.5', provider: 'Amazon Bedrock', choices: [{ index: 0, delta, finish_reason: reason, native_finish_reason: reason }], ...extra })}\n\n`;
  return [
    ': OPENROUTER PROCESSING\n\n',
    chunk({ role: 'assistant', content: '', reasoning: 'Tighten it, keep the facts.' }),
    ...text.match(/[\s\S]{1,24}/g).map((piece) => chunk({ role: 'assistant', content: piece })),
    // A finished stream repeats the finish reason on a last chunk that carries the usage.
    ...(finish ? [chunk({ role: 'assistant', content: '' }, finish), chunk({ role: 'assistant', content: '' }, finish, { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), 'data: [DONE]\n\n'] : []),
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
let passed = 0;
try {
  await context.route('https://mail.google.com/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "require-trusted-types-for 'script'" },
      body: gmailPage(url.searchParams.get('case'), { subject: url.searchParams.get('subject') ?? undefined }),
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
    if (/slowly/.test(asked)) await new Promise((resolve) => setTimeout(resolve, 1500));
    if (/cut it off/.test(asked)) return route.fulfill({ contentType: 'text/event-stream', body: sse('Hi Dana, pricing for 20 seats is', null) });
    const reply = /Write my reply/.test(asked) ? SUGGESTED : /two options/i.test(asked) ? OPTIONS_REPLY : /\bPS\b/.test(asked) ? WITH_PS : /shorter/.test(asked) ? SHORTER : POLISHED;
    return route.fulfill({ contentType: 'text/event-stream', body: sse(reply) });
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
    assert.equal(await page.locator('#status').innerText(), 'Saved, but no provider with zero data retention runs "example/keeps-data". Pick another model.');
    // OpenRouter's zero retention can include Google's abuse checks: Save says so.
    await label('Model').fill('meta/muse-spark-1.3');
    await save.click();
    await page.locator('#status.ok').waitFor();
    assert.equal(await page.locator('#status').innerText(), 'Saved. The key works. Google may keep these requests to check for abuse, unless your OpenRouter privacy setting is ZDR only.');
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
    assert.equal(saved.model, 'anthropic/claude-opus-5.5');
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
    assert.deepEqual(body.provider, { zdr: true }, 'only providers that keep no data');
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
    await page.locator('.out', { hasText: '20 seats is' }).waitFor();
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
    await page.locator('.out', { hasText: '20 seats is' }).waitFor();
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
    await page.locator('.out', { hasText: '20 seats is' }).waitFor();
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
