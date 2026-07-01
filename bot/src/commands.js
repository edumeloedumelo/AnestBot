// Parsing e handlers dos comandos do WhatsApp — agora por tenant (ctx carrega
// tenantId/instanceId/token/config), sem env var global de admin/chat.
import { getConfig, updateConfig } from './config.js';
import { splitIntoPatients, extractName, extractSurgery } from './parser.js';
import { addMessage, snapshot, clear } from './sessions.js';
import { sendText as ultramsgSendText } from './ultramsg.js';
import { runTriage } from './triage.js';
import { formatTriageReply } from './format.js';
import { getUsage, incrementUsage } from './quota.js';
import { recordTriageOutcome, logExecutionEvent, extractStatusFinal } from './audit.js';

const PREFIX = process.env.TRIGGER_PREFIX || '/';

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

// Em grupo, `msg.from` é o id do GRUPO — quem enviou de fato é `msg.author`.
function senderNumber(msg) {
  const raw = msg.author || msg.from || '';
  return raw.replace(/@.*/, '').replace(/\D/g, '');
}

function isAdmin(ctx, msg) {
  const admins = ctx.config.adminNumbers || [];
  if (admins.length === 0) return true;
  return admins.includes(senderNumber(msg));
}

function reply(ctx, text) {
  return ultramsgSendText(ctx.instanceId, ctx.token, ctx.chatId, text);
}

// `ctx`: { tenantId, instanceId, token, chatId, config }
export async function handleCommand(ctx, body, msg) {
  const { cmd, args } = parse(body);

  switch (cmd) {
    case 'ajuda':
    case 'help':
    case 'comandos':
      return reply(ctx, helpText());

    case 'analisar':
    case 'triagem':
      return doAnalisar(ctx);

    case 'status':
      return doStatus(ctx);

    case 'resetar':
    case 'reset':
    case 'limpar':
      return requireAdmin(ctx, msg, () => doReset(ctx));

    case 'cirurgias':
      return listSurgeries(ctx);

    case 'limites':
      return listLimits(ctx);

    case 'prompt':
      return showPrompt(ctx);

    // ---- edição (admin) ----
    case 'addcirurgia':
      return requireAdmin(ctx, msg, () => addSurgery(ctx, args));
    case 'delcirurgia':
      return requireAdmin(ctx, msg, () => delSurgery(ctx, args));
    case 'addlimite':
      return requireAdmin(ctx, msg, () => addLimit(ctx, args));
    case 'dellimite':
      return requireAdmin(ctx, msg, () => delLimit(ctx, args));
    case 'setprompt':
      return requireAdmin(ctx, msg, () => setPrompt(ctx, args));
    case 'limparprompt':
      return requireAdmin(ctx, msg, () => setPrompt(ctx, ''));

    default:
      return reply(ctx, `❓ Comando desconhecido: ${PREFIX}${cmd}\nDigite ${PREFIX}ajuda para ver a lista.`);
  }
}

function requireAdmin(ctx, msg, fn) {
  if (!isAdmin(ctx, msg)) {
    return reply(ctx, '⛔ Você não tem permissão para este comando.');
  }
  return fn();
}

// Mensagens de conteúdo clínico (não-comando) chegam aqui pelo router e só
// entram no buffer — a análise em si só roda quando o comando é disparado.
export function bufferMessage(ctx, message) {
  addMessage(ctx.tenantId, ctx.chatId, message);
}

// ─────────────────────────────────────────────
// ANÁLISE PRINCIPAL
// ─────────────────────────────────────────────

