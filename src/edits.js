// What a sent email teaches: the text Rhada wrote into the draft, and the text
// the writer sent after changing it. The latest few go to the model with each
// request, so it writes more the way they do.

// Longer pairs are skipped rather than cut: half an email teaches the wrong thing.
const LONGEST = 4000;
// A [what is needed] Rhada left for the writer, not a [link](url).
export const BLANK = /\[[^\]\n]+\](?!\()/;
const squash = (text) => text.replace(/\s+/g, ' ').trim();
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whether `after` differs from `before` by more than filled-in [blanks] and spacing.
export function changedMoreThanBlanks(before, after) {
  const pattern = squash(before).split(BLANK).map(literal).join('.+?');
  return !new RegExp(`^${pattern}$`, 's').test(squash(after));
}

// The pair worth keeping, or null.
export function lesson(before, after, at = Date.now()) {
  const wrote = String(before ?? '').trim();
  const sent = String(after ?? '').trim();
  if (!wrote || !sent || wrote.length > LONGEST || sent.length > LONGEST) return null;
  return changedMoreThanBlanks(wrote, sent) ? { before: wrote, after: sent, at } : null;
}
