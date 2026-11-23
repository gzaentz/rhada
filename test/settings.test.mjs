import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplates } from '../src/settings.js';

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
