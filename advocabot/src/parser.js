// Divide mensagens em blocos de casos jurídicos.
// Protocolo: caso encerra com ❌❌❌❌. Pode começar com ⚖️/📋 ou texto de consulta.

function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗x×]+$/i.test(body) && body.includes('❌');
}

// Início explícito de caso jurídico
const CASO_RE = /consulta\s+jur[íi]dica|preciso\s+de\s+(um\s+)?advogado|assessoria\s+jur[íi]dica|caso\s+jur[íi]dico|meu\s+caso\s+[eé]|situa[çc][aã]o\s+jur[íi]dica|problema\s+com|fui\s+(demitido|processado|multado|autuado)|recebi\s+(notifica|intimação|auto\s+de\s+infra)|a[çc][aã]o\s+(trabalhista|civil|penal|fiscal)|contrato\s+(de\s+trabalho|de\s+presta)/i;

function isCaseOpener(body) {
  if (!body) return false;
  const start = body.trimStart();
  // Gatilhos emoji: ⚖️ ou 📋 no início
  if (start.startsWith('⚖️') || start.startsWith('📋') || start.startsWith('🔒') || start.startsWith('👨‍⚖️')) return true;
  // Gatilho texto: frases que indicam início de consulta jurídica
  return CASO_RE.test(body);
}

// Mensagens do próprio bot — ignorar como conteúdo do caso
function isBotMessage(body) {
  if (!body) return false;
  return (
    body.includes('⚖️ *PARECER JURÍDICO') ||
    body.includes('⚖️ PARECER JURÍDICO') ||
    body.includes('📌 *STATUS:') ||
    body.includes('📌 STATUS:') ||
    body.includes('Parecer automatizado por IA jurídica') ||
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
    body.includes('BOT DE ASSESSORIA JURÍDICA') ||
    body.includes('ÁREAS JURÍDICAS ATIVAS') ||
    body.includes('Posição de leitura resetada') ||
    body.includes('Você não tem permissão') ||
    body.includes('Comando desconhecido') ||
    body.includes('Instruções adicionais') ||
    body.includes('📊 Status deste grupo') ||
    body.includes('🤖 ADVOCABOT') ||
    body.includes('⚖️ ADVOCABOT') ||
    body.includes('🏛️ *Áreas:') ||
    body.includes('Classificando caso') ||
    body.includes('Especialistas em análise')
  );
}

// Apenas o parecer final do CEO marca casos como já analisados
function isSuccessfulAnalysis(body) {
  if (!body) return false;
  return (
    body.includes('⚖️ *PARECER JURÍDICO') ||
    body.includes('⚖️ PARECER JURÍDICO') ||
    body.includes('Parecer automatizado por IA jurídica') ||
    body.includes('📌 *STATUS:') ||
    body.includes('📌 STATUS:')
  );
}

// URLs de documentos em texto (contratos, procurações, etc.)
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

// Extrai nome do cliente
export function extractClientName(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/Cliente[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome\s+completo[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome[:\s]+([^\n,]+)/i) ||
    joined.match(/(?:me\s+chamo|sou\s+o|sou\s+a|meu\s+nome\s+[eé])\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)+)/i);
  return m ? m[1].trim() : '';
}

// Extrai tipo de caso
export function extractCaseType(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/(?:caso\s+de|tipo\s+de\s+caso|assunto)[:\s]+([^\n,]+)/i) ||
    joined.match(/\b(rescis[aã]o|demiss[aã]o|divórcio|divor[cç]io|invent[aá]rio|execu[çc][aã]o\s+fiscal|a[çc][aã]o\s+trabalhista|cobran[çc]a\s+indevida|neg[ao]tiva[çc][aã]o|acidente\s+de\s+trabalho|aposentadoria|habeas\s+corpus|falência|recupera[çc][aã]o\s+judicial)\b/i);
  return m ? m[1].trim() : '';
}

// Adiciona conteúdo ao container (caso ou prebuffer)
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

// ── Parser principal ────────────────────────────────────────────────────────
export function splitIntoCases(messages) {
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
      if (hasMedia || hasText) blocks.push(prebuffer);
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

    if (isSeparator(body)) {
      if (current) pushCurrent();
      else pushPrebuffer();
      prebuffer = null;
      continue;
    }

    if (isCaseOpener(body)) {
      pushCurrent();
      current = {
        texts: prebuffer?.texts ? [...prebuffer.texts, body] : [body],
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

  console.error(`[parser] blocos total=${blocks.length} já_analisados=${blocks.filter(b => b._alreadyAnalyzed).length} novos=${result.length}`);
  return result;
}
