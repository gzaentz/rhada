// Draft HTML <-> the light text the model edits: lines, blank lines, links,
// bold and lists. Everything else is reported by `readDraft` instead of kept.

const BLOCKS = new Set(['DIV', 'P', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TR', 'TABLE']);
const clean = (s) => s.replace(/\s+/g, ' ').trim();

export function htmlToText(root, { rich = true } = {}) {
  const lines = [];
  let cur = '';
  let prefix = '';
  const push = () => {
    lines.push(prefix + clean(cur));
    cur = '';
    prefix = '';
  };
  const flush = () => {
    if (cur.trim()) push();
  };

  const walk = (node, list) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        cur += child.nodeValue;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      // Gmail's "Help me write" hint and similar chips are not draft text.
      if (tag === 'STYLE' || tag === 'SCRIPT' || child.getAttribute('contenteditable') === 'false') continue;

      if (tag === 'BR') {
        push();
      } else if (tag === 'A' && rich) {
        const label = clean(child.textContent);
        const href = child.getAttribute('href') || '';
        const plain = !href || label === href || href === `mailto:${label}`;
        cur += plain ? label : `[${label}](${href})`;
      } else if ((tag === 'B' || tag === 'STRONG') && rich) {
        // A link inside stays a link, and each line keeps its own bold.
        htmlToText(child).split('\n').forEach((line, i) => {
          if (i) push();
          const label = line.replace(/\*\*/g, '').trim();
          if (label) cur += `**${label}**`;
        });
      } else if (tag === 'UL' || tag === 'OL') {
        flush();
        walk(child, { ordered: tag === 'OL', n: 0 });
        flush();
      } else if (tag === 'LI') {
        flush();
        prefix = list?.ordered ? `${(list.n += 1)}. ` : '- ';
        walk(child, list);
        flush();
        prefix = '';
      } else if (BLOCKS.has(tag)) {
        flush();
        walk(child, list);
        flush();
        if (tag === 'P') lines.push('');
      } else {
        walk(child, list);
      }
    }
  };

  walk(root, null);
  flush();
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const INLINE = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|\*\*([^*]+)\*\*/g;

// One line of text into `parent`: plain text, links and bold.
function inline(parent, text) {
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) parent.append(text.slice(at, match.index));
    if (match[2]) {
      const link = inline(document.createElement('a'), match[1]);
      link.setAttribute('href', match[2]);
      parent.append(link);
    } else {
      parent.append(inline(document.createElement('b'), match[3]));
    }
    at = match.index + match[0].length;
  }
  if (at < text.length) parent.append(text.slice(at));
  return parent;
}

// Gmail writes one <div> per line and <div><br></div> for a blank line.
export function textToNodes(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const out = document.createDocumentFragment();
  for (let i = 0; i < lines.length; ) {
    const kind = BULLET.test(lines[i]) ? BULLET : NUMBER.test(lines[i]) ? NUMBER : null;
    let end = i;
    while (kind && end < lines.length && kind.test(lines[end])) end += 1;
    // A lone "- Sam" is a sign-off, not a list.
    if (end - i >= 2) {
      const list = document.createElement(kind === BULLET ? 'ul' : 'ol');
      for (const line of lines.slice(i, end)) list.append(inline(document.createElement('li'), kind.exec(line)[1]));
      out.append(list);
      i = end;
    } else {
      const line = lines[i].trim();
      const div = document.createElement('div');
      if (line) inline(div, line);
      else div.append(document.createElement('br'));
      out.append(div);
      i += 1;
    }
  }
  return out;
}

export function textToHtml(text) {
  const box = document.createElement('div');
  box.append(textToNodes(text));
  return box.innerHTML;
}
