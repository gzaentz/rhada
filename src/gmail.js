// Everything that knows Gmail's DOM lives here. Selectors were checked against
// live Gmail on 2026-11-09 (new message, inline reply, open thread) and
// 2026-11-11 (Send, Expand all, collapsed messages).
import { htmlToText, textToHtml } from './format.js';

export const BODY = 'div[contenteditable="true"][g_editable="true"]';
// The Send button of a compose or reply box. "More send options" is a separate button.
export const SEND = '[role="button"][data-tooltip^="Send"], [role="button"].aoO';
// Where the user's own text ends: signature, or quoted / forwarded mail.
const TAIL = '.gmail_signature_prefix, .gmail_signature, .gmail_quote, .gmail_quote_container, .gmail_attr';
const DROPPED = 'i, em, u, s, strike, blockquote, pre, h1, h2, h3, h4, h5, h6, font, [style]';
// An emoji from Gmail's picker is an image too, but it is read as its character.
const UNSAFE_TO_REPLACE = 'img:not([data-emoji]), table';

const hasContentBefore = (node) => {
  for (let n = node.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType === Node.ELEMENT_NODE || n.nodeValue.trim()) return true;
  }
  return false;
};

// The part of the compose body the user wrote, as a Range.
function draftRange(body) {
  const range = document.createRange();
  range.selectNodeContents(body);
  let tail = body.querySelector(TAIL);
  if (tail) {
    // Gmail wraps the signature in bare <div>s; end before the outermost one.
    while (tail.parentElement !== body && !hasContentBefore(tail)) tail = tail.parentElement;
    range.setEndBefore(tail);
  }
  return { range, tail };
}

export function readDraft(body) {
  const fragment = draftRange(body).range.cloneContents();
  return {
    text: htmlToText(fragment),
    blocked: Boolean(fragment.querySelector(UNSAFE_TO_REPLACE)),
    lossy: [...fragment.querySelectorAll(DROPPED)].some((n) => !n.closest('[contenteditable="false"]')),
  };
}

const isBefore = (node, tail) => Boolean(node.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING);

// The selection to replace. It must not end right before the signature or the
// quoted mail: Chrome would then merge their first line into the new text and
// strip its markup. So it ends at the last character the user wrote, and the
// blank lines between that and the signature stay exactly as they were.
function writableRange(body) {
  const { range, tail } = draftRange(body);
  if (!tail) return range;

  let lastText = null;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && isBefore(node, tail); node = walker.nextNode()) {
    const locked = node.parentElement.closest('[contenteditable="false"]');
    if (node.nodeValue.trim() && !(locked && body.contains(locked))) lastText = node;
  }
  if (lastText) {
    range.setEnd(lastText, lastText.nodeValue.length);
    return range;
  }
  // Nothing written yet: write on the first empty line above the signature.
  const line = [...body.querySelectorAll('br')].find((br) => isBefore(br, tail));
  if (!line) return null;
  range.setEndBefore(line);
  return range;
}

// Goes through execCommand so Gmail saves the draft and Cmd+Z restores it.
export function replaceDraft(body, text) {
  if (!body.isConnected) return false;
  const range = writableRange(body);
  if (!range) return false;
  body.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return document.execCommand('insertHTML', false, textToHtml(text));
}

// The compose body a Send button belongs to: the only one in the nearest
// box around it. A button with several around it belongs to none.
export function bodyOf(button) {
  for (let node = button.parentElement; node; node = node.parentElement) {
    const bodies = node.querySelectorAll(BODY);
    if (bodies.length) return bodies.length === 1 ? bodies[0] : null;
  }
  return null;
}

