import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTemplates, fromLocalFile, normalizeTemplates } from '../src/settings.js';

test('templates: saved ones are cleaned, and the older "# Name" text still reads', () => {
  assert.deepEqual(normalizeTemplates([{ name: ' Outbound ', when: ' cold pitch ', text: 'Hey\r\nthere ' }, { name: '', text: 'x' }, { name: 'Empty', text: '  ' }, null]), [
    { name: 'Outbound', when: 'cold pitch', text: 'Hey\nthere' },
  ]);
  const text = 'A note to self\r\n# Research share\r\nHi [name],\n\nThree stood out.\n\n#   Fellow names  \n[Name], found 3.\n# Empty\n\n';
  assert.deepEqual(normalizeTemplates(text), [
    { name: 'Research share', when: '', text: 'Hi [name],\n\nThree stood out.' },
    { name: 'Fellow names', when: '', text: '[Name], found 3.' },
  ]);
  assert.deepEqual(normalizeTemplates(undefined), []);
  // "#hashtag" with no space is part of a template, not a new one.
  assert.deepEqual(normalizeTemplates('# One\n#launch day'), [{ name: 'One', when: '', text: '#launch day' }]);
});

test('templates from a file join the saved ones, and a saved one with the same name is kept', () => {
  const saved = [{ name: 'Outbound', when: 'mine', text: 'Edited by me' }];
  assert.deepEqual(addTemplates(saved, [{ name: 'Outbound', when: 'file', text: 'From the file' }, { name: 'Batch', when: 'leads ready', text: 'Uploaded.' }, { name: 'No text' }]), [
    { name: 'Outbound', when: 'mine', text: 'Edited by me' },
    { name: 'Batch', when: 'leads ready', text: 'Uploaded.' },
  ]);
  assert.deepEqual(addTemplates(undefined, [{ name: 'A', text: 'a' }]), [{ name: 'A', when: '', text: 'a' }]);
});

test('a local file can carry facts: they fill an empty box or replace the file\'s own, never typed ones', () => {
  const v1 = JSON.stringify({ templates: [{ name: 'A', text: 'a' }], facts: 'Call: cal.example.com/a' });
  const v2 = JSON.stringify({ templates: [], facts: 'Call: cal.example.com/b' });
  assert.deepEqual(fromLocalFile({}, v1), { templates: [{ name: 'A', when: '', text: 'a' }], facts: 'Call: cal.example.com/a' });
  assert.equal(fromLocalFile({ facts: 'Call: cal.example.com/a' }, v2, v1).facts, 'Call: cal.example.com/b');
  assert.equal(fromLocalFile({ facts: 'Typed by me' }, v2, v1).facts, undefined);
  assert.deepEqual(fromLocalFile({}, JSON.stringify([{ name: 'B', text: 'b' }])), { templates: [{ name: 'B', when: '', text: 'b' }] });
});

test('a new version of the local file updates templates the writer left as they were', () => {
  const v1 = JSON.stringify([{ name: 'A', text: 'old' }, { name: 'B', text: 'old' }]);
  const v2 = JSON.stringify([{ name: 'A', text: 'new' }, { name: 'B', text: 'new' }]);
  const saved = { templates: [{ name: 'A', when: '', text: 'old' }, { name: 'B', when: '', text: 'edited' }] };
  assert.deepEqual(fromLocalFile(saved, v2, v1).templates, [{ name: 'A', when: '', text: 'new' }, { name: 'B', when: '', text: 'edited' }]);
});