async function doAnalisar(ctx) {
  const buffered = snapshot(ctx.tenantId, ctx.chatId);

  if (buffered.length === 0) {
    return reply(ctx, `✅ Nenhum exame novo no buffer.\n\nEnvie as avaliações/exames no grupo e rode ${PREFIX}analisar de novo.`);
  }

  const patients = splitIntoPatients(buffered);

  if (patients.length === 0) {
    return reply(ctx, '⚠️ Mensagens encontradas mas nenhum caso identificado. Verifique se há avaliação + exames antes do ❌❌❌❌.');
  }

  const usage = await getUsage(ctx.tenantId);
  if (usage.used >= usage.limit) {
    return reply(ctx, `🚫 Cota do plano esgotada (${usage.used}/${usage.limit} triagens este mês). Fale com o suporte pra fazer upgrade — os exames continuam no buffer.`);
  }

  const total = patients.length;
  await reply(ctx, `📋 ${total} caso(s) novo(s) encontrado(s). Iniciando análise...`);

  let remaining = usage.limit - usage.used;
  let processed = 0;

  for (const patient of patients) {
    const label = patient.index;

    if (remaining <= 0) {
      await reply(ctx, `🚫 Cota do plano esgotada — ${processed}/${total} casos processados. O restante fica no buffer pra depois do upgrade.`);
      break;
    }

    await reply(ctx, `⏳ Analisando caso ${label}/${total} (${patient.media.length} exame(s), ${patient.texts.length} texto(s))...`);

    try {
      const { fullText, errors } = await runTriage({
        config: ctx.config,
        patientName: extractName(patient.texts) || `Caso ${label}`,
        surgeryType: extractSurgery(patient.texts),
        anamnesis: patient.texts.join('\n\n'),
        media: patient.media,
      });

      if (total > 1) {
        await reply(ctx, `━━━━━━━━━━━━━━━━━━━━\n📁 CASO ${label}/${total}\n━━━━━━━━━━━━━━━━━━━━`);
      }

      for (const m of formatTriageReply(fullText)) {
        await reply(ctx, m);
      }

      if (errors.length) {
        await reply(ctx, `⚠️ Caso ${label}: ${errors.length} arquivo(s) não puderam ser lidos e foram ignorados.`);
      }

      await recordTriageOutcome(ctx.tenantId, extractStatusFinal(fullText));
      await incrementUsage(ctx.tenantId, usage.period);
      remaining -= 1;
      processed += 1;
    } catch (e) {
      console.error(`[analisar] erro no caso ${label}:`, e);
      await reply(ctx, `⚠️ ANÁLISE NÃO CONCLUÍDA no caso ${label} — não prossiga sem revisão manual. (${e.message})`);
      await recordTriageOutcome(ctx.tenantId, 'erro');
      await logExecutionEvent(ctx.tenantId, 'triage.failed', { erro: e.message, caso: label });
    }
  }

  clear(ctx.tenantId, ctx.chatId);

  if (total > 1) {
    await reply(ctx, `✅ Análise concluída — ${processed}/${total} caso(s) processado(s).`);
  }
}

// ─────────────────────────────────────────────
// STATUS / RESET (agora refletem o buffer, não mais "última leitura")
// ─────────────────────────────────────────────

async function doStatus(ctx) {
  const buffered = snapshot(ctx.tenantId, ctx.chatId);
  const mediaCount = buffered.filter((m) => m.type === 'image' || m.type === 'document' || m.type === 'video').length;
  const usage = await getUsage(ctx.tenantId);
  return reply(
    ctx,
    `📊 Status:\n• Mensagens no buffer: ${buffered.length} (${mediaCount} mídia(s))\n• Triagens usadas este mês: ${usage.used}/${usage.limit}\n\nUse ${PREFIX}analisar para rodar a triagem dos casos no buffer.`
  );
}

async function doReset(ctx) {
  clear(ctx.tenantId, ctx.chatId);
  return reply(ctx, '🔄 Buffer limpo. As próximas mensagens começam um buffer novo.');
}

// ─────────────────────────────────────────────
// LISTAGENS
// ─────────────────────────────────────────────

function listSurgeries(ctx) {
  const { surgeries } = ctx.config;
  if (!surgeries.length) return reply(ctx, 'Nenhuma cirurgia cadastrada. Use ' + PREFIX + 'addcirurgia.');
  let out = '🔪 CIRURGIAS CADASTRADAS\n\n';
  for (const s of surgeries) {
    out += `• ${s.name} (key: ${s.key})\n   Exames: ${(s.required_exams || []).join(', ')}\n\n`;
  }
  return reply(ctx, out.trim());
}

function listLimits(ctx) {
  const { examLimits } = ctx.config;
  if (!examLimits.length) return reply(ctx, 'Nenhum limite cadastrado. Use ' + PREFIX + 'addlimite.');
  let out = '📊 LIMITES / VALORES DE REFERÊNCIA\n\n';
  for (const l of examLimits) {
    out += `• ${l.exam_name}: ${l.description}`;
    if (l.unit) out += ` (${l.unit})`;
    if (l.notes) out += `\n   Obs: ${l.notes}`;
    out += '\n\n';
  }
  return reply(ctx, out.trim());
}