const baseSubject = (s) =>
  String(s ?? '')
    .replace(/^\s*((re|fwd?)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();

export const isForward = (subject) => /^\s*fwd?\s*:/i.test(subject);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrollParent(node) {
  for (let n = node.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

// Gmail shows older messages of a thread collapsed, with only a snippet in
// the page. Its "Expand all" loads them (about 0.2 s on live Gmail). This
// presses it when something is collapsed and waits for the messages, at most
// 3 s. The part of the thread on screen stays where it was.
export async function expandThread(anchor) {
  const main = document.querySelector('[role="main"]');
  const button = document.querySelector('[aria-label="Expand all"]');
  if (!main || !button) return;
  const collapsed = [...main.querySelectorAll('[role="listitem"]')].some((item) => !item.querySelector('.a3s'));
  if (!collapsed) return;
  const target = anchor?.isConnected ? anchor : [...main.querySelectorAll('.adn')].at(-1);
  const top = target?.getBoundingClientRect().top;
  const count = () => main.querySelectorAll('.adn .a3s').length;
  const start = count();
  button.click();
  let last = start;
  let still = 0;
  for (let waited = 0; waited < 3000; waited += 50) {
    await sleep(50);
    const now = count();
    still = now === last ? still + 50 : 0;
    last = now;
    if (still >= (now > start ? 200 : 800)) break;
  }
  if (target?.isConnected && top !== undefined) {
    const shift = target.getBoundingClientRect().top - top;
    if (shift) scrollParent(target).scrollTop += shift;
  }
}

export function readContext(body) {
  let root = body;
  while (root && !root.querySelector('input[name="subjectbox"]')) root = root.parentElement;
  const subject = root?.querySelector('input[name="subjectbox"]')?.value || '';

  const to = new Set();
  for (const chip of root?.querySelectorAll('[role="option"][data-hovercard-id]') ?? []) {
    const email = chip.getAttribute('data-hovercard-id');
    const name = chip.getAttribute('data-name');
    to.add(name && name !== email ? `${name} <${email}>` : email);
  }

  // Only send the open thread when this draft belongs to it.
  const open = openThread();
  const thread = open && subject && baseSubject(open.title) === baseSubject(subject) ? open.messages : [];
  return { subject, to: [...to], thread };
}

// With no draft open: the thread on screen, if there is one to reply to.
export function readOpenThread() {
  const open = openThread();
  return open?.messages.length ? { subject: open.title, to: [], thread: open.messages } : null;
}

// The same thread seen with and without a reply box: its subject and latest message.
export function threadKey({ subject, thread }) {
  const last = thread.at(-1);
  return last ? JSON.stringify([baseSubject(subject), last.from, last.text]) : '';
}

// The signed-in address, from the tab title ("Subject - me@example.com - Gmail")
// or the account button. Mail sent from another address of theirs is not
// recognised as theirs.
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function myAddress() {
  const fromTitle = document.title.split(' - ').map((part) => part.trim()).find((part) => ADDRESS.test(part));
  const account = document.querySelector('a[aria-label^="Google Account"]')?.getAttribute('aria-label')?.match(/[^\s()@]+@[^\s()@]+\.[^\s()@]+/)?.[0];
  return (fromTitle || account || '').toLowerCase();
}

// The expanded messages of the thread on screen, oldest first, quotes removed.
// `mine` marks the ones the writer sent.
function openThread() {
  const me = myAddress();
  const main = document.querySelector('[role="main"]');
  const title = main?.querySelector('h2.hP')?.textContent?.trim();
  if (!title) return null;
  const messages = [];
  for (const message of main.querySelectorAll('.adn')) {
    const content = message.querySelector('.a3s')?.cloneNode(true);
    if (!content) continue;
    content.querySelectorAll('.gmail_quote, .gmail_quote_container, blockquote').forEach((n) => n.remove());
    const sender = message.querySelector('.gD');
    const name = sender?.getAttribute('name') || '';
    const email = sender?.getAttribute('email') || '';
    messages.push({
      from: name && email ? `${name} <${email}>` : name || email,
      date: message.querySelector('.g3')?.getAttribute('title') || '',
      text: htmlToText(content, { rich: false }),
      mine: Boolean(me) && email.toLowerCase() === me,
    });
  }
  return { title, messages };
}
