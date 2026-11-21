// Any text box on any other site: a <textarea>, a text <input>, or an
// editable element such as a chat or post editor. Gmail has its own rules in
// gmail.js; this is the plain version for everywhere else.
import { htmlToText, textToHtml } from './format.js';

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url']);
// Formatting the light text does not carry. Replacing drops it.
const DROPPED = 'i, em, u, s, strike, blockquote, pre, code, h1, h2, h3, h4, h5, h6';
// Pictures and tables would be lost, so such a box is copied from, not replaced.
const UNSAFE_TO_REPLACE = 'img, table, video, iframe';

// The box a node belongs to, or null. An editable element counts from its
// outermost editable ancestor, the way an editor is one box.
export function fieldOf(node) {
  if (!(node instanceof Element) || node.closest('[data-draft-editor]')) return null;
  if (node instanceof HTMLTextAreaElement) return node.readOnly || node.disabled ? null : node;
  if (node instanceof HTMLInputElement) return TEXT_INPUTS.has(node.type) && !node.readOnly && !node.disabled ? node : null;
  if (!node.isContentEditable) return null;
  let host = node;
  while (host.parentElement?.isContentEditable) host = host.parentElement;
  return host;
}

// The box with the cursor, also inside a page's own shadow roots.
export function focusedField() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return fieldOf(active);
}

const isPlain = (field) => field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement;

export function readField(field) {
  if (isPlain(field)) return { text: field.value.replace(/\r\n?/g, '\n').trim(), blocked: false, lossy: false };
  const range = document.createRange();
  range.selectNodeContents(field);
  const fragment = range.cloneContents();
  return {
    text: htmlToText(fragment),
    blocked: Boolean(fragment.querySelector(UNSAFE_TO_REPLACE)),
    lossy: Boolean(fragment.querySelector(DROPPED)),
  };
}

// The site, for the model to fit the text to: "linkedin.com", and the tab's title.
export function pageContext() {
  return { subject: '', to: [], thread: [], page: { site: location.hostname.replace(/^www\./, ''), title: document.title.slice(0, 200) } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// Writes the whole box as a person would, so the page sees it: typed text for
// a plain box, a paste for an editor. Both can be undone with Cmd+Z.
export async function replaceField(field, text) {
  if (!field.isConnected) return false;
  field.focus();
  // A one-line box takes the text on one line.
  if (field instanceof HTMLInputElement) text = text.replace(/\s*\n\s*/g, ' ');
  if (isPlain(field)) {
    field.select();
    if (document.execCommand('insertText', false, text) && field.value === text) return true;
    // A page that blocks typed input still gets the text, and hears about it.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set;
    setter.call(field, text);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    return field.value === text;
  }
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  selection.removeAllRanges();
  selection.addRange(range);
  // Editors pick up a new selection a moment later.
  await settle();
  if (!field.isConnected) return false;
  const html = textToHtml(text);
  const data = new DataTransfer();
  data.setData('text/plain', text);
  data.setData('text/html', html);
  // An editor that handles pasting writes it into its own model.
  if (!field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))) return true;
  return document.execCommand('insertHTML', false, html);
}

const PAGE_MIN = 400;
const PAGE_MAX = 20_000;

// The text on screen around the box, usually the conversation it answers:
// the nearest enclosing part of the page with at least PAGE_MIN characters
// besides the box's own. Kept to PAGE_MAX, from the end, nearest the box.
export function readPage(field) {
  const own = isPlain(field) ? '' : field.innerText.trim();
  let text = '';
  for (let node = field; ; ) {
    node = node.parentElement ?? node.getRootNode().host;
    if (!node || node === document.documentElement) break;
    const all = node.innerText ?? '';
    text = (own ? all.replace(own, '') : all).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length >= PAGE_MIN) break;
  }
  return text.length > PAGE_MAX ? `…${text.slice(-PAGE_MAX)}` : text;
}
