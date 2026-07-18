// Parsing e handlers dos comandos do WhatsApp.
import { getConfig, updateConfig } from './config.js';
import { getLastTime, setLastTime, resetGroup } from './state.js';
import { fetchNewMessages } from './fetcher.js';
import { splitIntoPatients, extractName, extractSurgery } from './parser.js';
import { loadMedia } from './mediastore.js';
import { sendText } from './ultramsg.js';
import { runTriage } from './triage.js';
import { formatTriageReply } from './format.js';

const PREFIX = process.env.TRIGGER_PREFIX || '/';

// Lock por chatId: impede dois /analisar simultâneos processarem os mesmos casos.
// Sem isso, enquanto o Claude processa (até 2 min), um segundo /analisar busca
// as mesmas mensagens e gera resposta duplicada para o mesmo paciente.
const analyzing = new Set();

const ADMINS = (process.env.ADMIN_NUMBERS || '')
  .split(',')
  .map((s) => s.trim().replace(/\D/g, ''))
  .filter(Boolean);

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
    case 'ajuda':
    case 'help':
    case 'comandos':
      return sendText(chatId, helpText());

    case 'analisar':
    case 'triagem':
      return doAnalisar(chatId, msg);

    case 'status':
      return doStatus(chatId);

    case 'resetar':
    case 'reset':
      return requireAdmin(chatId, msg, () => doReset(chatId));

    case 'cirurgias':
      return listSurgeries(chatId);

    case 'limites':
      return listLimits(chatId);

    case 'prompt':
      return showPrompt(chatId);

    // ---- edição (admin) ----
    case 'addcirurgia':
      return requireAdmin(chatId, msg, () => addSurgery(chatId, args));
    case 'delcirurgia':
      return requireAdmin(chatId, msg, () => delSurgery(chatId, args));
    case 'addlimite':
      return requireAdmin(chatId, msg, () => addLimit(chatId, args));
    case 'dellimite':
      return requireAdmin(chatId, msg, () => delLimit(chatId, args));
    case 'setprompt':
      return requireAdmin(chatId, msg, () => setPrompt(chatId, args));
    case 'limparprompt':
      return requireAdmin(chatId, msg, () => setPrompt(chatId, ''));

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
  // Lock por chatId: impede que dois /analisar simultâneos processem os mesmos casos.
  if (analyzing.has(chatId)) {
    return sendText(chatId, '⏳ Já há uma análise em andamento para este grupo. Aguarde a conclusão antes de rodar /analisar novamente.');
  }
  analyzing.add(chatId);

  // Registra o timestamp do comando IMEDIATAMENTE como novo ponto de corte.
  // Isso fecha a janela de race condition: qualquer /analisar que chegar agora
  // (enquanto o Claude processa) vai ver um lastTime atualizado e não buscará
  // as mesmas mensagens de novo.
  const cmdTime = cmdMsg?.timestamp || cmdMsg?.time;
  if (cmdTime) setLastTime(chatId, cmdTime);

  const lastTime = getLastTime(chatId);

  try {
    await sendText(chatId, `🔍 Buscando mensagens novas no grupo...`);

    let messages;
    try {
      messages = await fetchNewMessages(chatId, lastTime);
    } catch (e) {
      console.error('[doAnalisar] fetchNewMessages error:', e);
      return sendText(chatId, `❌ Erro ao buscar mensagens: ${e.message}`);
    }

    if (messages.length === 0) {
      return sendText(chatId, `✅ Nenhuma mensagem nova desde a última análise.\n\nSe acabou de enviar as avaliações, tente /resetar e depois /analisar.`);
    }

    // Mescla URLs de mídia do store persistente (GET API não retorna media URLs).
    const messagesWithMedia = messages.map((m) => {
      if ((m.type === 'image' || m.type === 'document') && !m.media) {
        const stored = loadMedia(m.id);
        console.error(`[commands] mídia id=${m.id} type=${m.type} store=${stored ? 'ENCONTRADO' : 'AUSENTE'}`);
        if (stored) return { ...m, media: stored.url };
      }
      return m;
    });

    console.error(`[doAnalisar] chatId=${chatId} mensagens=${messagesWithMedia.length}`);
    for (const m of messagesWithMedia) {
      const t = m.timestamp || m.time || 0;
      const preview = (m.body || '').trim().slice(0, 60).replace(/\n/g, '↵');
      console.error(`  [msg] type=${m.type} fromMe=${m.fromMe} t=${t} body="${preview}"`);
    }

    const patients = splitIntoPatients(messagesWithMedia);
    console.error(`[doAnalisar] casos identificados=${patients.length}`);

    if (patients.length === 0) {
      return sendText(chatId, '⚠️ Nenhum caso novo encontrado.\n\nVerifique se o caso foi aberto com *xxxx* e fechado com *❌❌❌❌*.\n\nApenas o conteúdo enviado ENTRE esses dois marcadores é avaliado.');
    }

    const total = patients.length;
    await sendText(chatId, `📋 ${total} caso(s) novo(s) encontrado(s). Iniciando análise...`);

    for (const patient of patients) {
      const label = patient.index;
      const totalMedia = patient._mediaCount || patient.media.length;
      const urlOk = patient.media.length;
      const urlMissing = totalMedia - urlOk;
      await sendText(chatId, `⏳ Analisando caso ${label}/${total} (${urlOk} exame(s) com URL, ${patient.texts.length} texto(s))...`);

      if (urlMissing > 0) {
        await sendText(chatId,
          `⚠️ *${urlMissing} arquivo(s) detectado(s) sem URL disponível.*\n\n` +
          `Isso acontece quando o servidor foi reiniciado depois que os arquivos foram enviados. ` +
          `Por favor, *reenvie os PDFs/imagens* do caso e rode /analisar novamente para incluí-los na análise.\n\n` +
          `A análise abaixo foi feita apenas com o texto da anamnese.`
        );
      }

      try {
        const patientName = extractName(patient.texts) || `Caso ${label}`;
        const surgeryType = extractSurgery(patient.texts);
        console.error(`[doAnalisar] caso ${label}: paciente="${patientName}" cirurgia="${surgeryType}" textos=${patient.texts.length} mídias=${urlOk}/${totalMedia}`);
        const { fullText, errors } = await runTriage({
          patientName,
          surgeryType,
          anamnesis: patient.texts.join('\n\n'),
          media: patient.media,
        });

        if (total > 1) {
          await sendText(chatId, `━━━━━━━━━━━━━━━━━━━━\n📁 CASO ${label}/${total}\n━━━━━━━━━━━━━━━━━━━━`);
        }

        for (const m of formatTriageReply(fullText)) {
          await sendText(chatId, m);
        }

        if (errors.length) {
          await sendText(chatId, `⚠️ Caso ${label}: ${errors.length} arquivo(s) não puderam ser lidos e foram ignorados.`);
        }
      } catch (e) {
        console.error(`[analisar] erro no caso ${label}:`, e);
        await sendText(chatId, `❌ Erro no caso ${label}: ${e.message}`);
      }
    }

    // Atualiza para o maior entre timestamp do comando e da última mensagem.
    const newestTime = messages[messages.length - 1]?.timestamp || messages[messages.length - 1]?.time;
    const cutoff = Math.max(cmdTime || 0, newestTime || 0);
    if (cutoff) setLastTime(chatId, cutoff);

    if (total > 1) {
      await sendText(chatId, `✅ Análise concluída — ${total} caso(s) processado(s).`);
    }
  } finally {
    // Libera o lock sempre, mesmo em caso de erro inesperado.
    analyzing.delete(chatId);
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
  return sendText(chatId, `📊 Status deste grupo:\n• Última análise: ${date}\n\nUse ${PREFIX}analisar para rodar a triagem dos casos novos.`);
}

