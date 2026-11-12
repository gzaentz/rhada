import { EDITS_KEPT, EDITS_KEY, EDITS_SENT, loadEdits, loadSettings } from './settings.js';
import { buildMessages } from './prompt.js';
import { lesson } from './edits.js';
import { OpenRouterError, checkKey, costOf, modelExists, streamChat, zdrEndpoints } from './openrouter.js';

// The API key stays out of reach of scripts running inside web pages.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const GMAIL = 'https://mail.google.com/';

// The toolbar button and the keyboard shortcut both land here.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url?.startsWith(GMAIL)) {
    await showGmail();
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
  } catch {
    // Chrome adds the panel only to Gmail tabs that load after the extension
    // does. A tab already open when it was installed or reloaded gets it now.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dist/content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
    } catch {
      // The tab is still loading or shows an error page: Chrome adds the panel once it loads.
    }
  }
});

// Anywhere else, go to Gmail: the Gmail tab used last, or a new one.
async function showGmail() {
  const tabs = await chrome.tabs.query({ url: `${GMAIL}*` });
  const tab = tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (!tab) {
    await chrome.tabs.create({ url: GMAIL });
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

function describe(err, model) {
  if (err?.name === 'AbortError') return null;
  if (err?.name === 'TimeoutError') return { message: 'OpenRouter took too long. Try again.' };
  if (err instanceof TypeError) {
    return { message: 'Could not reach OpenRouter. Check your connection and try again.' };
  }
  if (!(err instanceof OpenRouterError)) return { message: String(err?.message || err) };
  const { status, message } = err;
  if (status === 401) return { code: 'settings', message: 'OpenRouter rejected the API key.' };
  if (status === 402) return { message: `OpenRouter needs more credits: ${message}` };
  if (status === 429) return { message: 'OpenRouter is rate limiting this key. Try again in a moment.' };
  if (status === 400 || status === 404) {
    return { code: 'settings', message: `OpenRouter could not run "${model}": ${message}` };
  }
  return { message: `OpenRouter returned an error (${status}): ${message}` };
}

// The shortcut as Chrome has it now, such as ⌃⇧E, or '' when none is set.
async function shortcut() {
  const commands = await chrome.commands.getAll();
  return commands.find((command) => command.name === '_execute_action')?.shortcut || '';
}

// One port per edit. Closing the port cancels the request. A request with
// `prefetch` comes from a reply box that just opened (Ready on Reply): it runs
// only when that setting is on and a key is saved, and says so with `start`.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'edit') return;
  const cancel = new AbortController();
  let open = true;
  const post = (msg) => {
    if (open) port.postMessage(msg);
  };
  port.onDisconnect.addListener(() => {
    open = false;
    cancel.abort();
  });

  port.onMessage.addListener(async (context) => {
    const settings = await loadSettings();
    if (context.prefetch && (!settings.replyOnOpen || !settings.openRouterKey)) {
      post({ type: 'off' });
      return;
    }
    if (!settings.openRouterKey) {
      post({ type: 'error', code: 'settings', message: 'Add your OpenRouter API key to start.' });
      return;
    }
    const edits = settings.learnFromEdits ? (await loadEdits()).slice(-EDITS_SENT) : [];
    if (context.prefetch) post({ type: 'start', shortcut: await shortcut() });
    const started = Date.now();
    try {
      let text = '';
      const { finish, usage } = await streamChat({
        apiKey: settings.openRouterKey,
        signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(120_000)]),
        body: {
          model: settings.model,
          max_tokens: 8000,
          // Only providers that keep nothing once they answer. OpenRouter
          // fails the request rather than fall back to one that keeps data.
          provider: { zdr: true },
          // Models that reason before answering do it briefly: edits should feel instant.
          reasoning: { effort: 'low' },
          messages: buildMessages(settings, context, edits),
        },
        onText(piece) {
          text += piece;
          post({ type: 'delta', text: piece });
        },
        // Chrome stops an idle worker after 30 s. A message on the port while
        // the model is still thinking keeps this one awake.
        onWait: () => post({ type: 'wait' }),
      });
      const meta = { ms: Date.now() - started, cost: costOf(usage) };
      if (finish === 'stop') post({ type: 'done', text: text.trim(), meta });
      else if (finish === 'content_filter') post({ type: 'error', message: 'The model declined to edit this draft.' });
      // Never offer half an email as the result.
      else post({ type: 'error', message: 'The edit was cut off before it finished. Try again.' });
    } catch (err) {
      const problem = describe(err, settings.model);
      if (problem) post({ type: 'error', ...problem });
    }
  });
});

// A draft Rhada wrote was sent: keep how the writer changed it, if they did.
// Stored with the settings, so only the extension can read it.
async function learn({ before, after }) {
  const { learnFromEdits } = await loadSettings();
  const edit = learnFromEdits ? lesson(before, after) : null;
  if (!edit) return;
  const edits = await loadEdits();
  await chrome.storage.local.set({ [EDITS_KEY]: [...edits, edit].slice(-EDITS_KEPT) });
}

let learning = Promise.resolve();

// Options page: check the saved key and model without spending anything.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg?.type === 'learn') {
    learning = learning.then(() => learn(msg)).catch(() => {});
    return false;
  }
  // Ready on Reply asks before it touches the page, so with it off nothing happens.
  if (msg?.type === 'ready-on-reply') {
    loadSettings().then(
      (settings) => sendResponse(Boolean(settings.replyOnOpen && settings.openRouterKey)),
      () => sendResponse(false),
    );
    return true;
  }
  if (msg?.type !== 'check-key') return false;
  (async () => {
    const { openRouterKey, model } = await loadSettings();
    if (!openRouterKey) return { ok: false, message: 'No API key saved yet.' };
    try {
      // All three at once, and never so long that Chrome stops this worker first.
      const signal = AbortSignal.timeout(10_000);
      const [key, exists, zdr] = await Promise.allSettled([
        checkKey(openRouterKey, { signal }),
        modelExists(model, { signal }),
        zdrEndpoints(model, { signal }),
      ]);
      for (const check of [key, exists]) if (check.status === 'rejected') throw check.reason;
      if (!exists.value) return { ok: false, message: `OpenRouter has no model called "${model}".` };
      if (zdr.status === 'rejected') throw zdr.reason;
      const endpoints = zdr.value;
      if (!endpoints.length) {
        return { ok: false, message: `no provider with zero data retention runs "${model}". Pick another model.` };
      }
      // OpenRouter also routes zero-retention requests to "Safety Retention"
      // endpoints, which keep requests to check for abuse, unless the account says ZDR only.
      const keepers = [...new Set(endpoints.filter((e) => e.safety_retention).map((e) => e.provider_name))];
      if (keepers.length) {
        return { ok: true, note: `${keepers.join(' and ')} may keep these requests to check for abuse, unless your OpenRouter privacy setting is ZDR only.` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err, model)?.message || 'Check failed.' };
    }
  })().then(sendResponse);
  return true;
});
