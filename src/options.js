import { DEFAULTS, EDITS_KEY, FLAGS, loadEdits, loadSettings } from './settings.js';
import { CONTRACT } from './prompt.js';

const FIELDS = Object.keys(DEFAULTS);
const form = document.getElementById('form');
const save = document.getElementById('save');
const status = document.getElementById('status');
const kept = document.getElementById('kept');
const forget = document.getElementById('forget');
const restores = [...document.querySelectorAll('[data-restore]')];
const field = (name) => document.getElementById(name);
const isFlag = (name) => FLAGS.includes(name);

let saved = null;
// An emptied text field goes back to its default. Switches are on or off.
const read = () =>
  Object.fromEntries(FIELDS.map((name) => [name, isFlag(name) ? field(name).checked : field(name).value.trim() || DEFAULTS[name]]));

function show(text, kind = '') {
  status.textContent = text;
  status.className = kind;
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

// How many sent emails Rhada has kept to learn from.
async function count() {
  const edits = await loadEdits();
  kept.textContent = edits.length
    ? `${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} kept in this browser.`
    : 'No edits kept yet.';
  forget.hidden = !edits.length;
}

document.getElementById('contract').textContent = CONTRACT;

loadSettings().then((settings) => {
  saved = settings;
  fill(settings);
});
count();
chrome.storage.onChanged.addListener((changes) => {
  if (EDITS_KEY in changes) count();
});
forget.addEventListener('click', async () => {
  await chrome.storage.local.remove(EDITS_KEY);
  kept.focus();
});

form.addEventListener('input', () => {
  sync();
  const now = read();
  show(saved && FIELDS.some((name) => now[name] !== saved[name]) ? 'Unsaved changes' : '');
});

for (const button of restores) {
  button.addEventListener('click', () => {
    const input = field(button.dataset.restore);
    input.value = DEFAULTS[button.dataset.restore];
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (save.disabled) return;
  save.disabled = true;
  show('Checking the key…');
  const values = read();
  // A setting left at its default is not stored, so a better default in a
  // later version reaches it.
  const own = FIELDS.filter((name) => values[name] !== DEFAULTS[name]);
  try {
    await chrome.storage.local.set(Object.fromEntries(own.map((name) => [name, values[name]])));
    await chrome.storage.local.remove(FIELDS.filter((name) => !own.includes(name)));
    saved = values;
    fill(values);
  } catch (err) {
    show(`Could not save: ${err.message}`, 'bad');
    save.disabled = false;
    return;
  }
  try {
    const check = await chrome.runtime.sendMessage({ type: 'check-key' });
    if (check.ok) show(['Saved. The key works.', check.note].filter(Boolean).join(' '), 'ok');
    else show(`Saved, but ${check.message}`, 'bad');
  } catch {
    show('Saved, but the key could not be checked. Save again to retry.', 'bad');
  } finally {
    save.disabled = false;
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    form.requestSubmit();
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
