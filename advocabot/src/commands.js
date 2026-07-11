import { getConfig, updateConfig } from './config.js';
import { getLastTime, setLastTime, resetGroup } from './state.js';
import { fetchNewMessages } from './fetcher.js';
import { splitIntoCases, extractClientName, extractCaseType } from './parser.js';
import { loadMedia } from './mediastore.js';
import { sendText } from './ultramsg.js';
import { runLegalAnalysis } from './orchestrator.js';
import { formatLegalReply } from './format.js';

const PREFIX = process.env.TRIGGER_PREFIX || '/';
const ADMINS = (process.env.ADMIN_NUMBERS || '')
  .split(',').map((s) => s.trim().replace(/\D/g, '')).filter(Boolean);

export function isCommand(body) {
  return typeof body === 'string' && body.trim().startsWith(PREFIX);
}

function parse(body) {
  const trimmed = body.trim().slice(PREFIX.length);
  const sp = trimmed.indexOf(' ');
  const cmd = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
  const args = sp === -1 ? '' : trimmed.slice(sp + 1).trim();
  return { cmd, args };
}

function senderNumber(msg) {
  const raw = msg.author || msg.from || '';
  return raw.replace(/@.*/, '').replace(/\D/g, '');
}

function isAdmin(msg) {
  if (ADMINS.length === 0) return true;
  return ADMINS.includes(senderNumber(msg));
}

export async function handleCommand(chatId, body, msg) {
  const { cmd, args } = parse(body);

  switch (cmd) {
    case 'analisar':
    case 'analise':
      return doAnalisar(chatId, msg);

    case 'status':
      return doStatus(chatId);

    case 'resetar':
    case 'reset':
      return requireAdmin(chatId, msg, () => doReset(chatId));

    case 'areas':
      return listAreas(chatId);

    case 'prompt':
      return showPrompt(chatId);

    case 'ajuda':
    case 'help':
    case 'comandos':
      return sendText(chatId, helpText());

    // ---- edição (admin) ----
    case 'setprompt':
      return requireAdmin(chatId, msg, () => setPrompt(chatId, args));
    case 'limparprompt':
      return requireAdmin(chatId, msg, () => setPrompt(chatId, ''));
    case 'ativararea':
      return requireAdmin(chatId, msg, () => toggleArea(chatId, args, true));
    case 'desativararea':
      return requireAdmin(chatId, msg, () => toggleArea(chatId, args, false));

    default:
      return sendText(chatId, `❓ Comando desconhecido: ${PREFIX}${cmd}\nDigite ${PREFIX}ajuda para ver a lista.`);
  }
}

function requireAdmin(chatId, msg, fn) {
  if (!isAdmin(msg)) {
    return sendText(chatId, '⛔ Você não tem permissão para este comando.');
  }
  return fn();
}

// ─────────────────────────────────────────────
// ANÁLISE PRINCIPAL
// ─────────────────────────────────────────────

