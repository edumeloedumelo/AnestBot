// Divide as mensagens armazenadas de um grupo em CASOS (pacientes).
//
// Protocolo: um caso abre com "xxxx" e fecha com "❌❌❌❌". Os marcadores podem
// vir SOZINHOS numa mensagem OU colados ao conteúdo na mesma mensagem
// (ex.: "xxxx\n\n<card>" ou "<card>\n❌❌❌❌") — ambos reconhecidos.
//
// Só o conteúdo ENTRE os marcadores é avaliado. Cada caso carrega os ids das
// mensagens que o compõem, para dedup durável (não reanalisar o que já saiu).

// ── marcadores ────────────────────────────────────────────────────────────
export function isCaseOpener(line) {
  return /^x{4,}$/i.test((line || '').trim());
}
export function isSeparator(line) {
  const s = (line || '').trim();
  return s.length > 0 && /^[\s❌✖✗×]+$/.test(s) && s.includes('❌');
}

// ── mensagens do próprio bot: nunca são conteúdo clínico ────────────────────
// IMPORTANTE: usamos assinaturas EXCLUSIVAS da saída do bot (negrito com *
// asteriscos, emojis específicos, frases de UI). NÃO usamos substrings que uma
// ficha de anamnese digitada por humano possa conter — em especial:
//   • "━━━━━━━━━━━━━━" (as fichas usam esses separadores entre as perguntas!)
//   • "Avaliação Pré-Anestésica" em texto (o card do bot é "*AVALIAÇÃO
//     PRÉ-ANESTÉSICA*", com asteriscos e caixa alta — a ficha não tem asteriscos)
const BOT_MARKERS = [
  '*AVALIAÇÃO PRÉ-ANESTÉSICA*',                     // cabeçalho do laudo (negrito)
  '*STATUS FINAL:*', '📌 *STATUS:*',                // status do laudo (negrito)
  '🔧 *VERIFICAÇÃO AUTOMÁTICA*', 'checagem(ns) OK', // relatório do /resetar
  'Apoio à decisão. Não substitui avaliação médica', // rodapé do laudo
  '🔍 Verificando casos', '🔍 Buscando mensagens',
  'caso(s) novo(s). Iniciando', '⏳ Analisando caso', '✅ Análise concluída',
  '📁 CASO', '⚠️ Nenhum caso novo encontrado', 'Nenhuma mensagem nova',
  'caso(s) reaberto', 'Já há uma análise em andamento',
  '⚠️ Nenhum caso recente', '⛔ Você não tem permissão', '❓ Comando desconhecido',
  '🤖 ANESTBOT', '🔪 CIRURGIAS CADASTRADAS', '📊 LIMITES / VALORES',
  '📊 Status do grupo', '📝 Instruções adicionais', '📝 Nenhuma instrução',
  'Estado do grupo apagado', 'arquivo(s) sem URL', 'arquivo(s) com problema',
  '✅ Instruções adicionais', '✅ Cirurgia "', '✅ Limite "', '🗑️ "',
  'Nenhuma cirurgia cadastrada', 'Nenhum limite cadastrado',
  // "reenviar os exames" sozinho seria genérico demais (uma orientação clínica
  // humana pode conter a frase) — usamos a frase COMPLETA e exclusiva do bot.
  'rejeitado pela IA', 'reenviar os exames em melhor qualidade', 'Análise indisponível no momento',
  '📎 Exame recebido após',
];
function isBotMessage(body) {
  return !!body && BOT_MARKERS.some((s) => body.includes(s));
}
// Só o laudo REAL do bot (formato exato, com asteriscos) marca casos como analisados.
const LAUDO_MARKERS = ['*AVALIAÇÃO PRÉ-ANESTÉSICA*', 'Apoio à decisão. Não substitui avaliação médica'];
function isLaudo(body) {
  return !!body && LAUDO_MARKERS.some((s) => body.includes(s));
}

