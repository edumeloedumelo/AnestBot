// Divide mensagens em blocos de casos fisioterapêuticos.
// Protocolo: caso abre com "start" e fecha com "finish".

// ── detecção de separador (fecha caso) ───────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^finish\b/i.test(body.trim());
}

// ── início explícito de caso ──────────────────────────────────────────────
const FISIO_RE = /avalia[çc][aã]o\s*fisioter[aá]p[eé]utica|anamnese\s+fisioter[aá]p[eé]utica|queixa\s+principal/i;
function isCaseOpener(body) {
  if (!body) return false;
  const start = body.trimStart();
  if (/^start\b/i.test(start)) return true;
  return FISIO_RE.test(body);
}

// ── mensagens do bot: ignorar como conteúdo clínico ──────────────────────
function isBotMessage(body) {
  if (!body) return false;
  return (
    body.includes('🦴 *AVALIAÇÃO FISIOTERAPÊUTICA') ||
    body.includes('🦴 AVALIAÇÃO FISIOTERAPÊUTICA') ||
    body.includes('📌 *STATUS FINAL') ||
    body.includes('📌 STATUS FINAL') ||
    body.includes('Apoio à decisão clínica. Não substitui avaliação presencial do fisioterapeuta') ||
    body.includes('*DIAGNÓSTICO CINESIOLÓGICO-FUNCIONAL') ||
    body.includes('BOT DE AVALIAÇÃO FISIOTERAPÊUTICA') ||
    body.includes('ESPECIALIDADES CONFIGURADAS') ||
    body.includes('LIMITES / VALORES DE REFERÊNCIA') ||
    body.includes('Instruções adicionais') ||
    body.includes('📊 Status deste grupo') ||
    body.includes('Posição de leitura resetada') ||
    body.includes('Você não tem permissão') ||
    body.includes('Comando desconhecido') ||
    body.includes('🔍 Buscando mensagens') ||
    body.includes('caso(s) novo(s) encontrado') ||
    body.includes('⏳ Analisando caso') ||
    body.includes('✅ Análise concluída') ||
    body.includes('Mensagens encontradas mas nenhum caso') ||
    body.includes('Nenhuma mensagem nova') ||
    body.includes('📁 CASO') ||
    body.includes('━━━━━━━━━━━━━━') ||
    body.includes('arquivo(s) não puderam ser lidos') ||
    body.includes('Erro ao buscar mensagens')
  );
}

// ── análise bem-sucedida: apenas ESTAS marcam casos como já analisados ────
function isSuccessfulAnalysis(body) {
  if (!body) return false;
  return (
    body.includes('🦴 *AVALIAÇÃO FISIOTERAPÊUTICA') ||
    body.includes('🦴 AVALIAÇÃO FISIOTERAPÊUTICA') ||
    body.includes('📌 *STATUS FINAL') ||
    body.includes('📌 STATUS FINAL') ||
    body.includes('Apoio à decisão clínica. Não substitui avaliação presencial do fisioterapeuta')
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

// ── extração de nome do paciente ──────────────────────────────────────────
export function extractName(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/Paciente[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome\s+completo[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

export function extractSpecialty(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/Especialidade[:\s]+([^\n,]+)/i) ||
    joined.match(/[Áá]rea[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

// ── adiciona conteúdo a um container ─────────────────────────────────────
function addToContainer(m, body, container) {
  const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';
  if (isMedia) {
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

// ── parser principal ──────────────────────────────────────────────────────
/**
 * Retorna array de blocos:
 * [{ index, texts, media: [{ url, caption, type }], _mediaCount }, ...]
 *
 * ESTRATÉGIA:
 * 1. "start" detectado → abre caso formal (current).
 * 2. Conteúdo sem "start" → vai para prebuffer.
 *    Quando "finish" chega com prebuffer → prebuffer vira caso.
 * 3. isBotMessage → ignora como conteúdo.
 *    isSuccessfulAnalysis → TAMBÉM marca blocos anteriores como _alreadyAnalyzed.
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = null;
  let prebuffer = null;

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

    if (isBotMessage(body)) {
      if (isSuccessfulAnalysis(body)) {
        for (const b of blocks) b._alreadyAnalyzed = true;
      }
      continue;
    }

    if (m.type === 'chat' && body.startsWith('/')) continue;

    // "finish" fecha caso explícito ou prebuffer
    if (isSeparator(body)) {
      if (current) {
        pushCurrent();
      } else {
        pushPrebuffer();
      }
      prebuffer = null;
      continue;
    }

    // "start" abre caso, mesclando prebuffer acumulado
    if (isCaseOpener(body)) {
      pushCurrent();
      // Mantém o texto do "start" apenas se contém conteúdo além da palavra-gatilho
      const openBody = /^start\s*$/i.test(body) ? null : body;
      current = {
        texts: prebuffer?.texts ? (openBody ? [...prebuffer.texts, openBody] : [...prebuffer.texts]) : (openBody ? [openBody] : []),
        media: prebuffer?.media ? [...prebuffer.media] : [],
        _mediaCount: prebuffer?._mediaCount || 0,
      };
      prebuffer = null;
      continue;
    }

    if (!current) {
      if (!prebuffer) prebuffer = { texts: [], media: [], _mediaCount: 0 };
      addToContainer(m, body, prebuffer);
      continue;
    }

    addToContainer(m, body, current);
  }

  pushCurrent();
  pushPrebuffer();

  const result = blocks
    .filter(b => !b._alreadyAnalyzed)
    .map((b, i) => ({ index: i + 1, ...b }));

  console.error(`[parser] blocos total=${blocks.length} já_analisados=${blocks.filter(b=>b._alreadyAnalyzed).length} novos=${result.length}`);
  return result;
}
