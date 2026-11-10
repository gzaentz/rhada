// Everything that knows Gmail's DOM lives here. Selectors were checked against
// live Gmail on 2026-11-09 (new message, inline reply, open thread).
import { htmlToText, textToHtml } from './format.js';

export const BODY = 'div[contenteditable="true"][g_editable="true"]';
// Where the user's own text ends: signature, or quoted / forwarded mail.
const TAIL = '.gmail_signature_prefix, .gmail_signature, .gmail_quote, .gmail_quote_container, .gmail_attr';
const DROPPED = 'i, em, u, s, strike, blockquote, pre, h1, h2, h3, h4, h5, h6, font, [style]';
const UNSAFE_TO_REPLACE = 'img, table';

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

const baseSubject = (s) =>
  String(s ?? '')
    .replace(/^\s*((re|fwd?)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();

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
  const thread = [];
  const main = document.querySelector('[role="main"]');
  const title = main?.querySelector('h2.hP')?.textContent;
  if (title && subject && baseSubject(title) === baseSubject(subject)) {
    for (const message of main.querySelectorAll('.adn')) {
      const content = message.querySelector('.a3s')?.cloneNode(true);
      if (!content) continue;
      content.querySelectorAll('.gmail_quote, .gmail_quote_container, blockquote').forEach((n) => n.remove());
      const sender = message.querySelector('.gD');
      const name = sender?.getAttribute('name') || '';
      const email = sender?.getAttribute('email') || '';
      thread.push({
        from: name && email ? `${name} <${email}>` : name || email,
        date: message.querySelector('.g3')?.getAttribute('title') || '',
        text: htmlToText(content, { rich: false }),
      });
    }
  }
  return { subject, to: [...to], thread };
}
