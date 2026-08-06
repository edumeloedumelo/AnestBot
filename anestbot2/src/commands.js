// Comandos do WhatsApp. O /analisar lê do STORE (webhook-first) — nunca do GET.
import { getConfig, updateConfig } from './config.js';
import { getMessages, getProcessed, markProcessed, recordCase, retryRecentCases, resetChat, lastMessageTime } from './store.js';
import { splitIntoCases, extractName, extractSurgery } from './parser.js';
import { runTriage } from './triage.js';
import { formatReply } from './format.js';
import { sendText } from './ultramsg.js';
import { runSelfCheck, formatSelfCheck } from './selfcheck.js';

const PREFIX = process.env.TRIGGER_PREFIX || '/';
const analyzing = new Set(); // lock por grupo

// Prazo do watchdog por caso — ESCALA com o nº de exames, nunca fixo.
// Cada exame pode custar até ~130s no pior caso legítimo (download 60s +
// compressão/normalização 60s + margem), e a chamada única ao Claude no fim
// custa até 120s — um valor fixo baixo dispararia "travou" em casos normais
// com PDFs grandes (achado real de 2 auditorias independentes). O teto (15min)
// cobre o pior caso legítimo de um caso GRANDE (15 exames em pool de 3 ≈ 5
// rodadas de 120s + recompressões do orçamento + Claude) e ainda garante que
// um caso realmente travado libera o grupo em tempo finito.
const WATCHDOG_BASE_MS = 130_000;      // 1 chamada à API (120s) + margem
const WATCHDOG_PER_FILE_MS = 130_000;  // download (60s) + compressão (60s) + margem
const WATCHDOG_CAP_MS = 900_000;       // 15 min — teto absoluto
export function caseWatchdogMs(mediaCount = 0) {
  return Math.min(WATCHDOG_CAP_MS, WATCHDOG_BASE_MS + WATCHDOG_PER_FILE_MS * mediaCount);
}

// Watchdog: NENHUMA causa de travamento — conhecida ou futura — pode prender
// o lock do grupo para sempre. Se um caso não terminar neste prazo, ele falha
// com erro claro e o /analisar segue para o próximo caso / libera o grupo.
export function withWatchdog(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`travou (demorou demais). Rode ${PREFIX}analisar de novo`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const ADMINS = (process.env.ADMIN_NUMBERS || '').split(',').map((s) => s.trim().replace(/\D/g, '')).filter(Boolean);

export function isCommand(body) {
  return typeof body === 'string' && body.trim().startsWith(PREFIX);
}
function parse(body) {
  const t = body.trim().slice(PREFIX.length);
  const sp = t.indexOf(' ');
  return { cmd: (sp === -1 ? t : t.slice(0, sp)).toLowerCase(), args: sp === -1 ? '' : t.slice(sp + 1).trim() };
}
function senderNumber(msg) { return (msg.author || msg.from || '').replace(/@.*/, '').replace(/\D/g, ''); }
// Comparação tolerante a formato: "5583999999999" cadastrado sem o DDI
// ("83999999999") ou vice-versa ainda casa. Sufixo mínimo de 11 dígitos
// (DDD + celular completo no Brasil): com 10, um fixo de Campinas
// "1987654321" colidiria com o final do celular RJ "5521987654321" —
// falso positivo real achado em auditoria.
export function numbersMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 11) return false;
  return a.endsWith(b) || b.endsWith(a);
}
function isAdmin(msg) {
  if (msg && msg.fromMe) return true; // o número conectado à UltraMsg é sempre admin
  if (ADMINS.length === 0) return true;
  const sender = senderNumber(msg);
  return ADMINS.some((n) => numbersMatch(n, sender));
}
function requireAdmin(chatId, msg, fn) {
  if (!isAdmin(msg)) return sendText(chatId, '⛔ Você não tem permissão para este comando.');
  return fn();
}
// updateConfig devolve false quando NÃO persistiu no disco — a resposta no
// grupo nunca pode dizer "salvo" escondendo que a alteração morre no restart.
const PERSIST_WARN = '\n⚠️ Atenção: não foi possível gravar no volume — a alteração vale só até o próximo restart.';
const persistNote = (ok) => (ok ? '' : PERSIST_WARN);