// ── extração de nome e cirurgia ─────────────────────────────────────────────
export function extractName(texts) {
  const j = texts.join('\n');
  const m = j.match(/Paciente(?:\s*\(a\))?\s*[:\-]\s*([^\n,]+)/i)
        || j.match(/Paciente[:\s]+([^\n,]+)/i)
        || j.match(/\bPc?te\.?\s*[:\-]\s*([^\n,]+)/i)     // Pcte: / Pte:
        || j.match(/\bPac\.?\s*[:\-]\s*([^\n,]+)/i)        // Pac:
        || j.match(/Nome\s+completo[:\s]+([^\n,]+)/i)
        || j.match(/Nome[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

export function extractSurgery(texts) {
  const j = texts.join('\n');
  // Rótulos adicionados (Cirurgião/Anestesista/.../ASA) exigem ":" ou "-" após
  // o nome — sem isso, texto corrido legítimo começando com "ASA..." em linha
  // nova cortaria a cirurgia no meio (achado de auditoria).
  const stop = /(?=\n\s*(?:🔷|🔹|🔶|Data\b|Telefone\b|Observ|Paciente\b|(?:Cirurgi[ãa]o|Anestesista|Conv[êe]nio|Hospital|Peso|Altura|Idade|ASA)\s*[:\-]|\d️?⃣|[-_—━─]{3,})|\n\n|$)/;
  const field = (label) => new RegExp(`${label}\\s*[:\\-：]\\s*([\\s\\S]{3,180}?)${stop.source}`, 'i');
  const m = j.match(field('Procedimento'))
        || j.match(field('Cirurgia\\s+programada'))
        || j.match(field('Cirurgia'))
        || j.match(/\b(mamoplastia|mastopexia|mammy\s*makeover|pr[oó]tese\s+mam[aá]ria|abdominoplastia|lipoaspira[çc][aã]o|hidrolipo|lipoescultura|rinoplastia|blefaroplastia|ritidoplastia|facelift|endometriose|histeroscopia|videolaparoscopia|rob[oó]tica|lipo)\b/i);
  if (!m) return '';
  return m[1].replace(/\s*\n\s*/g, ' ').trim();
}

// URLs de documento em texto (Drive, Dropbox etc.).
const URL_RE = /https?:\/\/\S+/g;
function extractDocUrls(text) {
  const out = [];
  for (const mt of (text || '').matchAll(URL_RE)) {
    const url = mt[0].replace(/[)\].,!?'"]+$/, '');
    if (/\.(pdf|docx?|xlsx?)(\?|#|$)/i.test(url) ||
        /drive\.google|docs\.google|dropbox|1drv\.ms|onedrive|sharepoint|acrobat\.adobe|adobe\.com\/id\//i.test(url)) {
      out.push(url);
    }
  }
  return out;
}

function newCase() {
  return { texts: [], media: [], _mediaCount: 0, msgIds: [], missingMedia: [] };
}

function addContent(m, text, kase) {
  const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';
  if (isMedia) {
    kase._mediaCount++;
    if (m.mediaUrl) kase.media.push({ url: m.mediaUrl, caption: text, type: m.type });
    else kase.missingMedia.push(text || `arquivo ${m.type}`);
    if (text) kase.texts.push(text);
  } else if (text) {
    kase.texts.push(text);
    for (const url of extractDocUrls(text)) kase.media.push({ url, caption: 'link', type: 'link' });
  }
  if (m.id) kase.msgIds.push(m.id);
}

/**
 * @param {Array} messages  mensagens do grupo (ordenadas por timestamp)
 * @param {Set}   processedIds  ids já analisados (dedup durável)
 * @returns {Array} casos novos (não analisados), cada um {texts, media, msgIds, ...}
 */
export function splitIntoCases(messages, processedIds = new Set()) {
  const cases = [];
  let current = null;

  const hasContent = (c) => c && (c.texts.length || c.media.length || c._mediaCount);
  const pushCurrent = () => { if (hasContent(current)) cases.push(current); current = null; };

  for (const m of messages) {
    const body = (m.body || '').trim();

    // Laudo do bot → marca casos já fechados (e o atual) como analisados.
    if (isBotMessage(body)) {
      if (isLaudo(body)) {
        for (const c of cases) c._alreadyAnalyzed = true;
        if (current) { current._alreadyAnalyzed = true; cases.push(current); current = null; }
      }
      continue;
    }

    // Detecta marcadores na 1ª/última linha (cobre marcador colado ao conteúdo).
    const lines = body.split('\n');
    let opens = false, closes = false;
    if (lines.length && isCaseOpener(lines[0])) { opens = true; lines.shift(); }
    if (lines.length && isSeparator(lines[lines.length - 1])) { closes = true; lines.pop(); }
    const inner = lines.join('\n').trim();

    if (opens) { pushCurrent(); current = newCase(); }

    if (m.type !== 'chat') {
      // Mídia: entra se há caso aberto. Mídia ADOTADA (chegou antes do xxxx e o
      // caso abriu/fechou na mesma mensagem) tem timestamp igual ao do fechamento
      // — anexa ao último caso recém-fechado (janela de 1s, nunca a casos antigos).
      if (current) addContent(m, m.caption || '', current);
      else {
        const last = cases[cases.length - 1];
        if (last && !last._alreadyAnalyzed && typeof last._closedTs === 'number' && (m.timestamp || 0) <= last._closedTs + 1) {
          addContent(m, m.caption || '', last);
        }
      }
    } else if (inner) {
      if (current) addContent({ ...m, type: 'chat' }, inner, current);
      // fora de bloco → ignorado (regra absoluta)
    }

    if (closes) { if (current) current._closedTs = m.timestamp || 0; pushCurrent(); }
  }
  pushCurrent();

  // Filtra: remove os já analisados (por laudo) e por dedup durável de ids.
  const result = cases.filter((c) => {
    if (c._alreadyAnalyzed) return false;
    const ids = c.msgIds || [];
    if (ids.length && ids.every((id) => processedIds.has(id))) return false; // já processado
    return true;
  }).map((c, i) => ({ index: i + 1, ...c }));

  console.error(`[parser] casos=${cases.length} novos=${result.length}`);
  return result;
}
