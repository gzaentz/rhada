import { DEFAULTS, loadSettings } from './settings.js';
import { CONTRACT } from './prompt.js';

const FIELDS = Object.keys(DEFAULTS);
const form = document.getElementById('form');
const save = document.getElementById('save');
const status = document.getElementById('status');
const restores = [...document.querySelectorAll('[data-restore]')];
const field = (name) => document.getElementById(name);

let saved = null;
// An emptied field goes back to its default.
const read = () => Object.fromEntries(FIELDS.map((name) => [name, field(name).value.trim() || DEFAULTS[name]]));

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
  for (const name of FIELDS) field(name).value = values[name];
  sync();
}

document.getElementById('contract').textContent = CONTRACT;

loadSettings().then((settings) => {
  saved = settings;
  fill(settings);
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
  try {
    await chrome.storage.local.set(values);
    saved = values;
    fill(values);
    const check = await chrome.runtime.sendMessage({ type: 'check-key' });
    if (check.ok) show(['Saved. The key works.', check.note].filter(Boolean).join(' '), 'ok');
    else show(`Saved, but ${check.message}`, 'bad');
  } catch (err) {
    show(`Could not save: ${err.message}`, 'bad');
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
