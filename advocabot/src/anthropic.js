const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096', 10);
// Multi-agente: cada chamada pode levar até 3 minutos; CEO até 5 min.
const TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '300000', 10);

export async function analyze(system, contentBlocks, opts = {}) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens || MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: Claude não respondeu a tempo.');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText.substring(0, 300)}`);
  }

  const result = await res.json();
  return result.content?.[0]?.text || '';
}
