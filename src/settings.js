export const DEFAULTS = {
  openRouterKey: '',
  // Any model ID from openrouter.ai/models.
  model: 'anthropic/claude-opus-5.5',

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
  // The edit that runs when the panel opens on a draft with text.
  defaultInstruction:
    'Polish this draft: fix typos and grammar, tighten it, and keep my meaning and voice.',
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}
