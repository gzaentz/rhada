// The OpenRouter client against a fake fetch. Error bodies were recorded from
// the live API on 2026-11-09; the stream follows OpenRouter's streaming docs.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { OpenRouterError, checkKey, costOf, keepNothing, modelExists, streamChat, zdrEndpoints } from '../src/openrouter.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A streamed response whose network chunks end wherever `sizes` says, even in
// the middle of a line or of a character.
function streamed(text, sizes) {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      const size = sizes[i++ % sizes.length];
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (delta, finish = null, extra = {}) =>
  `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', model: 'anthropic/claude-opus-5.5', provider: 'Anthropic', choices: [{ index: 0, delta, finish_reason: finish, native_finish_reason: finish }], ...extra })}\n\n`;

const ANSWER = 'Hi Dana — 20 seats is $40/seat. Café at 3? 👍';
// The usage OpenRouter sends on the last chunk, in the shape of its usage docs.
const USAGE = {
  prompt_tokens: 1840,
  completion_tokens: 212,
  total_tokens: 2052,
  cost: 0.01160,
  is_byok: false,
  prompt_tokens_details: { cached_tokens: 0 },
  cost_details: { upstream_inference_cost: null },
  completion_tokens_details: { reasoning_tokens: 40 },
};
const STREAM = [
  ': OPENROUTER PROCESSING\n\n',
  chunk({ role: 'assistant', content: '', reasoning: 'Keep it short.' }),
  ...ANSWER.match(/.{1,7}/gu).map((piece) => chunk({ role: 'assistant', content: piece })),
  chunk({ role: 'assistant', content: '' }, 'stop'),
  chunk({ role: 'assistant', content: '' }, 'stop', { usage: USAGE }),
  'data: [DONE]\n\n',
].join('');

async function run(response) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return response;
  };
  const got = { text: '', waits: 0, sent };
  ({ finish: got.finish, usage: got.usage } = await streamChat({
    apiKey: 'sk-or-test',
    body: { model: 'anthropic/claude-opus-5.5', messages: [] },
    onText: (piece) => (got.text += piece),
    onWait: () => (got.waits += 1),
  }));
  return got;
}

for (const sizes of [[1], [5, 3, 17], [64], [100000]]) {
  test(`reads the whole answer when the network cuts it every ${sizes.join('/')} bytes`, async () => {
    const got = await run(streamed(STREAM, sizes));
    assert.equal(got.text, ANSWER);
    assert.equal(got.finish, 'stop');
  });
}

test('keeps the token and cost counts from the last chunk', async () => {
  const got = await run(streamed(STREAM, [5, 3, 17]));
  assert.deepEqual(got.usage, USAGE);
  const bare = await run(streamed(chunk({ content: 'Hi' }, 'stop'), [64]));
  assert.equal(bare.usage, null);
});

test('a cost is what OpenRouter charged, plus the provider bill when the key is your own', () => {
  assert.equal(costOf(USAGE), 0.0116);
  assert.equal(costOf({ ...USAGE, cost: 0 }), 0);
  assert.equal(costOf({ ...USAGE, is_byok: true, cost: 0.0006, cost_details: { upstream_inference_cost: 0.0116 } }), 0.0006 + 0.0116);
  assert.equal(costOf({ prompt_tokens: 10, completion_tokens: 20 }), null);
  assert.equal(costOf(null), null);
});

test('sends the key and asks for a stream', async () => {
  const { sent } = await run(streamed(STREAM, [64]));
  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(sent[0].init.headers.Authorization, 'Bearer sk-or-test');
  assert.deepEqual(JSON.parse(sent[0].init.body), { model: 'anthropic/claude-opus-5.5', messages: [], stream: true });
});

test('reports chunks that carry no answer text, so the caller can stay awake', async () => {
  const got = await run(streamed(': OPENROUTER PROCESSING\n\n' + chunk({ content: 'Hi' }, 'stop'), [26, 100000]));
  assert.equal(got.waits, 1);
  assert.equal(got.text, 'Hi');
});

