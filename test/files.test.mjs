import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FileProblem, docxText, readAttachment, xlsxText } from '../src/files.js';

// Made by macOS textutil (Word) and openpyxl (Excel), as real writers make them.
const fixture = async (name) => new Uint8Array(await readFile(new URL(`fixtures/${name}`, import.meta.url)));
const asFile = async (name, type = '') => new File([await fixture(name)], name, { type });

test('a Word document reads as its paragraphs, list and table, entities decoded', async () => {
  const text = await docxText(await fixture('plan.docx'));
  assert.match(text, /Launch plan/);
  assert.match(text, /Start date: Monday, Dec 1\. Owner: Sam & Lee\./);
  assert.match(text, /Price per seat: \$40/);
  assert.match(text, /Tier\nSeats\nTeam\n20/, 'textutil writes a table as paragraphs');
  assert.match(text, /Questions go to Dana\./);
});

test('a Word table reads as rows of tab-separated cells, line breaks kept', async () => {
  // Word's own table markup: w:tbl > w:tr > w:tc > w:p.
  assert.equal(await docxText(await fixture('table.docx')), 'Seat pricing\nTier\tPrice\nTeam\t$40 per seat\nLine one\nline two\n');
});

test('an Excel workbook reads sheet by sheet, cells in their columns', async () => {
  const text = await xlsxText(await fixture('prices.xlsx'));
  const [pricing, dates] = text.split('\n\n');
  assert.equal(pricing, 'Sheet: Pricing\nTier\tSeats\tPrice\nTeam\t20\t40\nGrowth\t50\t35.5\n\t\t\t\tNote: per month');
  assert.match(dates, /^Sheet: Dates & notes\nRenewal\t\d+\nTRUE$/);
});

test('a workbook whose tags carry a prefix, <x:row>, as some writers make them, reads the same', async () => {
  assert.equal(await xlsxText(await fixture('prices-prefixed.xlsx')), await xlsxText(await fixture('prices.xlsx')));
});

test('attachments: Word and Excel become text; old formats and damage say what to do', async () => {
  assert.equal((await readAttachment(await asFile('plan.docx'))).kind, 'text');
  const sheet = await readAttachment(await asFile('prices.xlsx'));
  assert.deepEqual([sheet.name, sheet.kind], ['prices.xlsx', 'text']);
  assert.deepEqual(await readAttachment(new File(['a,b\n1,2\n'], 'list.csv')), { name: 'list.csv', kind: 'text', text: 'a,b\n1,2' });
  const pdf = await readAttachment(new File(['%PDF-1.4'], 'deck.pdf', { type: 'application/pdf' }));
  assert.equal(pdf.data, `data:application/pdf;base64,${btoa('%PDF-1.4')}`);
  await assert.rejects(readAttachment(new File(['x'], 'old.doc')), (err) => err instanceof FileProblem && /Save it as a PDF, \.docx or \.xlsx/.test(err.message));
  await assert.rejects(readAttachment(new File(['not a zip'], 'broken.docx')), FileProblem);
  await assert.rejects(readAttachment(new File([new Uint8Array([0, 1])], 'tool.exe')), /can't be read/);
});
