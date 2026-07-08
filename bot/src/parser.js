// Divide mensagens em blocos de pacientes.
// Protocolo: caso encerra com ❌❌❌❌. Pode ou não começar com 🩺/anamnese.

// ── detecção de separador ❌❌❌❌ ──────────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗x×]+$/i.test(body) && body.includes('❌');
}

// ── início explícito de caso ──────────────────────────────────────────────
const ANAMNESE_RE = /avalia[çc][aã]o\s*pr[eé][-\s]?anest[eé]sica|equipe\s+de\s+anestesia/i;
function isAnamnese(body) {
  if (!body) return false;
  const start = body.trimStart();
  // Gatilhos principais: emojis de início do template
  if (start.startsWith('🩺') || start.startsWith('💡')) return true;
  // Gatilho secundário: texto da avaliação
  return ANAMNESE_RE.test(body);
}

// ── mensagens do bot: ignorar como conteúdo clínico ──────────────────────
// TODA mensagem do bot é ignorada na construção dos casos.
function isBotMessage(body) {
  if (!body) return false;
  return (
    body.includes('🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('🧾 AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('📌 *STATUS FINAL') ||
    body.includes('📌 STATUS FINAL') ||
    body.includes('Apoio à decisão. Não substitui avaliação médica') ||
    body.includes('TRIAGEM PRÉ-ANESTÉSICA') ||
    body.includes('TRIAGEM PRE-ANESTESICA') ||
    body.includes('TRIAGEM PRÉ-OPERATÓRIA') ||
    body.includes('📋 TRIAGEM') ||
    body.includes('🧾 TRIAGEM') ||
    body.includes('🩺 *TRIAGEM') ||
    body.includes('📋 RESUMO — TRIAGEM') ||
    body.includes('Vou gerar a triagem') ||
    body.includes('Vou analisar o caso') ||
    body.includes('🔍 Buscando mensagens') ||
    body.includes('caso(s) novo(s) encontrado') ||
    body.includes('⏳ Analisando caso') ||
    body.includes('✅ Análise concluída') ||
    body.includes('Mensagens encontradas mas nenhum caso') ||
    body.includes('Nenhuma mensagem nova') ||
    body.includes('📁 CASO') ||
    body.includes('━━━━━━━━━━━━━━') ||
    body.includes('arquivo(s) não puderam ser lidos') ||
    body.includes('Erro ao buscar mensagens') ||
    body.includes('BOT DE AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('CIRURGIAS CADASTRADAS') ||
    body.includes('LIMITES / VALORES DE REFERÊNCIA') ||
    body.includes('Instruções adicionais') ||
    body.includes('📊 Status deste grupo') ||
    body.includes('Posição de leitura resetada') ||
    body.includes('Você não tem permissão') ||
    body.includes('Comando desconhecido')
  );
}

// ── análise bem-sucedida: apenas ESTAS marcam casos como já analisados ────
// CRÍTICO: mensagens de erro/status ("nenhum caso", "buscando", etc.) NÃO
// devem marcar casos como analisados — só o laudo médico real conta.
function isSuccessfulAnalysis(body) {
  if (!body) return false;
  return (
    // Laudo atual
    body.includes('🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('🧾 AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('📌 *STATUS FINAL') ||
    body.includes('📌 STATUS FINAL') ||
    body.includes('Apoio à decisão. Não substitui avaliação médica') ||
    // Laudos de versões anteriores
    body.includes('TRIAGEM PRÉ-ANESTÉSICA') ||
    body.includes('TRIAGEM PRE-ANESTESICA') ||
    body.includes('TRIAGEM PRÉ-OPERATÓRIA') ||
    body.includes('📋 TRIAGEM') ||
    body.includes('🧾 TRIAGEM') ||
    body.includes('🩺 *TRIAGEM') ||
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
  const m =
    joined.match(/Procedimento[:\s]+([^\n,]+)/i) ||
    joined.match(/Cirurgia\s+programada[:\s]+([^\n,]+)/i) ||
    joined.match(/Cirurgia[:\s]+([^\n,]+)/i) ||
    joined.match(/\b(mamoplastia|mastopexia|pr[oó]tese\s+mam[aá]ria|abdominoplastia|lipoaspira[çc][aã]o|hidrolipo|lipoescultura|rinoplastia|blefaroplastia|ritidoplastia|facelift|endometriose|videolaparoscopia|rob[oó]tica|lipo)\b/i);
  return m ? m[1].trim() : '';
}

// ── adiciona conteúdo a um container (case ou prebuffer) ─────────────────
function addToContainer(m, body, container) {
  const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';
  if (isMedia) {
    // Conta a mídia mesmo sem URL (pode não ter sido capturada pelo webhook ainda).
    // A URL será injetada por messagesWithMedia em commands.js se disponível.
    container._mediaCount = (container._mediaCount || 0) + 1;
    if (m.media) {
      container.media.push({ url: m.media, caption: body, type: m.type });
    }
    if (body) container.texts.push(body);
  } else if (m.type === 'chat' && body) {
    container.texts.push(body);
    for (const url of extractDocumentUrls(body)) {
      container.media.push({ url, caption: 'link de documento', type: 'link' });
    }
  }
}

// ── parser principal ───────────────────────────────────────────────────────
/**
 * Retorna array de blocos:
 * [{ index, texts, media: [{ url, caption, type }], _mediaCount }, ...]
 *
 * ESTRATÉGIA:
 * 1. isAnamnese detectado → abre caso formal (current).
 * 2. Conteúdo sem isAnamnese → vai para prebuffer.
 *    Quando ❌❌❌❌ chega com prebuffer → prebuffer vira caso.
 * 3. isBotMessage → ignora como conteúdo.
 *    isSuccessfulAnalysis → TAMBÉM marca blocos anteriores como _alreadyAnalyzed.
 *    IMPORTANTE: mensagens de erro/status do bot NÃO marcam como analisado —
 *    somente o laudo médico real (🧾 AVALIAÇÃO PRÉ-ANESTÉSICA etc.) marca.
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = null;   // caso aberto por isAnamnese
  let prebuffer = null; // conteúdo antes de isAnamnese explícita

  function pushCurrent() {
    if (current && (current.texts.length > 0 || current.media.length > 0 || (current._mediaCount || 0) > 0)) {
      blocks.push(current);
    }
    current = null;
  }

  function pushPrebuffer() {
    if (prebuffer) {
      const hasMedia = prebuffer.media.length > 0 || (prebuffer._mediaCount || 0) > 0;
      const hasText = prebuffer.texts.join('').length > 100;
      if (hasMedia || hasText) {
        blocks.push(prebuffer);
      }
    }
    prebuffer = null;
  }

  for (const m of messages) {
    const body = (m.body || '').trim();

    // Mensagem do bot: ignora como conteúdo clínico.
    // Só marca _alreadyAnalyzed se for um laudo real (não erros ou status).
    if (isBotMessage(body)) {
      if (isSuccessfulAnalysis(body)) {
        for (const b of blocks) b._alreadyAnalyzed = true;
      }
      continue;
    }

    // Ignora comandos (/analisar, /ajuda etc.)
    if (m.type === 'chat' && body.startsWith('/')) continue;

    // ❌❌❌❌ fecha caso explícito ou prebuffer
    if (isSeparator(body)) {
      if (current) {
        pushCurrent();
      } else {
        pushPrebuffer();
      }
      prebuffer = null;
      continue;
    }

    // Anamnese detectada: abre caso, mesclando prebuffer acumulado
    if (isAnamnese(body)) {
      pushCurrent();
      current = {
        texts: prebuffer?.texts ? [...prebuffer.texts, body] : [body],
        media: prebuffer?.media ? [...prebuffer.media] : [],
        _mediaCount: prebuffer?._mediaCount || 0,
      };
      prebuffer = null;
      continue;
    }

    // Sem caso aberto → acumula no prebuffer
    if (!current) {
      if (!prebuffer) prebuffer = { texts: [], media: [], _mediaCount: 0 };
      addToContainer(m, body, prebuffer);
      continue;
    }

    // Dentro de caso aberto por isAnamnese
    addToContainer(m, body, current);
  }

  // Fecha blocos ainda abertos ao fim do array (sem ❌ final)
  pushCurrent();
  pushPrebuffer();

  // Remove casos já analisados (bot enviou laudo após o ❌ deles) e reindexa
  const result = blocks
    .filter(b => !b._alreadyAnalyzed)
    .map((b, i) => ({ index: i + 1, ...b }));

  console.error(`[parser] blocos total=${blocks.length} já_analisados=${blocks.filter(b=>b._alreadyAnalyzed).length} novos=${result.length}`);
  return result;
}
