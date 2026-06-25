// Parsing e handlers dos comandos do WhatsApp.
import { getConfig, updateConfig } from './config.js';
import * as session from './sessions.js';
import { sendText } from './ultramsg.js';
import { runTriage } from './triage.js';
import { formatTriageReply } from './format.js';

const PREFIX = process.env.TRIGGER_PREFIX || '/';
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
  if (ADMINS.length === 0) return true; // sem lista = liberado
  return ADMINS.includes(senderNumber(msg));
}

export async function handleCommand(chatId, body, msg) {
  const { cmd, args } = parse(body);

  switch (cmd) {
    case 'ajuda':
    case 'help':
    case 'comandos':
      return sendText(chatId, helpText());

    case 'triagem':
    case 'analisar':
      return doTriage(chatId, args);

    case 'status':
      return doStatus(chatId);

    case 'limpar':
    case 'reset':
      session.clear(chatId);
      return sendText(chatId, '🧹 Buffer do grupo limpo. Pode enviar novos exames.');

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
    return sendText(chatId, '⛔ Você não tem permissão para editar a configuração.');
  }
  return fn();
}

// ----------------- handlers -----------------

async function doTriage(chatId, args) {
  const snap = session.snapshot(chatId);
  // args: "Nome; Cirurgia; anamnese opcional"
  const fields = args.split(';').map((s) => s.trim());
  const patientName = fields[0] || '';
  const surgeryType = fields[1] || '';
  const anamnesis = fields.slice(2).join('; ');

  if (snap.media.length === 0) {
    return sendText(chatId, `⚠️ Nenhum exame (imagem/PDF) recebido neste grupo ainda.\nEnvie as fotos/PDFs dos exames e depois rode:\n${PREFIX}triagem Nome da paciente; Tipo de cirurgia`);
  }
  if (!patientName) {
    return sendText(chatId, `⚠️ Informe ao menos o nome:\n${PREFIX}triagem Nome da paciente; Tipo de cirurgia`);
  }

  await sendText(chatId, `⏳ Analisando ${snap.media.length} exame(s) de *${patientName}*... aguarde.`);

  try {
    const { fullText, mediaCount, errors } = await runTriage({
      patientName,
      surgeryType,
      anamnesis,
      extraTexts: snap.texts,
      media: snap.media,
    });

    for (const m of formatTriageReply(fullText)) {
      await sendText(chatId, m);
    }
    if (errors.length) {
      await sendText(chatId, `⚠️ ${errors.length} arquivo(s) não puderam ser baixados e foram ignorados.`);
    }
    session.clear(chatId);
  } catch (e) {
    console.error('[triagem] erro:', e);
    await sendText(chatId, `❌ Erro na análise: ${e.message}`);
  }
}

function doStatus(chatId) {
  const snap = session.snapshot(chatId);
  return sendText(chatId, `📦 Buffer atual deste grupo:\n• Exames (mídia): ${snap.media.length}\n• Mensagens de texto: ${snap.texts.length}\n\nQuando estiver tudo, rode:\n${PREFIX}triagem Nome; Cirurgia`);
}

function listSurgeries(chatId) {
  const { surgeries } = getConfig();
  if (!surgeries.length) return sendText(chatId, 'Nenhuma cirurgia cadastrada. Use ' + PREFIX + 'addcirurgia.');
  let out = '🔪 *CIRURGIAS CADASTRADAS*\n\n';
  for (const s of surgeries) {
    out += `• *${s.name}* (key: ${s.key})\n   Exames: ${(s.required_exams || []).join(', ')}\n\n`;
  }
  return sendText(chatId, out.trim());
}

function listLimits(chatId) {
  const { examLimits } = getConfig();
  if (!examLimits.length) return sendText(chatId, 'Nenhum limite cadastrado. Use ' + PREFIX + 'addlimite.');
  let out = '📊 *LIMITES / VALORES DE REFERÊNCIA*\n\n';
  for (const l of examLimits) {
    out += `• *${l.exam_name}*: ${l.description}`;
    if (l.unit) out += ` (${l.unit})`;
    if (l.notes) out += `\n   Obs: ${l.notes}`;
    out += '\n\n';
  }
  return sendText(chatId, out.trim());
}

function showPrompt(chatId) {
  const { extraPrompt } = getConfig();
  return sendText(chatId, extraPrompt
    ? `📝 *Instruções adicionais ativas:*\n\n${extraPrompt}`
    : '📝 Nenhuma instrução adicional. O bot usa o protocolo padrão de triagem.');
}

function addSurgery(chatId, args) {
  // formato: key; Nome; exame1, exame2, exame3
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
  // formato: Nome do exame; descrição; unidade(opcional); obs(opcional)
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
    : '✅ Instruções adicionais removidas (volta ao protocolo padrão).');
}

function helpText() {
  return `🤖 *BOT DE TRIAGEM PRÉ-ANESTÉSICA*

*Fluxo:*
1. Envie as fotos/PDFs dos exames no grupo
2. Rode a análise:
   ${PREFIX}triagem Nome; Cirurgia; anamnese (opcional)

*Comandos gerais:*
${PREFIX}triagem Nome; Cirurgia — analisa exames enviados
${PREFIX}status — mostra o que está no buffer
${PREFIX}limpar — limpa os exames acumulados
${PREFIX}cirurgias — lista cirurgias e exames exigidos
${PREFIX}limites — lista valores de referência
${PREFIX}prompt — mostra instruções extras ativas
${PREFIX}ajuda — esta mensagem

*Edição (admin):*
${PREFIX}addcirurgia chave; Nome; exame1, exame2
${PREFIX}delcirurgia chave
${PREFIX}addlimite Exame; descrição; unidade; obs
${PREFIX}dellimite Exame
${PREFIX}setprompt texto extra para o protocolo
${PREFIX}limparprompt

⚠️ Ferramenta de apoio. Não substitui avaliação médica presencial.`;
}