export async function handleCommand(chatId, body, msg) {
  const { cmd, args } = parse(body);
  switch (cmd) {
    case 'ajuda': case 'help': case 'comandos': return sendText(chatId, helpText());
    case 'analisar': case 'triagem': return doAnalisar(chatId);
    case 'status': return doStatus(chatId);
    // Liberado para todos do grupo (04/08): é operacional e seguro — só reabre
    // o último caso e reanalisa. Não-admin tem N≤3 e cooldown de 120s (anti-spam
    // de custo). Os destrutivos/de config continuam admin.
    case 'resetar': case 'reset': return doRetry(chatId, args, msg);
    case 'resetartudo': return requireAdmin(chatId, msg, () => { resetChat(chatId); return sendText(chatId, '⚠️ Estado do grupo apagado por completo. O próximo caso começa do zero.'); });
    case 'tamanhos': case 'tamanho': return doMediaStats(chatId, args);
    case 'cirurgias': return listSurgeries(chatId);
    case 'limites': return listLimits(chatId);
    case 'prompt': return showPrompt(chatId);
    case 'addcirurgia': return requireAdmin(chatId, msg, () => addSurgery(chatId, args));
    case 'delcirurgia': return requireAdmin(chatId, msg, () => delSurgery(chatId, args));
    case 'addlimite': return requireAdmin(chatId, msg, () => addLimit(chatId, args));
    case 'dellimite': return requireAdmin(chatId, msg, () => delLimit(chatId, args));
    case 'setprompt': return requireAdmin(chatId, msg, () => { const ok = updateConfig((c) => { c.extraPrompt = args; }); return sendText(chatId, '✅ Instruções adicionais atualizadas.' + persistNote(ok)); });
    case 'limparprompt': return requireAdmin(chatId, msg, () => { const ok = updateConfig((c) => { c.extraPrompt = ''; }); return sendText(chatId, '✅ Instruções adicionais removidas.' + persistNote(ok)); });
    default: return sendText(chatId, `❓ Comando desconhecido: ${PREFIX}${cmd}\nDigite ${PREFIX}ajuda.`);
  }
}

async function doAnalisar(chatId) {
  if (analyzing.has(chatId)) return sendText(chatId, '⏳ Já há uma análise em andamento neste grupo. Aguarde.');
  analyzing.add(chatId);
  try {
    await sendText(chatId, '🔍 Verificando casos novos no grupo...');

    const messages = getMessages(chatId);
    const processed = getProcessed(chatId);
    const cases = splitIntoCases(messages, processed);

    if (cases.length === 0) {
      return sendText(chatId, `⚠️ Nenhum caso novo encontrado.\n\nCada caso precisa estar entre *xxxx* (abertura) e *❌❌❌❌* (fechamento). Só o conteúdo entre eles é avaliado.`);
    }

    const total = cases.length;
    await sendText(chatId, `📋 ${total} caso(s) novo(s). Iniciando análise...`);

    for (const kase of cases) {
      const label = kase.index;
      const withUrl = kase.media.length;
      const missing = kase.missingMedia.length;
      await sendText(chatId, `⏳ Analisando caso ${label}/${total} (${withUrl} exame(s), ${kase.texts.length} texto(s))...`);

      if (missing > 0) {
        const list = kase.missingMedia.slice(0, missing).map((n) => `• ${n}`).join('\n');
        await sendText(chatId, `⚠️ ${missing} arquivo(s) sem URL — não entraram na análise:\n${list}\n\nReenvie estes arquivos e rode ${PREFIX}analisar de novo.`);
      }

      try {
        const patientName = extractName(kase.texts) || `Caso ${label}`;
        const surgeryType = extractSurgery(kase.texts);
        console.error(`[analisar] caso ${label}: paciente="${patientName}" cirurgia="${surgeryType}" textos=${kase.texts.length} mídia=${withUrl}`);
        console.error(`[analisar] TEXTOS:\n${kase.texts.join('\n---\n').slice(0, 1500)}`);

        const { fullText, errors } = await withWatchdog(runTriage({
          patientName, surgeryType,
          anamnesis: kase.texts.join('\n\n'),
          media: kase.media,
        }), caseWatchdogMs(withUrl));

        if (total > 1) await sendText(chatId, `━━━━━━━━━━━━━━━━━━━━\n📁 CASO ${label}/${total}\n━━━━━━━━━━━━━━━━━━━━`);
        await sendText(chatId, formatReply(fullText));
        if (errors.length) await sendText(chatId, `⚠️ Caso ${label}: ${errors.length} arquivo(s) com problema:\n${errors.map((e) => `• ${e}`).join('\n')}`);

        markProcessed(chatId, kase.msgIds);
        recordCase(chatId, { msgIds: kase.msgIds, patientName });
      } catch (e) {
        console.error(`[analisar] erro no caso ${label}:`, e);
        await sendText(chatId, `❌ Erro no caso ${label}: ${e.message}`);
      }
    }
    if (total > 1) await sendText(chatId, `✅ Análise concluída — ${total} caso(s).`);
  } finally {
    analyzing.delete(chatId);
  }
}

