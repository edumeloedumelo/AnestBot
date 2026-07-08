// Divide mensagens em blocos de pacientes.
// Protocolo: caso inicia com "🩺 Olá!" (ou texto de anamnese), encerra com ❌❌❌❌.
// Qualquer mensagem fora desse envelope é ignorada (incluindo respostas do próprio bot).

// ── detecção de separador ❌❌❌❌ ──────────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗x×]+$/i.test(body) && body.includes('❌');
}

// ── início de novo caso ───────────────────────────────────────────────────
// Gatilho principal: qualquer mensagem que COMECE com 🩺 (ex: "🩺 Olá!")
// Gatilho secundário: texto contendo "avaliação pré-anestésica" / "equipe de anestesia"
const ANAMNESE_RE = /avalia[çc][aã]o\s*pr[eé][-\s]?anest[eé]sica|equipe\s+de\s+anestesia/i;
function isAnamnese(body) {
  if (!body) return false;
  // Gatilho principal: começa com 🩺 (ignora espaços iniciais)
  if (body.trimStart().startsWith('🩺')) return true;
  // Gatilho secundário: texto da avaliação pré-anestésica (tolerante a variações)
  return ANAMNESE_RE.test(body);
}

// ── mensagens emitidas pelo próprio bot ───────────────────────────────────
// NUNCA devem ser reprocessadas como conteúdo clínico.
// IMPORTANTE: não usamos fromMe=true como filtro principal porque o Dr Eduardo
// também encaminha casos e exames a partir do número conectado (fromMe=true).
// O isBotReport detecta respostas do bot pelo conteúdo.
function isBotReport(body) {
  if (!body) return false;
  return (
    // ── Formato novo ──
    body.includes('🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('🧾 AVALIAÇÃO PRÉ-ANESTÉSICA') ||
    body.includes('📌 *STATUS FINAL') ||
    body.includes('📌 STATUS FINAL') ||
    body.includes('Apoio à decisão. Não substitui avaliação médica') ||
    // ── Formato anterior (retrocompatibilidade) ──
    body.includes('TRIAGEM PRÉ-ANESTÉSICA') ||
    body.includes('TRIAGEM PRE-ANESTESICA') ||
    body.includes('TRIAGEM PRÉ-OPERATÓRIA') ||
    body.includes('📋 TRIAGEM') ||
    body.includes('🧾 TRIAGEM') ||
    body.includes('🩺 *TRIAGEM') ||
    body.includes('📋 RESUMO — TRIAGEM') ||
    body.includes('Vou gerar a triagem') ||
    body.includes('Vou analisar o caso') ||
    // ── Mensagens de status do /analisar ──
    body.includes('🔍 Buscando mensagens') ||
    body.includes('caso(s) novo(s) encontrado') ||
    body.includes('⏳ Analisando caso') ||
    body.includes('✅ Análise concluída') ||
    body.includes('Mensagens encontradas mas nenhum caso') ||
    body.includes('Nenhuma mensagem nova') ||
    body.includes('📁 CASO') ||
    body.includes('━━━━━━━━━━━━━━') ||
    // ── Erros / avisos do /analisar ──
    body.includes('arquivo(s) não puderam ser lidos') ||
    body.includes('Erro ao buscar mensagens') ||
    // ── Outros comandos do bot ──
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
    joined.match(/Nome[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

export function extractSurgery(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/Procedimento[:\s]+([^\n,]+)/i) ||
    joined.match(/Cirurgia[:\s]+([^\n,]+)/i) ||
    joined.match(/\b(mamoplastia|mastopexia|pr[oó]tese\s+mam[aá]ria|abdominoplastia|lipoaspira[çc][aã]o|hidrolipo|lipoescultura|rinoplastia|blefaroplastia|ritidoplastia|facelift|endometriose|videolaparoscopia|rob[oó]tica|lipo)\b/i);
  return m ? m[1].trim() : '';
}

// ── parser principal ───────────────────────────────────────────────────────
/**
 * Retorna array de blocos:
 * [{ index, texts, media: [{ url, caption, type }] }, ...]
 *
 * REGRAS ESTRITAS:
 * - Caso DEVE começar com "🩺 Olá!" (ou texto de anamnese).
 * - Caso DEVE terminar com ❌❌❌❌ (ou pela chegada do próximo caso / fim do array).
 * - Mensagens fora de um caso aberto são IGNORADAS (inclui mídias aleatórias do grupo).
 * - Respostas do bot são detectadas por isBotReport e marcam os casos anteriores como
 *   já analisados — esses casos são excluídos do resultado mesmo com lastTime=0.
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = null;

  function pushCurrent() {
    if (current && (current.texts.length > 0 || current.media.length > 0)) {
      blocks.push(current);
    }
    current = null;
  }

  for (const m of messages) {
    const body = (m.body || '').trim();

    // Resposta do bot detectada: marca TODOS os casos acumulados até aqui como
    // já analisados. Isso garante que reanálises após redeploy do Railway (quando
    // state.json é perdido e lastTime=0) não reprocessem casos antigos.
    // NÃO usamos fromMe=true como filtro porque Dr Eduardo encaminha casos
    // a partir do número conectado (fromMe=true também).
    if (isBotReport(body)) {
      for (const b of blocks) b._alreadyAnalyzed = true;
      continue;
    }

    // Ignora comandos (/analisar, /ajuda etc.) — não são conteúdo clínico
    if (m.type === 'chat' && body.startsWith('/')) continue;

    // ❌❌❌❌ fecha o caso atual
    if (isSeparator(body)) {
      pushCurrent();
      continue;
    }

    // "🩺 Olá!" ou anamnese = início explícito de novo caso
    if (isAnamnese(body)) {
      pushCurrent();
      current = { texts: [body], media: [] };
      continue;
    }

    // ── SEM CASO ABERTO: ignora tudo ──────────────────────────────────────
    // Mídias aleatórias do grupo, conversa fora de contexto etc. são descartadas.
    // Só entra aqui se um caso foi aberto por "🩺 Olá!" ou anamnese.
    if (!current) continue;

    // ── DENTRO DE UM CASO ─────────────────────────────────────────────────
    const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';

    if (isMedia && m.media) {
      current.media.push({ url: m.media, caption: body, type: m.type });
      if (body) current.texts.push(body);
    } else if (m.type === 'chat' && body) {
      current.texts.push(body);
      // Detecta URLs de documentos compartilhados via link (ex: Acrobat Reader)
      for (const url of extractDocumentUrls(body)) {
        current.media.push({ url, caption: 'link de documento', type: 'link' });
      }
    }
  }

  // Fecha último bloco (sem ❌ no final)
  pushCurrent();

  // Filtra casos que já foram analisados (bot respondeu após o ❌❌❌❌ deles)
  // e reindexa sequencialmente
  return blocks
    .filter(b => !b._alreadyAnalyzed)
    .map((b, i) => ({ index: i + 1, ...b }));
}
