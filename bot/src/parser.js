// Divide mensagens em blocos de pacientes.
// Protocolo: caso encerra com ❌❌❌❌. Pode ou não começar com 🩺/anamnese.
// Respostas do próprio bot são ignoradas e marcam casos anteriores como já analisados.

// ── detecção de separador ❌❌❌❌ ──────────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗x×]+$/i.test(body) && body.includes('❌');
}

// ── início explícito de novo caso ─────────────────────────────────────────
// Gatilho 1: começa com 🩺 ou 💡 (emojis usados no template de avaliação)
// Gatilho 2: texto contendo "avaliação pré-anestésica" / "equipe de anestesia"
const ANAMNESE_RE = /avalia[çc][aã]o\s*pr[eé][-\s]?anest[eé]sica|equipe\s+de\s+anestesia/i;
function isAnamnese(body) {
  if (!body) return false;
  const start = body.trimStart();
  if (start.startsWith('🩺') || start.startsWith('💡')) return true;
  return ANAMNESE_RE.test(body);
}

// ── mensagens emitidas pelo próprio bot ───────────────────────────────────
// NÃO usamos fromMe=true como filtro principal: Dr Eduardo também encaminha
// casos e exames a partir do número conectado (fromMe=true também).
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
    joined.match(/Nome[:\s]+([^\n,]+)/i) ||
    joined.match(/Nome\s+completo[:\s]+([^\n,]+)/i);
  return m ? m[1].trim() : '';
}

export function extractSurgery(texts) {
  const joined = texts.join('\n');
  const m =
    joined.match(/Procedimento[:\s]+([^\n,]+)/i) ||
    joined.match(/Cirurgia[:\s]+([^\n,]+)/i) ||
    joined.match(/Cirurgia\s+programada[:\s]+([^\n,]+)/i) ||
    joined.match(/\b(mamoplastia|mastopexia|pr[oó]tese\s+mam[aá]ria|abdominoplastia|lipoaspira[çc][aã]o|hidrolipo|lipoescultura|rinoplastia|blefaroplastia|ritidoplastia|facelift|endometriose|videolaparoscopia|rob[oó]tica|lipo)\b/i);
  return m ? m[1].trim() : '';
}

// ── parser principal ───────────────────────────────────────────────────────
/**
 * Retorna array de blocos:
 * [{ index, texts, media: [{ url, caption, type }] }, ...]
 *
 * ESTRATÉGIA DUPLA:
 * 1. Se "🩺"/"💡"/anamnese detectado → abre caso normalmente (modo estrito).
 * 2. Se conteúdo chega sem marcador de anamnese → acumula em prebuffer.
 *    Quando ❌❌❌❌ chega com prebuffer não-vazio → prebuffer vira caso.
 *    Isso garante que variações de formato ou mensagens sem cabeçalho
 *    ainda sejam analisadas corretamente.
 *
 * Respostas do bot (isBotReport) marcam todos os blocos anteriores como
 * _alreadyAnalyzed → filtrados do resultado mesmo com lastTime=0 (após redeploy).
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = null;   // caso aberto por isAnamnese
  let prebuffer = null; // conteúdo acumulado sem isAnamnese explícita

  function pushCurrent() {
    if (current && (current.texts.length > 0 || current.media.length > 0)) {
      blocks.push(current);
    }
    current = null;
  }

  // Prebuffer vira caso quando ❌ chega sem isAnamnese. Requer conteúdo mínimo:
  // ao menos 1 mídia OU ao menos 2 linhas de texto, para evitar falsos positivos.
  function pushPrebuffer() {
    if (prebuffer && (prebuffer.media.length > 0 || prebuffer.texts.length >= 2)) {
      blocks.push(prebuffer);
    }
    prebuffer = null;
  }

  function addToContainer(m, body, container) {
    const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';
    if (isMedia && m.media) {
      container.media.push({ url: m.media, caption: body, type: m.type });
      if (body) container.texts.push(body);
    } else if (m.type === 'chat' && body) {
      container.texts.push(body);
      for (const url of extractDocumentUrls(body)) {
        container.media.push({ url, caption: 'link de documento', type: 'link' });
      }
    }
  }

  for (const m of messages) {
    const body = (m.body || '').trim();

    // Resposta do bot: marca TODOS os casos acumulados como já analisados.
    // Garante que reanálises após redeploy (lastTime=0) não reprocessem casos antigos.
    if (isBotReport(body)) {
      for (const b of blocks) b._alreadyAnalyzed = true;
      continue;
    }

    // Ignora comandos (/analisar, /ajuda etc.)
    if (m.type === 'chat' && body.startsWith('/')) continue;

    // ❌❌❌❌ fecha caso explícito OU prebuffer
    if (isSeparator(body)) {
      if (current) {
        pushCurrent();
      } else {
        pushPrebuffer();
      }
      prebuffer = null;
      continue;
    }

    // Anamnese detectada explicitamente: abre caso formal,
    // mesclando qualquer prebuffer acumulado antes (ex: exame enviado antes da anamnese).
    if (isAnamnese(body)) {
      pushCurrent();
      current = {
        texts: prebuffer?.texts ? [...prebuffer.texts, body] : [body],
        media: prebuffer?.media ? [...prebuffer.media] : [],
      };
      prebuffer = null;
      continue;
    }

    // Sem caso aberto → acumula em prebuffer (fallback para formatos sem marcador)
    if (!current) {
      if (!prebuffer) prebuffer = { texts: [], media: [] };
      addToContainer(m, body, prebuffer);
      continue;
    }

    // Dentro de um caso aberto por isAnamnese
    addToContainer(m, body, current);
  }

  // Fecha blocos ainda abertos ao fim do array (sem ❌ final)
  pushCurrent();
  pushPrebuffer();

  // Filtra casos já analisados (bot respondeu após o ❌❌❌❌ deles) e reindexa
  return blocks
    .filter(b => !b._alreadyAnalyzed)
    .map((b, i) => ({ index: i + 1, ...b }));
}
