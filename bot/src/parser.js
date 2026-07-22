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
}

// ── parser principal ───────────────────────────────────────────────────────
/**
 * Protocolo de delimitação:
 *   xxxx        → abre explicitamente um caso (opcional mas recomendado)
 *   ❌❌❌❌     → fecha o caso
 *
 * xxxx é OPCIONAL: se ❌❌❌❌ for recebido sem xxxx anterior, o conteúdo
 * acumulado desde o último ❌❌❌❌ (prebuffer) é tratado como o caso.
 * O prebuffer é limpo a cada ❌❌❌❌, prevenindo contaminação entre casos.
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = null;   // caso aberto explicitamente com xxxx
  let prebuffer = null; // acumula conteúdo fora de xxxx (limpo a cada ❌❌❌❌)

  function hasContent(c) {
    return c && (c.texts.length > 0 || c.media.length > 0 || (c._mediaCount || 0) > 0);
  }

  function pushCurrent() {
    if (hasContent(current)) blocks.push(current);
    current = null;
  }

  for (const m of messages) {
    const body = (m.body || '').trim();

    if (isBotMessage(body)) {
      if (isSuccessfulAnalysis(body)) {
        for (const b of blocks) b._alreadyAnalyzed = true;
        if (current) {
          current._alreadyAnalyzed = true;
          blocks.push(current);
          current = null;
        }
        prebuffer = null; // conteúdo antes do laudo já foi analisado
      }
      continue;
    }

    if (m.type === 'chat' && body.startsWith('/')) continue;

    // ❌❌❌❌ → fecha o caso
    if (isSeparator(body)) {
      if (current) {
        // Caso aberto com xxxx: fecha normalmente
        pushCurrent();
      } else if (hasContent(prebuffer)) {
        // xxxx foi omitido: usa o prebuffer como caso
        blocks.push(prebuffer);
      }
      prebuffer = null; // limpa entre casos — protege contra contaminação
      continue;
    }

    // xxxx → abre caso explícito, descarta prebuffer acumulado
    if (isCaseOpener(body)) {
      pushCurrent();
      prebuffer = null;
      current = { texts: [], media: [], _mediaCount: 0 };
      continue;
    }

    if (current) {
      addToContainer(m, body, current);
      continue;
    }

    // Fora de caso: acumula no prebuffer (usado se ❌❌❌❌ vier sem xxxx)
    if (!prebuffer) prebuffer = { texts: [], media: [], _mediaCount: 0 };
    addToContainer(m, body, prebuffer);
  }

  // Caso ainda aberto ao fim (sem ❌❌❌❌ final): considera válido e inclui.
  pushCurrent();

  const result = blocks
    .filter(b => !b._alreadyAnalyzed)
    .map((b, i) => ({ index: i + 1, ...b }));

  console.error(`[parser] blocos total=${blocks.length} já_analisados=${blocks.filter(b => b._alreadyAnalyzed).length} novos=${result.length}`);
  return result;
}