async function doStatus(chatId) {
  const t = lastMessageTime(chatId);
  const d = t ? new Date(t * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nenhuma mensagem registrada';
  return sendText(chatId, `📊 Status do grupo:\n• Última mensagem recebida: ${d}\n\nUse ${PREFIX}analisar para rodar a triagem.`);
}

// /resetar [N] — 3 passos automáticos:
//   1. Reabre APENAS o(s) último(s) caso(s) — os antigos NUNCA são reanalisados.
//   2. Dispara a verificação automática de erros (store/config/volume/API) e
//      corrige o que for corrigível, comunicando cada correção.
//   3. Reanalisa o caso reaberto sozinho — sem precisar mandar /analisar de novo.
const retrying = new Set();               // guarda própria do /resetar (corrida entre 2 pessoas)
const lastRetryAt = new Map();            // cooldown anti-spam por grupo (não-admin)
const RETRY_COOLDOWN_MS = 120_000;
async function doRetry(chatId, args, msg) {
  if (analyzing.has(chatId) || retrying.has(chatId)) {
    return sendText(chatId, '⏳ Já há uma análise em andamento neste grupo. Aguarde.');
  }
  const admin = isAdmin(msg || {});
  if (!admin) {
    const last = lastRetryAt.get(chatId) || 0;
    if (Date.now() - last < RETRY_COOLDOWN_MS) {
      return sendText(chatId, `⏳ ${PREFIX}resetar já foi usado há pouco neste grupo. Aguarde ${Math.ceil((RETRY_COOLDOWN_MS - (Date.now() - last)) / 1000)}s.`);
    }
  }
  lastRetryAt.set(chatId, Date.now());
  retrying.add(chatId);
  try {
    const maxN = admin ? 30 : 3;
    const n = Math.max(1, Math.min(maxN, parseInt(args, 10) || 1));
    const { retried, patientNames } = retryRecentCases(chatId, n);

    if (retried > 0) {
      const names = patientNames.length ? `\n${patientNames.map((x) => `• ${x}`).join('\n')}` : '';
      await sendText(chatId, `🔄 ${retried} último(s) caso(s) reaberto(s):${names}\n\n_Casos antigos permanecem intactos._`);
    } else {
      await sendText(chatId, '⚠️ Nenhum caso recente para reabrir. Rodando só a verificação automática...');
    }

    // Gatilho: verificação automática de erros + correção + comunicação.
    const report = await runSelfCheck(chatId);
    await sendText(chatId, formatSelfCheck(report));

    // Reanalisa automaticamente o caso reaberto.
    if (retried > 0) return await doAnalisar(chatId);
  } finally {
    retrying.delete(chatId);
  }
}

// /tamanhos [N] — mede o tamanho REAL das últimas N mídias do grupo, sem
// baixar os arquivos (HEAD/Range só de tamanho). Serve para dimensionar
// limites de canal (ex.: Telegram Bot API só baixa arquivos até 20 MB).
const MB = 1024 * 1024;
export function mediaSizeStats(sizes) {
  const s = sizes.slice().sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((x, y) => x + y, 0);
  const median = n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
  const buckets = [
    { label: '≤ 1 MB', max: 1 * MB, count: 0 },
    { label: '1–5 MB', max: 5 * MB, count: 0 },
    { label: '5–10 MB', max: 10 * MB, count: 0 },
    { label: '10–20 MB', max: 20 * MB, count: 0 },
    { label: '> 20 MB', max: Infinity, count: 0 },
  ];
  for (const v of s) buckets.find((b) => v <= b.max).count++;
  return { count: n, avg: n ? sum / n : 0, median, max: n ? s[n - 1] : 0, buckets, over20: buckets[4].count };
}

async function headSize(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    if (url.startsWith('tg:')) {
      const { telegramFileUrl } = await import('./telegram.js');
      url = await telegramFileUrl(url.slice(3));
    }
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    let len = parseInt(res.headers.get('content-length') || '', 10);
    if (!res.ok || !Number.isFinite(len) || len <= 0) {
      // Alguns hosts não devolvem content-length no HEAD: pede só o 1º byte
      // e lê o total no content-range ("bytes 0-0/12345").
      res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: controller.signal });
      const m = (res.headers.get('content-range') || '').match(/\/(\d+)\s*$/);
      len = m ? parseInt(m[1], 10) : NaN;
      res.body?.cancel()?.catch(() => {});
    }
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function doMediaStats(chatId, args) {
  const n = Math.max(10, Math.min(200, parseInt(args, 10) || 100));
  const urls = getMessages(chatId)
    .filter((m) => (m.type === 'image' || m.type === 'document' || m.type === 'video') && m.mediaUrl)
    .slice(-n)
    .map((m) => m.mediaUrl);
  if (!urls.length) return sendText(chatId, '⚠️ Nenhuma mídia com URL registrada neste grupo.');
  await sendText(chatId, `📏 Medindo o tamanho de ${urls.length} mídia(s) — só consulta, nada é baixado...`);

  const sizes = [];
  let failed = 0;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= urls.length) return;
      const s = await headSize(urls[i]);
      if (s) sizes.push(s); else failed++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, () => worker()));

  if (!sizes.length) return sendText(chatId, `⚠️ Nenhuma das ${urls.length} URLs respondeu — os links da UltraMsg podem ter expirado. Tente após novos casos chegarem.`);
  const st = mediaSizeStats(sizes);
  const mb = (b) => (b / MB).toFixed(1).replace('.', ',') + ' MB';
  const pct = (c) => Math.round((c / st.count) * 100) + '%';
  let out = `📊 *TAMANHO DAS ÚLTIMAS ${st.count} MÍDIAS*${failed ? ` _(${failed} sem resposta)_` : ''}\n\n`;
  out += `• Média: ${mb(st.avg)}\n• Mediana: ${mb(st.median)}\n• Maior: ${mb(st.max)}\n\n*Distribuição:*\n`;
  for (const b of st.buckets) out += `• ${b.label}: ${b.count} (${pct(b.count)})\n`;
  out += `\n📌 Acima de 20 MB (limite de download do bot do Telegram): *${st.over20}* (${pct(st.over20)})`;
  return sendText(chatId, out);
}