async function doAnalisar(chatId, cmdMsg) {
  const lastTime = getLastTime(chatId);

  await sendText(chatId, `🔍 Buscando mensagens novas no grupo...`);

  let messages;
  try {
    messages = await fetchNewMessages(chatId, lastTime);
  } catch (e) {
    console.error('[doAnalisar] fetchNewMessages error:', e);
    return sendText(chatId, `❌ Erro ao buscar mensagens: ${e.message}`);
  }

  if (messages.length === 0) {
    return sendText(chatId, `✅ Nenhuma mensagem nova desde a última análise.\n\nSe acabou de enviar o caso, tente /resetar e depois /analisar.`);
  }

  // Injeta URLs de mídia do store persistente (webhook salva, GET API não retorna)
  const messagesWithMedia = messages.map((m) => {
    if ((m.type === 'image' || m.type === 'document') && !m.media) {
      const stored = loadMedia(m.id);
      console.error(`[commands] mídia id=${m.id} type=${m.type} getMedia=NO store=${stored ? 'ENCONTRADO' : 'AUSENTE'}`);
      if (stored) return { ...m, media: stored.url };
    } else if ((m.type === 'image' || m.type === 'document') && m.media) {
      console.error(`[commands] mídia id=${m.id} type=${m.type} getMedia=YES`);
    }
    return m;
  });

  console.error(`[doAnalisar] chatId=${chatId} mensagens=${messagesWithMedia.length}`);
  for (const m of messagesWithMedia) {
    const t = m.timestamp || m.time || 0;
    const preview = (m.body || '').trim().slice(0, 60).replace(/\n/g, '↵');
    console.error(`  [msg] type=${m.type} fromMe=${m.fromMe} t=${t} media=${m.media ? 'URL-OK' : 'SEM-URL'} body="${preview}"`);
  }

  const cases = splitIntoCases(messagesWithMedia);
  console.error(`[doAnalisar] casos identificados=${cases.length}`);

  if (cases.length === 0) {
    return sendText(chatId, '⚠️ Mensagens encontradas mas nenhum caso identificado.\n\nInicie o caso com ⚖️ ou 📋 e encerre com ❌❌❌❌.');
  }

  const total = cases.length;
  await sendText(chatId, `📋 ${total} caso(s) novo(s) encontrado(s). Iniciando análise multi-agente...`);

  const config = getConfig();

  for (const caseBlock of cases) {
    const label = caseBlock.index;
    const totalMedia = caseBlock._mediaCount || caseBlock.media.length;
    const urlOk = caseBlock.media.length;
    const urlMissing = totalMedia - urlOk;

    await sendText(chatId, `⏳ Analisando caso ${label}/${total} (${urlOk} documento(s), ${caseBlock.texts.length} texto(s))...\n\n🔄 Classificando → Especialistas → CEO...`);

    if (urlMissing > 0) {
      await sendText(chatId,
        `⚠️ *${urlMissing} arquivo(s) detectado(s) sem URL disponível.*\n\n` +
        `O servidor foi reiniciado depois que esses arquivos foram enviados. ` +
        `*Reenvie os documentos/PDFs* e rode /analisar novamente para incluí-los na análise.`
      );
    }

    try {
      const clientName = extractClientName(caseBlock.texts) || `Caso ${label}`;
      const caseType = extractCaseType(caseBlock.texts);
      console.error(`[doAnalisar] caso ${label}: cliente="${clientName}" tipo="${caseType}" textos=${caseBlock.texts.length} mídias=${urlOk}/${totalMedia}`);

      const { finalOpinion, classification, specialistResults, errors } = await runLegalAnalysis({
        clientName,
        anamnesis: caseBlock.texts.join('\n\n'),
        media: caseBlock.media,
        config,
      });

      // Separador entre casos múltiplos
      if (total > 1) {
        await sendText(chatId, `━━━━━━━━━━━━━━━━━━━━\n📁 CASO ${label}/${total}\n━━━━━━━━━━━━━━━━━━━━`);
      }

      // Envia parecer final do CEO
      for (const chunk of formatLegalReply(finalOpinion)) {
        await sendText(chatId, chunk);
      }

      if (errors.length) {
        await sendText(chatId, `⚠️ Caso ${label}: ${errors.length} arquivo(s) não puderam ser lidos e foram ignorados.`);
      }
    } catch (e) {
      console.error(`[doAnalisar] erro no caso ${label}:`, e);
      await sendText(chatId, `❌ Erro no caso ${label}: ${e.message}`);
    }
  }

  // Salva timestamp do comando como ponto de corte
  const cmdTime = (cmdMsg?.timestamp || cmdMsg?.time);
  const newestTime = (messages[messages.length - 1]?.timestamp || messages[messages.length - 1]?.time);
  const cutoff = Math.max(cmdTime || 0, newestTime || 0);
  if (cutoff) setLastTime(chatId, cutoff);

  if (total > 1) {
    await sendText(chatId, `✅ Análise concluída — ${total} caso(s) processado(s).`);
  }
}

// ─────────────────────────────────────────────
// STATUS / RESET
// ─────────────────────────────────────────────

