export const DEFAULTS = {
  openRouterKey: '',
  // Any model ID from openrouter.ai/models.
  model: 'anthropic/claude-haiku-5.5',

  // The writer's own words, sent with every edit. All of it is editable in Options.
  // Who they are and what they write about. Optional.
  about: '',
  // What an edit must keep and what it may change.
  principles: [
    'Keep my meaning, facts, names, numbers, dates, links and commitments.',
    'Never add a fact, promise or detail that is not in the draft, the thread or my instruction.',
    'Write in the language of the draft.',
    'Keep my greeting and sign-off unless I ask otherwise.',
  ].join('\n'),
  // How they write.
  rules: 'Plain English. Short sentences. Friendly and direct. No filler, no hype.',
  // What their edits have taught, updated after each changed email they send. Editable.
  lessons: '',
  // Message structures to write with: [{ name, when, text }]. Older versions
  // kept one text with a "# Name" line before each.
  templates: [],
  // The edit that runs when the panel opens on a draft with text.
  defaultInstruction:
    'Polish this draft: fix typos and grammar, tighten it, and keep my meaning and voice.',
  // The reply it suggests when the panel opens on an empty reply, or on a thread
  // with no reply open. When the writer sent the latest message it writes a follow-up instead.
  replyInstruction: 'Write my reply to the latest message in the thread. Answer what it asks, briefly.',

  // Start writing a reply as soon as a reply box opens, so it is ready when the panel opens.
  replyOnOpen: true,
  // Keep how the writer changed the panel's text before sending, and show the model the latest few.
  learnFromEdits: true,
};

export const FLAGS = ['replyOnOpen', 'learnFromEdits'];

// The writer's changes to the panel's text, newest last: { before, after, at }.
export const EDITS_KEY = 'edits';
export const EDITS_KEPT = 20;
export const EDITS_SENT = 5;

// The saved templates, cleaned: named, with text, at most 12.
export function normalizeTemplates(saved) {
  const list = typeof saved === 'string' ? parseTemplates(saved) : Array.isArray(saved) ? saved : [];
  return list
    .map((t) => ({
      name: String(t?.name ?? '').trim().slice(0, 40),
      when: String(t?.when ?? '').trim().slice(0, 300),
      text: String(t?.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 4000),
    }))
    .filter((t) => t.name && t.text)
    .slice(0, 12);
}

// "# Name" lines start each template; text before the first is ignored.
function parseTemplates(text = '') {
  const templates = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^#\s+(.+?)\s*$/);
    if (heading) templates.push({ name: heading[1].slice(0, 40), lines: [] });
    else templates.at(-1)?.lines.push(line);
  }
  return templates
    .map(({ name, lines }) => ({ name, text: lines.join('\n').trim() }));
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function loadEdits() {
  const { [EDITS_KEY]: edits = [] } = await chrome.storage.local.get(EDITS_KEY);
  return edits;
}