function listSurgeries(chatId) {
  const { surgeries } = getConfig();
  if (!surgeries.length) return sendText(chatId, 'Nenhuma cirurgia cadastrada.');
  let out = '🔪 CIRURGIAS CADASTRADAS\n\n';
  for (const s of surgeries) out += `• ${s.name} (key: ${s.key})\n   Exames: ${(s.required_exams || []).join(', ')}\n\n`;
  return sendText(chatId, out.trim());
}
function listLimits(chatId) {
  const { examLimits } = getConfig();
  if (!examLimits.length) return sendText(chatId, 'Nenhum limite cadastrado.');
  let out = '📊 LIMITES / VALORES DE REFERÊNCIA\n\n';
  for (const l of examLimits) { out += `• ${l.exam_name}: ${l.description}`; if (l.unit) out += ` (${l.unit})`; if (l.notes) out += `\n   Obs: ${l.notes}`; out += '\n\n'; }
  return sendText(chatId, out.trim());
}
function showPrompt(chatId) {
  const { extraPrompt } = getConfig();
  return sendText(chatId, extraPrompt ? `📝 Instruções adicionais ativas:\n\n${extraPrompt}` : '📝 Nenhuma instrução adicional. Protocolo padrão em uso.');
}
function addSurgery(chatId, args) {
  const [key, name, examsRaw] = args.split(';').map((s) => (s || '').trim());
  if (!key || !name) return sendText(chatId, `Uso:\n${PREFIX}addcirurgia chave; Nome; exame1, exame2`);
  const required_exams = (examsRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = updateConfig((c) => { const i = c.surgeries.findIndex((s) => s.key === key); const e = { key, name, required_exams }; if (i >= 0) c.surgeries[i] = e; else c.surgeries.push(e); });
  return sendText(chatId, `✅ Cirurgia "${name}" salva.` + persistNote(ok));
}
function delSurgery(chatId, args) {
  const key = args.trim(); if (!key) return sendText(chatId, `Uso: ${PREFIX}delcirurgia chave`);
  let removed = false; const ok = updateConfig((c) => { const b = c.surgeries.length; c.surgeries = c.surgeries.filter((s) => s.key !== key); removed = c.surgeries.length < b; });
  return sendText(chatId, removed ? `🗑️ "${key}" removida.` + persistNote(ok) : `Não encontrei "${key}".`);
}
function addLimit(chatId, args) {
  const [exam_name, description, unit, notes] = args.split(';').map((s) => (s || '').trim());
  if (!exam_name || !description) return sendText(chatId, `Uso:\n${PREFIX}addlimite Exame; descrição; unidade; obs`);
  const ok = updateConfig((c) => { const i = c.examLimits.findIndex((l) => l.exam_name.toLowerCase() === exam_name.toLowerCase()); const e = { exam_name, description, unit: unit || '', notes: notes || '' }; if (i >= 0) c.examLimits[i] = e; else c.examLimits.push(e); });
  return sendText(chatId, `✅ Limite "${exam_name}" salvo.` + persistNote(ok));
}
function delLimit(chatId, args) {
  const name = args.trim(); if (!name) return sendText(chatId, `Uso: ${PREFIX}dellimite Exame`);
  let removed = false; const ok = updateConfig((c) => { const b = c.examLimits.length; c.examLimits = c.examLimits.filter((l) => l.exam_name.toLowerCase() !== name.toLowerCase()); removed = c.examLimits.length < b; });
  return sendText(chatId, removed ? `🗑️ "${name}" removido.` + persistNote(ok) : `Não encontrei "${name}".`);
}

function helpText() {
  return `🤖 ANESTBOT — AVALIAÇÃO PRÉ-ANESTÉSICA

*COMO ENVIAR UM CASO:*
1️⃣ *xxxx* (abre o caso)
2️⃣ Ficha da anamnese + exames (PDFs/fotos)
3️⃣ *❌❌❌❌* (fecha o caso)
4️⃣ ${PREFIX}analisar

Os marcadores podem estar sozinhos OU colados ao conteúdo. Só o que estiver ENTRE eles é avaliado.

COMANDOS:
${PREFIX}analisar — analisa casos novos
${PREFIX}status — última atividade do grupo
${PREFIX}cirurgias — lista cirurgias/exames exigidos
${PREFIX}limites — valores de referência
${PREFIX}prompt — instruções extras ativas
${PREFIX}resetar [N] — reabre SÓ o(s) último(s) caso(s) + verificação automática de erros + reanálise
${PREFIX}tamanhos [N] — mede o tamanho das últimas N mídias do grupo (padrão 100)
${PREFIX}ajuda — esta mensagem

ADMIN: ${PREFIX}addcirurgia · ${PREFIX}delcirurgia · ${PREFIX}addlimite · ${PREFIX}dellimite · ${PREFIX}setprompt · ${PREFIX}limparprompt · ${PREFIX}resetartudo

⚠️ Ferramenta de apoio. Não substitui avaliação médica presencial.`;
}
