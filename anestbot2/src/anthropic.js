// Chamada à API da Anthropic (Claude) para gerar a triagem.
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
// Guarda de NaN: um typo na env var viraria max_tokens:null e quebraria 100%
// das chamadas com erro genérico da API, difícil de diagnosticar.
const _mt = parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096', 10);
const MAX_TOKENS = Number.isFinite(_mt) && _mt > 0 ? _mt : 4096;
const TIMEOUT_MS = 120_000;

export async function analyze(system, contentBlocks) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: contentBlocks }] }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: Claude não respondeu em 2 minutos.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API ${res.status}: ${t.substring(0, 300)}`);
  }
  // Corpo truncado/corrompido (conexão caindo no meio do stream) não pode
  // virar SyntaxError solto — vira erro nomeado que o chamador reporta limpo.
  const result = await res.json().catch((e) => {
    throw new Error(`Claude API: resposta ilegível (${e.message}). Rode /analisar de novo.`);
  });
  return result.content?.[0]?.text || '';
}

// Ping mínimo (1 token) para a verificação automática confirmar que a API responde.
export async function ping() {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout (15s)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