async function doReset(chatId) {
  resetGroup(chatId);
  return sendText(chatId, '🔄 Posição de leitura resetada. Na próxima análise, o bot lerá TODAS as mensagens disponíveis do grupo.');
}

// ─────────────────────────────────────────────
// LISTAGENS
// ─────────────────────────────────────────────

function listSurgeries(chatId) {
  const { surgeries } = getConfig();
  if (!surgeries.length) return sendText(chatId, 'Nenhuma cirurgia cadastrada. Use ' + PREFIX + 'addcirurgia.');
  let out = '🔪 CIRURGIAS CADASTRADAS\n\n';
  for (const s of surgeries) {
    out += `• ${s.name} (key: ${s.key})\n   Exames: ${(s.required_exams || []).join(', ')}\n\n`;
  }
  return sendText(chatId, out.trim());
}

function listLimits(chatId) {
  const { examLimits } = getConfig();
  if (!examLimits.length) return sendText(chatId, 'Nenhum limite cadastrado. Use ' + PREFIX + 'addlimite.');
  let out = '📊 LIMITES / VALORES DE REFERÊNCIA\n\n';
  for (const l of examLimits) {
    out += `• ${l.exam_name}: ${l.description}`;
    if (l.unit) out += ` (${l.unit})`;
    if (l.notes) out += `\n   Obs: ${l.notes}`;
    out += '\n\n';
  }
  return sendText(chatId, out.trim());
}

function showPrompt(chatId) {
  const { extraPrompt } = getConfig();
  return sendText(chatId, extraPrompt
    ? `📝 Instruções adicionais ativas:\n\n${extraPrompt}`
    : '📝 Nenhuma instrução adicional. O bot usa o protocolo padrão de triagem.');
}

