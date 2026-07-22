// Protocolo ESTRITO: caso abre com "xxxx" e fecha com ❌❌❌❌.
// TUDO fora deste bloco é completamente ignorado — sem exceção, sem prebuffer.
// Isso elimina definitivamente a inclusão de anamneses antigas, guias, documentos
// avulsos ou qualquer outra mensagem enviada fora do bloco delimitado.

// ── abertura de caso: "xxxx" (4+ letras x, sozinhas na mensagem) ─────────
function isCaseOpener(body) {
  if (!body) return false;
  return /^x{4,}$/i.test(body.trim());
}

// ── fechamento de caso: ❌❌❌❌ ────────────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗×]+$/.test(body) && body.includes('❌');
}

// ── mensagens do bot: ignorar como conteúdo clínico ──────────────────────
function isBotMessage(body) {
  if (!body) return false;
  return (
    body.includes('AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('STATUS FINAL') ||
    body.includes('Apoio à decisão. Não substitui avaliação médica') ||
    body.includes('TRIAGEM PRÉ-ANESTÉSICA') ||
    body.includes('TRIAGEM PRE-ANESTESICA') ||
    body.includes('TRIAGEM PRÉ-OPERATÓRIA') ||
    body.includes('Vou gerar a triagem') ||
    body.includes('Vou analisar o caso') ||
    body.includes('🔍 Buscando mensagens') ||
    body.includes('caso(s) novo(s) encontrado') ||
    body.includes('⏳ Analisando caso') ||
    body.includes('✅ Análise concluída') ||
    body.includes('Mensagens encontradas mas nenhum caso') ||
    body.includes('Nenhuma mensagem nova') ||
    body.includes('Nenhum caso novo encontrado') ||
    body.includes('📁 CASO') ||
    body.includes('━━━━━━━━━━━━━━') ||
    body.includes('arquivo(s) não puderam ser lidos') ||
    body.includes('arquivo(s) detectado(s) sem URL') ||
    body.includes('Erro ao buscar mensagens') ||
    body.includes('BOT DE AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('CIRURGIAS CADASTRADAS') ||
    body.includes('LIMITES / VALORES DE REFERÊNCIA') ||
    body.includes('Instruções adicionais') ||
    body.includes('📊 Status deste grupo') ||
    body.includes('Posição de leitura resetada') ||
    body.includes('Você não tem permissão') ||
    body.includes('Comando desconhecido') ||
    body.includes('Já há uma análise em andamento') ||
    body.includes('Verifique se o caso foi aberto com xxxx')
  );
}

// ── análise bem-sucedida: apenas ESTAS marcam casos como já analisados ────
function isSuccessfulAnalysis(body) {
  if (!body) return false;
  return (
    body.includes('AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('STATUS FINAL') ||
    body.includes('Apoio à decisão. Não substitui avaliação médica') ||
    body.includes('TRIAGEM PRÉ-ANESTÉSICA') ||
    body.includes('TRIAGEM PRE-ANESTESICA') ||
    body.includes('TRIAGEM PRÉ-OPERATÓRIA') ||
    body.includes('Vou gerar a triagem') ||
    body.includes('Vou analisar o caso')
  );
}

// ── URLs de documentos em mensagens de texto ──────────────────────────────
const URL_RE = /https?:\/\/\S+/g;
function extractDocumentUrls(text) {
  const urls = [];
  for (const match of (text || '').matchAll(URL_RE)) {
    const url = match[0].replace(/[)\].,!?'"]+$/, '');
    if (looksLikeDocUrl(url)) urls.push(url);
  }
  return urls;
}

function looksLikeDocUrl(url) {
  return (
    /\.(pdf|docx?|xlsx?|pptx?)(\?|#|$)/i.test(url) ||
    url.includes('acrobat.adobe.com') ||
    url.includes('adobe.com/id/') ||
    url.includes('drive.google.com') ||
    url.includes('docs.google.com') ||
    url.includes('dropbox.com') ||
    url.includes('1drv.ms') ||
    url.includes('onedrive.live.com') ||
    url.includes('sharepoint.com')
  );
}

// ── extração de nome e cirurgia ───────────────────────────────────────────
export function extractName(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/Paciente[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome\s+completo[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

export function extractSurgery(texts) {
  const joined = texts.join('\n');
  // Aceita qualquer separador após o label: dois-pontos ASCII/unicode, traço, espaço.
  // Captura o resto da linha inteira (sem vírgula como delimitador — cirurgias combinadas
  // raramente têm vírgula mas frequentemente têm '+', '—' e outros caracteres).
  const m =
    joined.match(/Procedimento\s*[:\-：]\s*([^\n]{3,})/i) ||
    joined.match(/Cirurgia\s+programada\s*[:\-：]\s*([^\n]{3,})/i) ||
    joined.match(/Cirurgia\s*[:\-：]\s*([^\n]{3,})/i) ||
    joined.match(/\b(mamoplastia|mastopexia|pr[oó]tese\s+mam[aá]ria|abdominoplastia|lipoaspira[çc][aã]o|hidrolipo|lipoescultura|rinoplastia|blefaroplastia|ritidoplastia|facelift|endometriose|videolaparoscopia|rob[oó]tica|lipo)\b/i);
  return m ? m[1].trim() : '';
}

// ── adiciona conteúdo a um caso aberto ───────────────────────────────────
function addToContainer(m, body, container) {
  const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';
  if (isMedia) {
    container._mediaCount = (container._mediaCount || 0) + 1;
    if (m.media) {
      container.media.push({ url: m.media, caption: body, type: m.type });
    }
    if (body) container.texts.push(body);
  } else if (body) {
    // Aceita qualquer tipo de mensagem de texto: chat, forward, extended_text etc.
    // UltraMsg pode retornar mensagens encaminhadas com type diferente de 'chat'.
    container.texts.push(body);
    for (const url of extractDocumentUrls(body)) {
      container.media.push({ url, caption: 'link de documento', type: 'link' });
    }
  }
  // Rastreamento para dedup durável e gate de recência.
  if (m.id) container._msgIds.push(m.id);
  const t = m.timestamp || m.time || 0;
  if (t > container._maxTime) container._maxTime = t;
}

function newContainer() {
  return { texts: [], media: [], _mediaCount: 0, _msgIds: [], _maxTime: 0 };
}

// ── parser principal ───────────────────────────────────────────────────────
/**
 * Protocolo ESTRITO (regra ABSOLUTA):
 *   xxxx        → ABRE um caso
 *   ❌❌❌❌     → FECHA o caso
 *
 * SOMENTE o conteúdo enviado ENTRE xxxx e ❌❌❌❌ é avaliado.
 * Qualquer mensagem fora de um caso aberto (sem xxxx ativo) é IGNORADA —
 * sem prebuffer, sem detecção por emoji/texto. Isso elimina definitivamente
 * a contaminação por anamneses antigas, guias ou exames avulsos.
 *
 * Proteção tripla contra reanálise de casos antigos:
 *   1. Gate de recência: descarta blocos cujo conteúdo é todo ≤ lastTime.
 *   2. Dedup durável: descarta blocos cujas mensagens já foram processadas.
 *   3. Heurístico de laudo (_alreadyAnalyzed): defesa adicional.
 *
 * @param {Array} messages
 * @param {{ lastTime?: number, processedIds?: Set<string> }} opts
 */
export function splitIntoPatients(messages, opts = {}) {
  const { lastTime = 0, processedIds = null } = opts;
  const blocks = [];
  let current = null; // caso ativo (aberto por xxxx, ainda não fechado)

  function hasContent(c) {
    return c && (c.texts.length > 0 || c.media.length > 0 || (c._mediaCount || 0) > 0);
  }

  function pushCurrent() {
    if (hasContent(current)) blocks.push(current);
    current = null;
  }

  for (const m of messages) {
    const body = (m.body || '').trim();

    // Mensagem do bot: nunca é conteúdo clínico.
    if (isBotMessage(body)) {
      if (isSuccessfulAnalysis(body)) {
        for (const b of blocks) b._alreadyAnalyzed = true;
        if (current) {
          current._alreadyAnalyzed = true;
          blocks.push(current);
          current = null;
        }
      }
      continue;
    }

    // Comandos (/analisar etc.): ignorar.
    if (m.type === 'chat' && body.startsWith('/')) continue;

    // ❌❌❌❌ → fecha o caso atual.
    if (isSeparator(body)) {
      pushCurrent();
      continue;
    }

    // xxxx → abre novo caso. Se havia um caso aberto sem ❌, fecha primeiro.
    if (isCaseOpener(body)) {
      pushCurrent();
      current = newContainer();
      continue;
    }

    // Dentro de caso aberto (entre xxxx e ❌❌❌❌): acumula conteúdo.
    if (current) {
      addToContainer(m, body, current);
      continue;
    }

    // FORA de qualquer caso (sem xxxx ativo): IGNORAR completamente (regra ABSOLUTA).
    console.error(`[parser] ignorando mensagem fora de bloco: type=${m.type} body="${body.slice(0, 40)}"`);
  }

  // Caso ainda aberto ao fim (sem ❌❌❌❌ final): considera válido e inclui.
  pushCurrent();

  let result = blocks.filter(b => !b._alreadyAnalyzed);
  const afterLaudo = result.length;

  // 1. Gate de recência: bloco cujo conteúdo é todo ≤ lastTime é de sessão antiga.
  if (lastTime > 0) {
    result = result.filter(b => (b._maxTime || 0) > lastTime);
  }
  const afterRecency = result.length;

  // 2. Dedup durável: bloco cujas mensagens já foram TODAS processadas é reanálise.
  if (processedIds && processedIds.size) {
    result = result.filter(b => {
      const ids = b._msgIds || [];
      if (ids.length === 0) return true; // sem IDs, não dá pra deduplicar — mantém
      return !ids.every(id => processedIds.has(id));
    });
  }

  result = result.map((b, i) => ({ index: i + 1, ...b }));

  console.error(`[parser] blocos=${blocks.length} pós-laudo=${afterLaudo} pós-recência=${afterRecency} pós-dedup=${result.length} (lastTime=${lastTime})`);
  return result;
}
