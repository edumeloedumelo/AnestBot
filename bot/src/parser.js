// Divide mensagens em blocos de pacientes.
// Detecta início de caso por anamnese OU fim de caso por ❌❌❌❌.
// Pula mensagens já respondidas pelo bot (evita reprocessar).

// ── detecção de separador ❌❌❌❌ ──────────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗x×]+$/i.test(body) && body.includes('❌');
}

// ── início de novo caso: avaliação pré-anestésica ─────────────────────────
// Regex tolerante a variações de acento, espaço e hífen.
const ANAMNESE_RE = /avalia[çc][aã]o\s*pr[eé][-\s]?anest[eé]sica|equipe\s+de\s+anestesia/i;
function isAnamnese(body) {
  return ANAMNESE_RE.test(body || '');
}

// ── mensagem emitida pelo próprio bot (relatório ou status) — não reprocessar ──
function isBotReport(body) {
  if (!body) return false;
  return (
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
    body.includes('━━━━━━━━━━━━━━')
  );
}

// ── URLs de documentos em mensagens de texto ──────────────────────────────
const URL_RE = /https?:\/\/\S+/g;
function extractDocumentUrls(text) {
  const urls = [];
  for (const match of (text || '').matchAll(URL_RE)) {
    const url = match[0].replace(/[)\].,!?'"]+$/, ''); // remove pontuação final
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

// ── extração de nome e cirurgia (padrões do formulário da secretaria) ─────
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
    joined.match(/\b(mamoplastia|abdominoplastia|lipoaspira[çc][aã]o|rinoplastia|blefaroplastia|ritidoplastia|mastopexia|lipo)\b/i);
  return m ? m[1].trim() : '';
}

// ── parser principal ───────────────────────────────────────────────────────
/**
 * Retorna array de blocos:
 * [{ index, texts, media: [{ url, caption, type }] }, ...]
 * Blocos vazios (sem anamnese nem mídia) são descartados.
 *
 * Comportamento de abertura de bloco:
 * - Anamnese detectada → abre bloco explicitamente.
 * - Qualquer texto ou mídia clínica → abre bloco implicitamente (sem descarte silencioso).
 * - ❌❌❌❌ → fecha e separa blocos.
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = null;

  function ensureOpen() {
    if (!current) current = { texts: [], media: [] };
  }

  function pushCurrent() {
    if (current && (current.texts.length > 0 || current.media.length > 0)) {
      blocks.push(current);
    }
    current = null;
  }

  for (const m of messages) {
    const body = (m.body || '').trim();

    if (isBotReport(body)) continue;
    if (m.type === 'chat' && body.startsWith('/')) continue;

    // ❌❌❌❌ fecha o caso atual
    if (isSeparator(body)) {
      pushCurrent();
      continue;
    }

    // Anamnese detectada = início explícito de novo caso
    if (isAnamnese(body)) {
      pushCurrent();
      current = { texts: [body], media: [] };
      continue;
    }

    const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';

    if (isMedia && m.media) {
      ensureOpen();
      current.media.push({ url: m.media, caption: body, type: m.type });
      if (body) current.texts.push(body);
    } else if (m.type === 'chat' && body) {
      ensureOpen();
      current.texts.push(body);
      // Detecta URLs de PDF/documento compartilhado em texto (ex: link do Acrobat Reader)
      for (const url of extractDocumentUrls(body)) {
        current.media.push({ url, caption: 'link de documento', type: 'link' });
      }
    }
  }

  // Fecha último bloco (sem ❌ no final)
  pushCurrent();

  return blocks.map((b, i) => ({ index: i + 1, ...b }));
}