// ─────────────────────────────────────────────
// EDIÇÃO DE CONFIG
// ─────────────────────────────────────────────

function addSurgery(chatId, args) {
  const [key, name, examsRaw] = args.split(';').map((s) => s.trim());
  if (!key || !name) {
    return sendText(chatId, `Uso:\n${PREFIX}addcirurgia chave; Nome da cirurgia; exame1, exame2, exame3`);
  }
  const required_exams = (examsRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
  updateConfig((c) => {
    const idx = c.surgeries.findIndex((s) => s.key === key);
    const entry = { key, name, required_exams };
    if (idx >= 0) c.surgeries[idx] = entry;
    else c.surgeries.push(entry);
  });
  return sendText(chatId, `✅ Cirurgia "${name}" salva (key: ${key}) com ${required_exams.length} exame(s).`);
}

function delSurgery(chatId, args) {
  const key = args.trim();
  if (!key) return sendText(chatId, `Uso: ${PREFIX}delcirurgia chave`);
  let removed = false;
  updateConfig((c) => {
    const before = c.surgeries.length;
    c.surgeries = c.surgeries.filter((s) => s.key !== key);
    removed = c.surgeries.length < before;
  });
  return sendText(chatId, removed ? `🗑️ Cirurgia "${key}" removida.` : `Não encontrei a key "${key}".`);
}

function addLimit(chatId, args) {
  const [exam_name, description, unit, notes] = args.split(';').map((s) => (s || '').trim());
  if (!exam_name || !description) {
    return sendText(chatId, `Uso:\n${PREFIX}addlimite Nome do exame; descrição/limite; unidade (opcional); observação (opcional)`);
  }
  updateConfig((c) => {
    const idx = c.examLimits.findIndex((l) => l.exam_name.toLowerCase() === exam_name.toLowerCase());
    const entry = { exam_name, description, unit: unit || '', notes: notes || '' };
    if (idx >= 0) c.examLimits[idx] = entry;
    else c.examLimits.push(entry);
  });
  return sendText(chatId, `✅ Limite "${exam_name}" salvo.`);
}

function delLimit(chatId, args) {
  const name = args.trim();
  if (!name) return sendText(chatId, `Uso: ${PREFIX}dellimite Nome do exame`);
  let removed = false;
  updateConfig((c) => {
    const before = c.examLimits.length;
    c.examLimits = c.examLimits.filter((l) => l.exam_name.toLowerCase() !== name.toLowerCase());
    removed = c.examLimits.length < before;
  });
  return sendText(chatId, removed ? `🗑️ Limite "${name}" removido.` : `Não encontrei o exame "${name}".`);
}

function setPrompt(chatId, args) {
  updateConfig((c) => { c.extraPrompt = args; });
  return sendText(chatId, args
    ? '✅ Instruções adicionais atualizadas.'
    : '✅ Instruções adicionais removidas.');
}

// ─────────────────────────────────────────────
// AJUDA
// ─────────────────────────────────────────────

function helpText() {
  return `🤖 BOT DE AVALIAÇÃO PRÉ-ANESTÉSICA

*PROTOCOLO DE ENVIO (obrigatório):*
1️⃣ Digite exatamente: *xxxx*
   (ABRE o caso — envie ANTES de qualquer mensagem do paciente)
2️⃣ Encaminhe a ficha de anamnese preenchida pelo paciente
   (inclui Procedimento, respostas ao questionário, exames, PDFs)
3️⃣ Digite exatamente: *❌❌❌❌*
   (FECHA o caso)
4️⃣ Quando quiser analisar, envie:
   ${PREFIX}analisar

⚠️ Somente o que estiver ENTRE *xxxx* e *❌❌❌❌* será avaliado.
⚠️ Envie o *xxxx* ANTES de encaminhar a ficha — do contrário o Procedimento não será lido.

COMANDOS:
${PREFIX}analisar — analisa casos novos do grupo
${PREFIX}status — mostra quando foi a última análise
${PREFIX}cirurgias — lista cirurgias e exames exigidos
${PREFIX}limites — lista valores de referência
${PREFIX}prompt — mostra instruções extras ativas
${PREFIX}ajuda — esta mensagem

EDIÇÃO (admin):
${PREFIX}addcirurgia chave; Nome; exame1, exame2
${PREFIX}delcirurgia chave
${PREFIX}addlimite Exame; descrição; unidade; obs
${PREFIX}dellimite Exame
${PREFIX}setprompt texto extra para o protocolo
${PREFIX}limparprompt
${PREFIX}resetar — reprocessa o histórico completo do grupo

⚠️ Ferramenta de apoio. Não substitui avaliação médica presencial.`;
}
