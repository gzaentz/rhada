// The whole OpenRouter client: one streaming chat call and three free checks.
// Formats follow openrouter.ai/docs (streaming, errors), read 2026-11-09.
const API = 'https://openrouter.ai/api/v1';

export class OpenRouterError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { apiKey, ...init } = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      ...(init.body && { 'Content-Type': 'application/json' }),
    },
  });
  if (response.ok) return response;
  // A failure before the stream starts is plain JSON.
  const body = await response.json().catch(() => null);
  throw new OpenRouterError(response.status, body?.error?.message || response.statusText);
}

// Streams one chat completion. Resolves to { finish, usage }: the finish reason
// ("stop" when the model finished on its own) and the token and cost counts
// OpenRouter sends on the last chunk. onText gets each piece of the answer.
// onWait fires for network chunks that carry none: reasoning and keep-alives.
// onProvider gets the provider OpenRouter names on a chunk, before any of its
// text, and may throw to stop the stream.
export async function streamChat({ apiKey, signal, body, onText, onWait, onProvider = () => {} }) {
  const response = await request('/chat/completions', {
    apiKey,
    signal,
    method: 'POST',
    body: JSON.stringify({ ...body, stream: true }),
  });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let finish = null;
  let usage = null;
  try {
    return await read();
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }
  async function read() {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { finish, usage };
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      let wrote = false;
      for (const line of lines) {
        // Skips blank separators and comments such as ": OPENROUTER PROCESSING".
        if (!line.startsWith('data:')) continue;
        let chunk;
        try {
          chunk = JSON.parse(line.slice(5));
        } catch {
          continue; // "[DONE]"
        }
        // A failure after the 200 was sent arrives as a chunk.
        if (chunk.error) throw new OpenRouterError(Number(chunk.error.code) || 502, chunk.error.message);
        if (chunk.provider) onProvider(String(chunk.provider));
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          onText(choice.delta.content);
          wrote = true;
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage;
      }
      if (!wrote) onWait();
    }
  }
}

// Whether a provider OpenRouter names, such as "Amazon Bedrock" or
// "amazon-bedrock", is one of the allowed endpoints. Names must match whole,
// so "Google AI Studio" never passes for Google Vertex.
export function isAllowed(provider, endpoints, only) {
  const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = squash(provider);
  if (!name) return false;
  const known = endpoints.filter((e) => only.includes(e.tag)).flatMap((e) => [squash(e.provider_name), squash(e.tag.split('/')[0])]);
  return known.includes(name);
}

// What a request cost in US dollars, or null when OpenRouter did not say.
// With your own provider key (BYOK) the provider bills you directly, so its
// part is added to OpenRouter's fee.
export function costOf(usage) {
  if (typeof usage?.cost !== 'number') return null;
  const upstream = usage.is_byok ? Number(usage.cost_details?.upstream_inference_cost) || 0 : 0;
  return usage.cost + upstream;
}

// Throws with status 401 when OpenRouter does not accept the key. Costs nothing.
export async function checkKey(apiKey, { signal } = {}) {
  await request('/key', { apiKey, signal });
}

// Every endpoint OpenRouter counts as zero data retention. A public list, so
// the key is not sent.
export async function zdrList({ signal } = {}) {
  const { data } = await (await request('/endpoints/zdr', { signal })).json();
  return data;
}

// The entries of that list for one model, variants such as ":nitro" included.
export function endpointsFor(list, model) {
  const base = model.split(':')[0];
  return list.filter((endpoint) => endpoint.model_id === model || endpoint.model_id === base);
}

export async function zdrEndpoints(model, { signal } = {}) {
  return endpointsFor(await zdrList({ signal }), model);
}

// The endpoints a request may go to: zero retention and no "Safety Retention"
// (kept to check for abuse), whatever the account's privacy setting. Each is
// named by its slug, such as "amazon-bedrock/us-east-1". A bare provider slug
// covers all its regions, so it is used only when none of them keeps data.
// Service tiers (flex is slower, priority costs more) are left out: naming
// one would opt into it.
export function keepNothing(endpoints) {
  const keepers = endpoints.filter((e) => e.safety_retention !== false).map((e) => e.tag ?? '');
  const clean = endpoints.filter(
    (e) =>
      e.safety_retention === false &&
      !e.service_tier &&
      e.tag &&
      !keepers.some((tag) => tag === e.tag || tag.startsWith(`${e.tag}/`)),
  );
  return [...new Set(clean.map((e) => e.tag))];
}

// A public lookup, so the key is not sent. Also knows variants such as ":nitro".
export async function modelExists(model, { signal } = {}) {
  const path = model.split('/').map(encodeURIComponent).join('/');
  try {
    await request(`/models/${path}/endpoints`, { signal });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}
