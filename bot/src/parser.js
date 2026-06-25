// Divide mensagens em blocos de pacientes.
// Detecta início de caso por anamnese OU fim de caso por ❌❌❌❌.
// Pula mensagens já respondidas pelo bot (evita reprocessar).

// ── detecção de separador ❌❌❌❌ ──────────────────────────────────────────
function isSeparator(body) {
  if (!body) return false;
  return /^[\s❌✖✗x×]+$/i.test(body) && body.includes('❌');
}

// ── início de novo caso: avaliação pré-anestésica ─────────────────────────
function isAnamnese(body) {
  if (!body) return false;
  const t = body.toLowerCase();
  return (
    t.includes('equipe de anestesia') ||
    t.includes('avaliação pré-anestésica') ||
    t.includes('avaliacao pre-anestesica') ||
    t.includes('avaliacao pre anestesica') ||
    t.includes('avaliação pre anestésica')
  );
}

// ── resposta já enviada pelo bot (não reprocessar) ────────────────────────
function isBotReport(body) {
  if (!body) return false;
  return (
    body.includes('TRIAGEM PRÉ-ANESTÉSICA') ||
    body.includes('TRIAGEM PRE-ANESTESICA') ||
    body.includes('📋 TRIAGEM') ||
    body.includes('🧾 TRIAGEM') ||
    body.includes('📋 RESUMO — TRIAGEM') ||
    body.includes('Vou gerar a triagem') ||
    body.includes('⏳ Analisando caso') ||
    body.includes('✅ Análise concluída')
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

    // Ignora respostas já emitidas pelo próprio bot
    if (m.fromMe || isBotReport(body)) continue;

    // ❌❌❌❌ fecha o caso atual
    if (isSeparator(body)) {
      pushCurrent();
      continue;
    }

    // Anamnese detectada = início de novo caso
    if (isAnamnese(body)) {
      pushCurrent();
      current = { texts: [body], media: [] };
      continue;
    }

    // Se ainda não há caso aberto, ignora (mensagem fora de contexto)
    if (!current) continue;

    const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';

    if (isMedia && m.media) {
      current.media.push({ url: m.media, caption: body, type: m.type });
      // Legenda com conteúdo clínico vira texto de contexto também
      if (body) current.texts.push(body);
    } else if (m.type === 'chat' && body) {
      current.texts.push(body);
    }
  }

  // Fecha último bloco (sem ❌ no final)
  pushCurrent();

  return blocks.map((b, i) => ({ index: i + 1, ...b }));
}
