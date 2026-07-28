// Parsing e handlers dos comandos do WhatsApp.
import { getConfig, updateConfig } from './config.js';
import { getLastTime, setLastTime, resetGroup, getProcessed, markProcessed, recordCase, retryRecentCases } from './state.js';
import { fetchNewMessages } from './fetcher.js';
import { splitIntoPatients, extractName, extractSurgery, getMessageBody } from './parser.js';
import { loadMedia, loadText, loadTextByTime } from './mediastore.js';
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
      return requireAdmin(chatId, msg, () => doRetryRecent(chatId, args));

    case 'resetartudo':
      return requireAdmin(chatId, msg, () => doResetTudo(chatId));

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

  // O lock e TODO acesso a estado ficam dentro do try/finally: assim, se qualquer
  // operação de estado falhar, o finally SEMPRE libera o lock (evita travar o grupo).
  analyzing.add(chatId);
  try {
    const cmdTime = cmdMsg?.timestamp || cmdMsg?.time || 0;

    // Corte da sessão ANTERIOR (não sobrescrever com "agora" — senão o gate de
    // recência descartaria o caso atual). É lido antes de qualquer escrita.
    const prevCutoff = getLastTime(chatId);
    const processedIds = getProcessed(chatId);

    await sendText(chatId, `🔍 Buscando mensagens novas no grupo...`);

    let messages;
    try {
      messages = await fetchNewMessages(chatId, prevCutoff);
    } catch (e) {
      console.error('[doAnalisar] fetchNewMessages error:', e);
      return sendText(chatId, `❌ Erro ao buscar mensagens: ${e.message}`);
    }

    if (messages.length === 0) {
      return sendText(chatId, `✅ Nenhuma mensagem nova desde a última análise.\n\nSe acabou de enviar as avaliações, tente /resetar e depois /analisar.`);
    }

    // Mescla dados do store persistente (populado pelo webhook em tempo real):
    // - URLs de mídia (GET API não retorna media URLs)
    // - TEXTO completo (GET pode truncar o corpo de mensagens longas, ex.: card de
    //   anamnese — o webhook guardou o texto integral). Se o texto do webhook for
    //   mais longo que o do GET, usamos ele: garante que a ficha completa (com
    //   "Procedimento:") chegue ao Claude.
    const messagesWithMedia = messages.map((m) => {
      let out = m;
      if ((m.type === 'image' || m.type === 'document') && !m.media) {
        const stored = loadMedia(m.id);
        console.error(`[commands] mídia id=${m.id} type=${m.type} store=${stored ? 'ENCONTRADO' : 'AUSENTE'}`);
        if (stored) out = { ...out, media: stored.url };
      }
      if (m.type === 'chat') {
        // Tenta por id exato; se não achar, tenta por (chat, timestamp) — mais
        // robusto porque o timestamp é estável entre webhook e GET.
        const storedText = loadText(m.id) || loadTextByTime(chatId, m.timestamp || m.time);
        const getBody = getMessageBody(m);
        if (storedText && storedText.length > getBody.length) {
          console.error(`[commands] texto do webhook (${storedText.length} chars) > GET (${getBody.length}) id=${m.id} t=${m.timestamp || m.time} — usando webhook`);
          out = { ...out, body: storedText };
        }
      }
      return out;
    });

    console.error(`[doAnalisar] chatId=${chatId} mensagens=${messagesWithMedia.length} prevCutoff=${prevCutoff}`);
    for (const m of messagesWithMedia) {
      const t = m.timestamp || m.time || 0;
      const preview = getMessageBody(m).trim().slice(0, 60).replace(/\n/g, '↵');
      console.error(`  [msg] type=${m.type} fromMe=${m.fromMe} t=${t} body="${preview}"`);
    }

    const patients = splitIntoPatients(messagesWithMedia, { lastTime: prevCutoff, processedIds });
    console.error(`[doAnalisar] casos identificados=${patients.length}`);

    if (patients.length === 0) {
      return sendText(chatId, '⚠️ Nenhum caso novo encontrado.\n\nLembre: o caso precisa ser aberto com *xxxx* e fechado com *❌❌❌❌*. Apenas o conteúdo enviado ENTRE esses dois marcadores é avaliado.');
    }

    const total = patients.length;
    await sendText(chatId, `📋 ${total} caso(s) novo(s) encontrado(s). Iniciando análise...`);

    let analyzedCount = 0;
    let newestAnalyzedTime = 0;

    for (const patient of patients) {
      const label = patient.index;
      const totalMedia = patient._mediaCount || patient.media.length;
      const urlOk = patient.media.length;
      const urlMissing = totalMedia - urlOk;
      await sendText(chatId, `⏳ Analisando caso ${label}/${total} (${urlOk} exame(s) com URL, ${patient.texts.length} texto(s))...`);

      if (urlMissing > 0) {
        const names = (patient.missingMediaNames || []).slice(0, urlMissing);
        const namesList = names.length ? `\n${names.map(n => `• ${n}`).join('\n')}\n` : '';
        await sendText(chatId,
          `⚠️ *${urlMissing} arquivo(s) sem URL disponível — não foram enviados à análise:*\n${namesList}\n` +
          `Isso pode acontecer por falha no download do arquivo ou reinício do servidor. ` +
          `Por favor, *reenvie estes arquivos* e rode /analisar novamente para incluí-los na análise.\n\n` +
          `A análise abaixo foi feita apenas com o texto disponível.`
        );
      }

      try {
        const patientName = extractName(patient.texts) || `Caso ${label}`;
        const surgeryType = extractSurgery(patient.texts);
        console.error(`[doAnalisar] caso ${label}: paciente="${patientName}" cirurgia="${surgeryType}" textos=${patient.texts.length} mídias=${urlOk}/${totalMedia}`);
        // Diagnóstico: mostra o conteúdo de texto capturado para o caso. Se a anamnese
        // (com "Procedimento:") não aparecer aqui, ela ficou FORA do bloco xxxx/❌❌❌❌.
        console.error(`[doAnalisar] caso ${label} TEXTOS capturados:\n---\n${patient.texts.join('\n---\n').slice(0, 1200)}\n---`);

        // Aviso proativo: se não achamos nome/cirurgia E o caso tem uma mensagem
        // curta de terceiro (provável card/template cujo corpo com os campos
        // preenchidos não chegou ao servidor — confirmado em produção que isso
        // acontece com E sem o flag de encaminhamento). Isso NÃO é um bug de
        // leitura — o texto nunca chega ao servidor. Avisa o médico a digitar/
        // colar os dados como mensagem de texto simples nova.
        if (!surgeryType && patient._hasShortThirdPartyText) {
          await sendText(chatId,
            `⚠️ *Aviso:* não consegui ler o "Procedimento:"/"Paciente:" da ficha enviada — o texto com esses campos parece não estar chegando ao servidor (provável limitação do card/template do WhatsApp usado para enviar a ficha).\n\n` +
            `*Solução:* digite ou cole o nome do(a) paciente e o procedimento como uma mensagem de TEXTO SIMPLES nova (ex.: "Paciente: Fulana\\nProcedimento: Mastopexia com prótese") dentro do bloco xxxx/❌❌❌❌, sem usar o card/template. Depois rode ${PREFIX}resetar e ${PREFIX}analisar de novo.`
          );
        }

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
          // Lista o motivo específico de cada falha (nome do arquivo + erro) —
          // um contador genérico escondia o problema real e dificultava o diagnóstico.
          const list = errors.map(e => `• ${e}`).join('\n');
          await sendText(chatId, `⚠️ Caso ${label}: ${errors.length} arquivo(s) não puderam ser lidos e foram ignorados:\n${list}`);
        }

        // Marca as mensagens deste caso como processadas (dedup durável) e guarda
        // o caso na lista de recentes, para permitir retry cirúrgico via /resetar
        // sem precisar reler o histórico inteiro do grupo.
        markProcessed(chatId, patient._msgIds || []);
        recordCase(chatId, {
          msgIds: patient._msgIds || [],
          minTime: patient._minTime || 0,
          maxTime: patient._maxTime || 0,
          patientName,
        });
        analyzedCount++;
        if ((patient._maxTime || 0) > newestAnalyzedTime) newestAnalyzedTime = patient._maxTime;
      } catch (e) {
        console.error(`[analisar] erro no caso ${label}:`, e);
        await sendText(chatId, `❌ Erro no caso ${label}: ${e.message}`);
      }
    }

    // Avança o corte SOMENTE se ao menos um caso foi analisado — assim, se o usuário
    // esqueceu o ❌❌❌❌, o conteúdo não fica "atrás" do corte e pode ser reanalisado.
    if (analyzedCount > 0) {
      const cutoff = Math.max(prevCutoff, cmdTime, newestAnalyzedTime);
      if (cutoff) setLastTime(chatId, cutoff);
    }

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

