import { DEFAULTS, EDITS_KEY, FLAGS, loadEdits, loadSettings } from './settings.js';
import { CONTRACT } from './prompt.js';

// Every change saves as you go. The key and model are checked once you leave
// the field, and a problem stays under the model until it is fixed.
const FIELDS = Object.keys(DEFAULTS);
const CHECKED = ['openRouterKey', 'model'];
const form = document.getElementById('form');
const status = document.getElementById('status');
const check = document.getElementById('check');
const kept = document.getElementById('kept');
const forget = document.getElementById('forget');
const restores = [...document.querySelectorAll('[data-restore]')];
const field = (name) => document.getElementById(name);
const isFlag = (name) => FLAGS.includes(name);

let saved = null;
// An emptied text field means its default. Switches are on or off.
const value = (name) => (isFlag(name) ? field(name).checked : field(name).value.trim() || DEFAULTS[name]);
const read = () => Object.fromEntries(FIELDS.map((name) => [name, value(name)]));

let fade = 0;
function show(text) {
  clearTimeout(fade);
  status.textContent = text;
  if (text === 'Saved') fade = setTimeout(() => show(''), 1600);
}

// "Restore default" shows only beside a field that differs from its default.
function sync() {
  for (const button of restores) {
    const name = button.dataset.restore;
    button.hidden = field(name).value.trim() === DEFAULTS[name];
  }
}

function fill(values) {
  for (const name of FIELDS) {
    if (isFlag(name)) field(name).checked = values[name];
    else field(name).value = values[name];
  }
  sync();
}

// Saves run one after another, so a slow one never lands after a newer one.
let queue = Promise.resolve();
function persist() {
  queue = queue.then(async () => {
    const values = read();
    if (!saved || FIELDS.every((name) => values[name] === saved[name])) return;
    // A setting left at its default is not stored, so a better default in a
    // later version reaches it.
    const own = FIELDS.filter((name) => values[name] !== DEFAULTS[name]);
    try {
      await chrome.storage.local.set(Object.fromEntries(own.map((name) => [name, values[name]])));
      await chrome.storage.local.remove(FIELDS.filter((name) => !own.includes(name)));
      saved = values;
      show('Saved');
    } catch (err) {
      show(`Could not save: ${err.message}`);
    }
  });
  return queue;
}

let typing = 0;
function later() {
  clearTimeout(typing);
  typing = setTimeout(persist, 500);
}
const now = () => {
  clearTimeout(typing);
  return persist();
};

async function verify() {
  await now();
  if (!saved?.openRouterKey) {
    check.textContent = '';
    return;
  }
  check.textContent = 'Checking…';
  check.className = 'help';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'check-key' });
    check.textContent = result.ok ? '' : result.message.replace(/^./, (c) => c.toUpperCase());
    check.className = result.ok ? 'help' : 'help bad';
  } catch {
    check.textContent = 'The key could not be checked. Leave the field again to retry.';
    check.className = 'help bad';
  }
}

// How many sent emails Rhada has kept to learn from.
async function count() {
  const edits = await loadEdits();
  kept.textContent = edits.length ? `${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} kept.` : '';
  forget.hidden = !edits.length;
}

document.getElementById('contract').textContent = CONTRACT;

loadSettings().then((settings) => {
  saved = settings;
  fill(settings);
  if (settings.openRouterKey) verify();
  else field('openRouterKey').focus();
});
count();
chrome.storage.onChanged.addListener((changes) => {
  if (EDITS_KEY in changes) count();
  // New lessons appear unless you are changing them yourself.
  if ('lessons' in changes && saved) {
    const lessons = changes.lessons.newValue ?? DEFAULTS.lessons;
    if (document.activeElement !== field('lessons') && field('lessons').value.trim() === saved.lessons) {
      field('lessons').value = lessons;
      sync();
    }
    saved = { ...saved, lessons };
  }
});
forget.addEventListener('click', async () => {
  await chrome.storage.local.remove(EDITS_KEY);
  kept.focus();
});

form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('input', (e) => {
  sync();
  if (isFlag(e.target.id)) now();
  else later();
});
// Leaving a field saves it at once and shows an emptied one at its default.
form.addEventListener('change', (e) => {
  const name = e.target.id;
  if (!FIELDS.includes(name) || isFlag(name)) return;
  if (!field(name).value.trim()) field(name).value = DEFAULTS[name];
  sync();
  if (CHECKED.includes(name)) verify();
  else now();
});
addEventListener('pagehide', now);

for (const button of restores) {
  button.addEventListener('click', () => {
    const input = field(button.dataset.restore);
    input.value = DEFAULTS[button.dataset.restore];
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  });
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    now();
  }
});

// The shortcut as Chrome has it now, which may not be the one suggested.
chrome.commands.getAll().then((commands) => {
  const shortcut = commands.find((command) => command.name === '_execute_action')?.shortcut;
  document.getElementById('shortcut').textContent = shortcut || '';
  document.getElementById('withShortcut').hidden = !shortcut;
  document.getElementById('noShortcut').hidden = Boolean(shortcut);
});
document.getElementById('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