async function doStatus(chatId) {
  const lastTime = getLastTime(chatId);
  const date = lastTime
    ? new Date(lastTime * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'nunca (vai analisar tudo disponível)';
  return sendText(chatId, `📊 Status deste grupo:\n• Última análise: ${date}\n\nUse ${PREFIX}analisar para analisar casos novos.`);
}

async function doReset(chatId) {
  resetGroup(chatId);
  return sendText(chatId, '🔄 Posição de leitura resetada. Na próxima análise, o bot lerá TODAS as mensagens disponíveis do grupo.');
}

// ─────────────────────────────────────────────
// LISTAGENS
// ─────────────────────────────────────────────

function listAreas(chatId) {
  const { areas } = getConfig();
  let out = '⚖️ ÁREAS JURÍDICAS ATIVAS\n\n';
  for (const a of areas) {
    out += `${a.active ? '✅' : '❌'} ${a.name} (key: ${a.key})\n`;
  }
  out += `\nUse ${PREFIX}ativararea <key> ou ${PREFIX}desativararea <key> para gerenciar.`;
  return sendText(chatId, out.trim());
}

function showPrompt(chatId) {
  const { extraPrompt } = getConfig();
  return sendText(chatId, extraPrompt
    ? `📝 Instruções adicionais ativas:\n\n${extraPrompt}`
    : '📝 Nenhuma instrução adicional. O bot usa o protocolo padrão.');
}

// ─────────────────────────────────────────────
// EDIÇÃO DE CONFIG (admin)
// ─────────────────────────────────────────────

function setPrompt(chatId, args) {
  updateConfig((c) => { c.extraPrompt = args; });
  return sendText(chatId, args
    ? '✅ Instruções adicionais atualizadas.'
    : '✅ Instruções adicionais removidas.');
}

function toggleArea(chatId, args, active) {
  const key = args.trim().toLowerCase();
  if (!key) return sendText(chatId, `Uso: ${PREFIX}${active ? 'ativar' : 'desativar'}area <key>\nExemplo: ${PREFIX}${active ? 'ativar' : 'desativar'}area penal`);
  let found = false;
  updateConfig((c) => {
    const a = c.areas.find(x => x.key === key);
    if (a) { a.active = active; found = true; }
  });
  return sendText(chatId, found
    ? `${active ? '✅ Área ativada' : '❌ Área desativada'}: ${key}`
    : `Área "${key}" não encontrada. Use ${PREFIX}areas para ver as disponíveis.`
  );
}

// ─────────────────────────────────────────────
// AJUDA
// ─────────────────────────────────────────────

function helpText() {
  return `🤖 ADVOCABOT — IA JURÍDICA MULTI-AGENTE

COMO USAR:
1. Inicie o caso com ⚖️ ou 📋
   Exemplo: ⚖️ Fui demitido sem justa causa em SP após 5 anos...
2. Envie os documentos do caso: contratos, notificações, PDFs, prints
3. Encerre com: ❌❌❌❌
4. Quando quiser análise, envie:
   ${PREFIX}analisar
5. O bot classifica o caso, roda especialistas em paralelo e o CEO entrega o parecer

SISTEMA MULTI-AGENTE:
🔍 Classificador → identifica as áreas jurídicas relevantes
⚖️ Especialistas → analisam em paralelo (trabalhista, cível, penal, etc.)
👨‍⚖️ CEO → sintetiza tudo em um parecer definitivo

ÁREAS COBERTAS:
• Tributário • Trabalhista • Civil • Penal
• Empresarial/Financeiro • Consumidor
• Família/Sucessões • Previdenciário

COMANDOS:
${PREFIX}analisar — analisa casos novos do grupo
${PREFIX}status — mostra quando foi a última análise
${PREFIX}areas — lista áreas jurídicas e status
${PREFIX}prompt — mostra instruções extras ativas
${PREFIX}ajuda — esta mensagem

ADMIN:
${PREFIX}ativararea <key> — ativa uma área (ex: penal)
${PREFIX}desativararea <key> — desativa uma área
${PREFIX}setprompt <texto> — instrução extra para o CEO
${PREFIX}limparprompt — remove instrução extra
${PREFIX}resetar — reprocessa histórico completo do grupo

⚠️ Ferramenta de apoio à advocacia. Não substitui advogado habilitado (OAB).`;
}
