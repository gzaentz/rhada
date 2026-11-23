import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplates } from '../src/settings.js';

test('templates: each starts at a "# Name" line; text before the first and empty ones are dropped', () => {
  const text = 'A note to self\r\n# Research share\r\nHi [name],\n\nThree stood out.\n\n#   Fellow names  \n[Name], found 3.\n# Empty\n\n';
  assert.deepEqual(parseTemplates(text), [
    { name: 'Research share', text: 'Hi [name],\n\nThree stood out.' },
    { name: 'Fellow names', text: '[Name], found 3.' },
  ]);
  assert.deepEqual(parseTemplates(''), []);
  // "#hashtag" with no space is part of a template, not a new one.
  assert.deepEqual(parseTemplates('# One\n#launch day'), [{ name: 'One', text: '#launch day' }]);
});