// /resetar — RETRY CIRÚRGICO (regra absoluta): reabre apenas o(s) último(s)
// caso(s) analisado(s) para correção, SEM reler nem reavaliar o histórico
// inteiro do grupo. Uso: /resetar (retenta 1 caso) ou /resetar 3 (últimos 3).
async function doRetryRecent(chatId, args) {
  const n = Math.max(1, Math.min(20, parseInt(args, 10) || 1));
  const { retried, patientNames } = retryRecentCases(chatId, n);

  if (retried === 0) {
    return sendText(chatId, '⚠️ Nenhum caso recente encontrado para corrigir neste grupo.');
  }

  const names = patientNames.length ? `\n${patientNames.map(n => `• ${n}`).join('\n')}` : '';
  return sendText(chatId,
    `🔄 ${retried} caso(s) recente(s) reaberto(s) para correção:${names}\n\n` +
    `Rode ${PREFIX}analisar para reprocessá-los. Casos mais antigos NÃO serão reavaliados.`
  );
}

// /resetartudo — RESET TOTAL (perigoso, admin). Apaga TODO o estado do grupo;
// o bot vai reler e reavaliar TODO o histórico disponível. Use só em emergência
// real (ex.: reconfigurar o bot do zero) — nunca para corrigir um caso específico.
async function doResetTudo(chatId) {
  resetGroup(chatId);
  return sendText(chatId,
    '⚠️ RESET TOTAL: posição de leitura e histórico de casos apagados.\n\n' +
    'Na próxima análise, o bot lerá e reavaliará TODAS as mensagens disponíveis do grupo — ' +
    'incluindo pacientes já analisados anteriormente. Use com cuidado.'
  );
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
1️⃣ Digite *xxxx* para abrir o caso
2️⃣ Encaminhe a ficha, exames, PDFs e imagens
3️⃣ Digite *❌❌❌❌* para fechar o caso
4️⃣ Envie ${PREFIX}analisar

Os marcadores *xxxx* (abertura) e *❌❌❌❌* (fechamento) são AMBOS obrigatórios. Apenas o conteúdo enviado ENTRE eles é avaliado — tudo fora é ignorado, sem exceção.

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
${PREFIX}resetar [N] — corrige o(s) último(s) N caso(s) analisado(s) (padrão: 1), sem reler o histórico
${PREFIX}resetartudo — ⚠️ apaga TODO o estado e reavalia o histórico inteiro do grupo (uso raro/emergencial)

⚠️ Ferramenta de apoio. Não substitui avaliação médica presencial.`;
}