test('a stream that ends without a finish reason is not reported as finished', async () => {
  const got = await run(streamed(chunk({ content: 'Hi Dana, pricing is' }), [64]));
  assert.equal(got.finish, null);
});

test('a reply cut off by the token limit says so', async () => {
  const got = await run(streamed(chunk({ content: 'Hi Dana' }) + chunk({ content: '' }, 'length'), [64]));
  assert.equal(got.finish, 'length');
});

test('an error in the middle of the stream is thrown, with its status', async () => {
  const failed = `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', error: { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}\n\n`;
  await assert.rejects(run(streamed(chunk({ content: 'Hi' }) + failed, [64])), (err) => {
    assert.ok(err instanceof OpenRouterError);
    assert.equal(err.status, 429);
    assert.equal(err.message, 'Rate limit exceeded');
    return true;
  });
  const named = `data: ${JSON.stringify({ error: { code: 'server_error', message: 'Provider disconnected unexpectedly' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}\n\n`;
  await assert.rejects(run(streamed(named, [64])), { status: 502, message: 'Provider disconnected unexpectedly' });
});

test('a rejected key is thrown before any stream', async () => {
  const rejected = () => json(401, { error: { message: 'User not found.', code: 401 } });
  await assert.rejects(run(rejected()), { status: 401, message: 'User not found.' });
  globalThis.fetch = async () => rejected();
  await assert.rejects(checkKey('sk-or-wrong'), { status: 401 });
});

test('looks a model up by ID without sending the key', async () => {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push({ url, init });
    return url.includes('claude-opus-5-5') ? json(404, { error: { message: 'Not Found', code: 404 } }) : json(200, { data: { id: 'x', endpoints: [] } });
  };
  assert.equal(await modelExists('anthropic/claude-opus-5.5:nitro'), true);
  assert.equal(await modelExists('claude-opus-5-5'), false);
  assert.equal(asked[0].url, 'https://openrouter.ai/api/v1/models/anthropic/claude-opus-5.5%3Anitro/endpoints');
  assert.deepEqual(asked[0].init.headers, {});
});

test('finds a zero-retention provider for a model, variants included, without sending the key', async () => {
  const asked = [];
  // Two entries from the live list, 2026-11-11.
  globalThis.fetch = async (url, init) => {
    asked.push({ url, init });
    return json(200, { data: [{ model_id: 'anthropic/claude-opus-5.5', provider_name: 'Amazon Bedrock', tag: 'amazon-bedrock' }, { model_id: 'fish-audio/s2.1-pro-free:free', provider_name: 'Fish Audio', tag: 'fish-audio' }] });
  };
  assert.deepEqual((await zdrEndpoints('anthropic/claude-opus-5.5:nitro')).map((e) => e.provider_name), ['Amazon Bedrock']);
  assert.equal((await zdrEndpoints('fish-audio/s2.1-pro-free:free')).length, 1);
  assert.deepEqual(await zdrEndpoints('example/keeps-data'), []);
  assert.equal(asked[0].url, 'https://openrouter.ai/api/v1/endpoints/zdr');
  assert.deepEqual(asked[0].init.headers, {});
});

test('requests go only to endpoints with no retention of any kind', () => {
  const e = (tag, safety_retention) => ({ model_id: 'example/model', tag, safety_retention });
  // Live slugs for the default model, 2026-11-11: none keeps data.
  assert.deepEqual(keepNothing([e('amazon-bedrock', false), e('amazon-bedrock/us-east-1', false), e('google-vertex/us', false)]), ['amazon-bedrock', 'amazon-bedrock/us-east-1', 'google-vertex/us']);
  // Safety Retention, or no answer about it, keeps data: left out.
  assert.deepEqual(keepNothing([e('google-vertex/global', true), e('fireworks', undefined)]), []);
  // A bare slug would also reach a region that keeps data, so only the clean region is named.
  assert.deepEqual(keepNothing([e('google-vertex', false), e('google-vertex/global', true), e('google-vertex/us', false)]), ['google-vertex/us']);
  assert.deepEqual(keepNothing([e(undefined, false)]), []);
});
