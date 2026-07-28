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
const BOT_MARKERS = [
  'AVALIAÇÃO PRÉ-ANESTÉSICA', 'STATUS FINAL',
  'Apoio à decisão. Não substitui avaliação médica',
  '🔍 Buscando', 'caso(s) novo(s) encontrado', '⏳ Analisando caso',
  '✅ Análise concluída', 'Nenhum caso novo', 'Nenhuma mensagem nova',
  '📁 CASO', '━━━━━━━━━━━━━━', 'arquivo(s) não puderam ser lidos',
  'BOT DE AVALIAÇÃO', 'CIRURGIAS CADASTRADAS', 'LIMITES / VALORES',
  'Instruções adicionais', '📊 Status', 'Posição de leitura resetada',
  'caso(s) recente(s) reaberto', 'Já há uma análise em andamento',
  'Nenhum caso recente encontrado', 'não tem permissão', 'Comando desconhecido',
];
function isBotMessage(body) {
  return !!body && BOT_MARKERS.some((s) => body.includes(s));
}
// Só um laudo real marca casos como já analisados.
const LAUDO_MARKERS = ['AVALIAÇÃO PRÉ-ANESTÉSICA', 'STATUS FINAL', 'Apoio à decisão. Não substitui avaliação médica'];
function isLaudo(body) {
  return !!body && LAUDO_MARKERS.some((s) => body.includes(s));
}

// ── extração de nome e cirurgia ─────────────────────────────────────────────
export function extractName(texts) {
  const j = texts.join('\n');
  const m = j.match(/Paciente[:\s]+([^\n,]+)/i)
        || j.match(/Nome\s+completo[:\s]+([^\n,]+)/i)
        || j.match(/Nome[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

export function extractSurgery(texts) {
  const j = texts.join('\n');
  const stop = /(?=\n\s*(?:🔷|🔹|🔶|Data\b|Telefone\b|Observ|Paciente\b|\d️?⃣|[-_—]{3,})|\n\n|$)/;
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
      // Mídia: só entra se há caso aberto.
      if (current) addContent(m, m.caption || '', current);
    } else if (inner) {
      if (current) addContent({ ...m, type: 'chat' }, inner, current);
      // fora de bloco → ignorado (regra absoluta)
    }

    if (closes) pushCurrent();
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
