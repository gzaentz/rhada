// What counts as the writer changing an email Rhada wrote, before it is kept
// to learn from. Filling in the [blanks] the model left is not a change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lesson } from '../src/edits.js';

const WROTE = 'Hi Dana,\n\nThanks for the note. 20 seats would be [price per seat]. Does [day] work for a call?\n\nBest,\nSam';

test('filling in the blanks is not kept', () => {
  const sent = 'Hi Dana,\n\nThanks for the note. 20 seats would be $40 a seat. Does Thursday at 3 work for a call?\n\nBest,\nSam';
  assert.equal(lesson(WROTE, sent), null);
});

test('the same text with other spacing is not kept', () => {
  assert.equal(lesson(WROTE, WROTE.replace(/\n\n/g, '\n').replace('Thanks for', 'Thanks  for')), null);
  assert.equal(lesson('Sounds good, see you then.', 'Sounds good, see you then.'), null);
});

test('a real change is kept, before and after', () => {
  const sent = 'Dana,\n\n$40 a seat for 20. Thursday at 3?\n\nSam';
  assert.deepEqual(lesson(WROTE, sent, 7), { before: WROTE, after: sent, at: 7 });
});

test('a change next to a blank is still a change', () => {
  const sent = WROTE.replace('[price per seat]', '$40 a seat').replace('Thanks for the note.', 'Great to hear from you!');
  assert.ok(lesson(WROTE, sent));
});

test('a markdown link is text, not a blank to fill in', () => {
  const wrote = 'The guide is [here](https://example.com/guide).';
  assert.ok(lesson(wrote, 'The guide is [over here](https://example.com/guide).'));
  assert.equal(lesson(wrote, wrote), null);
});

test('text that looks like a pattern is matched as text', () => {
  assert.ok(lesson('Cost: $5 (approx.) + tax?', 'Cost: $5 + tax.'));
  assert.equal(lesson('Cost: $5 (approx.) + tax?', 'Cost: $5 (approx.) + tax?'), null);
});

test('empty or very long emails are not kept', () => {
  assert.equal(lesson('', 'Hi'), null);
  assert.equal(lesson('Hi', '   '), null);
  assert.equal(lesson(undefined, 'Hi'), null);
  assert.equal(lesson('x'.repeat(4001), 'y'), null);
});
