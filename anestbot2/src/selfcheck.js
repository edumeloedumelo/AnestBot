// Verificação automática do sistema — o "gatilho" do /resetar.
//
// Varre o estado do bot procurando erros REAIS (store corrompido, mensagens
// inválidas, duplicatas, config quebrada, volume/API fora do ar), CORRIGE
// automaticamente o que é corrigível e devolve um relatório do que foi feito.
import fs from 'fs';
import path from 'path';
import { selfHealChat } from './store.js';
import { getConfig } from './config.js';
import { ping } from './anthropic.js';

const STATE_DIR = process.env.STATE_DIR || '/data';

/**
 * Roda todas as checagens para um grupo. Nunca lança.
 * @returns {{ fixes: string[], ok: string[], warnings: string[] }}
 */
export async function runSelfCheck(chatId) {
  const fixes = [];    // erros encontrados E corrigidos automaticamente
  const ok = [];       // checagens que passaram
  const warnings = []; // problemas que exigem ação humana (env/infra)

  // 1. Integridade do store (mensagens sem id, duplicadas, timestamps inválidos…)
  try {
    const healed = selfHealChat(chatId);
    if (healed.length) fixes.push(...healed);
    else ok.push('Histórico de mensagens íntegro');
  } catch (e) {
    warnings.push(`Store: ${e.message}`);
  }

  // 2. Volume persistente gravável.
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const probe = path.join(STATE_DIR, '.selfcheck-probe');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    ok.push(`Volume ${STATE_DIR} gravável`);
  } catch (e) {
    warnings.push(`Volume ${STATE_DIR} NÃO gravável (${e.message}) — verifique o volume no Railway`);
  }

  // 3. Config (cirurgias/limites) legível e não-vazia.
  try {
    const cfg = getConfig();
    if (!Array.isArray(cfg.surgeries) || cfg.surgeries.length === 0) {
      warnings.push('Config sem cirurgias cadastradas — use /addcirurgia');
    } else {
      ok.push(`Config OK (${cfg.surgeries.length} cirurgias, ${(cfg.examLimits || []).length} limites)`);
    }
  } catch (e) {
    warnings.push(`Config: ${e.message}`);
  }

  // 4. Variáveis de ambiente essenciais.
  const missingEnv = ['ULTRAMSG_INSTANCE_ID', 'ULTRAMSG_TOKEN', 'ANTHROPIC_API_KEY']
    .filter((k) => !process.env[k]);
  if (missingEnv.length) warnings.push(`Variáveis ausentes: ${missingEnv.join(', ')}`);
  else ok.push('Variáveis de ambiente OK');

  // 5. API do Claude respondendo (ping mínimo).
  try {
    await ping();
    ok.push('API do Claude OK');
  } catch (e) {
    warnings.push(`API do Claude fora do ar: ${e.message}`);
  }

  return { fixes, ok, warnings };
}

// Formata o relatório para o WhatsApp — curto e visual.
export function formatSelfCheck({ fixes, ok, warnings }) {
  let out = '🔧 *VERIFICAÇÃO AUTOMÁTICA*\n';
  if (fixes.length) {
    out += `\n✅ *${fixes.length} correção(ões) aplicada(s):*\n` + fixes.map((f) => `• ${f}`).join('\n') + '\n';
  } else {
    out += '\n✅ Nenhum erro encontrado no código/estado.\n';
  }
  if (warnings.length) {
    out += `\n⚠️ *Requer sua ação:*\n` + warnings.map((w) => `• ${w}`).join('\n') + '\n';
  }
  out += `\n_${ok.length} checagem(ns) OK._`;
  return out.trim();
}