function showPrompt(ctx) {
  const { extraPrompt } = ctx.config;
  return reply(ctx, extraPrompt
    ? `📝 Instruções adicionais ativas:\n\n${extraPrompt}`
    : '📝 Nenhuma instrução adicional. O bot usa o protocolo padrão de triagem.');
}

// ─────────────────────────────────────────────
// EDIÇÃO DE CONFIG
// ─────────────────────────────────────────────

async function addSurgery(ctx, args) {
  const [key, name, examsRaw] = args.split(';').map((s) => s.trim());
  if (!key || !name) {
    return reply(ctx, `Uso:\n${PREFIX}addcirurgia chave; Nome da cirurgia; exame1, exame2, exame3`);
  }
  const required_exams = (examsRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
  await updateConfig(ctx.tenantId, (c) => {
    const idx = c.surgeries.findIndex((s) => s.key === key);
    const entry = { key, name, required_exams };
    if (idx >= 0) c.surgeries[idx] = entry;
    else c.surgeries.push(entry);
  });
  return reply(ctx, `✅ Cirurgia "${name}" salva (key: ${key}) com ${required_exams.length} exame(s).`);
}

async function delSurgery(ctx, args) {
  const key = args.trim();
  if (!key) return reply(ctx, `Uso: ${PREFIX}delcirurgia chave`);
  let removed = false;
  await updateConfig(ctx.tenantId, (c) => {
    const before = c.surgeries.length;
    c.surgeries = c.surgeries.filter((s) => s.key !== key);
    removed = c.surgeries.length < before;
  });
  return reply(ctx, removed ? `🗑️ Cirurgia "${key}" removida.` : `Não encontrei a key "${key}".`);
}

async function addLimit(ctx, args) {
  const [exam_name, description, unit, notes] = args.split(';').map((s) => (s || '').trim());
  if (!exam_name || !description) {
    return reply(ctx, `Uso:\n${PREFIX}addlimite Nome do exame; descrição/limite; unidade (opcional); observação (opcional)`);
  }
  await updateConfig(ctx.tenantId, (c) => {
    const idx = c.examLimits.findIndex((l) => l.exam_name.toLowerCase() === exam_name.toLowerCase());
    const entry = { exam_name, description, unit: unit || '', notes: notes || '' };
    if (idx >= 0) c.examLimits[idx] = entry;
    else c.examLimits.push(entry);
  });
  return reply(ctx, `✅ Limite "${exam_name}" salvo.`);
}

async function delLimit(ctx, args) {
  const name = args.trim();
  if (!name) return reply(ctx, `Uso: ${PREFIX}dellimite Nome do exame`);
  let removed = false;
  await updateConfig(ctx.tenantId, (c) => {
    const before = c.examLimits.length;
    c.examLimits = c.examLimits.filter((l) => l.exam_name.toLowerCase() !== name.toLowerCase());
    removed = c.examLimits.length < before;
  });
  return reply(ctx, removed ? `🗑️ Limite "${name}" removido.` : `Não encontrei o exame "${name}".`);
}

async function setPrompt(ctx, args) {
  await updateConfig(ctx.tenantId, (c) => { c.extraPrompt = args; });
  return reply(ctx, args
    ? '✅ Instruções adicionais atualizadas.'
    : '✅ Instruções adicionais removidas.');
}

// ─────────────────────────────────────────────
// AJUDA
// ─────────────────────────────────────────────

function helpText() {
  return `🤖 BOT DE TRIAGEM PRÉ-ANESTÉSICA

COMO USAR:
1. A secretaria envia as avaliações e exames no grupo, separando cada paciente com ❌❌❌❌
2. Quando quiser analisar, envie:
   ${PREFIX}analisar
3. O bot lê tudo que está no buffer, separa por paciente e responde cada um

COMANDOS:
${PREFIX}analisar — analisa os casos no buffer
${PREFIX}status — mostra o que está no buffer e a cota do mês
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
${PREFIX}resetar — limpa o buffer atual

_A decisão final é sempre do anestesiologista responsável._`;
}
