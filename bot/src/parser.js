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
    body.includes('Já há uma análise em andamento')
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
  // Captura o valor do campo Procedimento/Cirurgia, inclusive quando o texto quebra
  // em mais de uma linha (ex.: "Mastopexia com\npróteses + lipo de axilas").
  // Para no próximo campo (🔷/🔹/Data/Telefone/Observação/pergunta numerada) ou linha em branco.
  const stop = /(?=\n\s*(?:🔷|🔹|🔶|Data\b|Telefone\b|Observ|Paciente\b|\d️?⃣|[-_—]{3,})|\n\n|$)/;
  const field = (label) => new RegExp(`${label}\\s*[:\\-：]\\s*([\\s\\S]{3,180}?)${stop.source}`, 'i');
  const m =
    joined.match(field('Procedimento')) ||
    joined.match(field('Cirurgia\\s+programada')) ||
    joined.match(field('Cirurgia')) ||
    joined.match(/\b(mamoplastia|mastopexia|mammy\s*makeover|pr[oó]tese\s+mam[aá]ria|abdominoplastia|lipoaspira[çc][aã]o|hidrolipo|lipoescultura|rinoplastia|blefaroplastia|ritidoplastia|facelift|endometriose|histeroscopia|videolaparoscopia|rob[oó]tica|lipo)\b/i);
  if (!m) return '';
  // Normaliza: junta quebras de linha internas num espaço só.
  return m[1].replace(/\s*\n\s*/g, ' ').trim();
}

// ── adiciona conteúdo a um caso aberto ───────────────────────────────────
function addToContainer(m, body, container) {
  const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';
  if (isMedia) {
    container._mediaCount = (container._mediaCount || 0) + 1;
    if (m.media) {
      container.media.push({ url: m.media, caption: body, type: m.type });
    } else {
      // Sem URL: guarda o nome do arquivo (body costuma ser o filename do WhatsApp
      // quando não há legenda) para o aviso ao usuário poder listar QUAIS falharam.
      container.missingMediaNames = container.missingMediaNames || [];
      container.missingMediaNames.push(body || `arquivo ${m.type} sem nome`);
    }
    if (body) container.texts.push(body);
  } else if (body) {
    // Aceita qualquer tipo de mensagem de texto: chat, forward, extended_text etc.
    // UltraMsg pode retornar mensagens encaminhadas com type diferente de 'chat'.
    container.texts.push(body);
    for (const url of extractDocumentUrls(body)) {
      container.media.push({ url, caption: 'link de documento', type: 'link' });
    }
    // Sinaliza mensagem curta de terceiro dentro do caso (ver diagnóstico acima)
    // — usado por commands.js para avisar o usuário proativamente em vez de
    // deixar o bot simplesmente reportar "cirurgia não informada" sem explicação.
    // Não exige isForwarded: o corte acontece com ou sem esse flag.
    if (m.type === 'chat' && m.fromMe === false && body.length < 250) {
      container._hasShortThirdPartyText = true;
    }
  }
  // Rastreamento para dedup durável, gate de recência e retry cirúrgico (/resetar).
  if (m.id) container._msgIds.push(m.id);
  const t = m.timestamp || m.time || 0;
  if (t > container._maxTime) container._maxTime = t;
  if (t > 0 && (container._minTime === 0 || t < container._minTime)) container._minTime = t;
}

function newContainer() {
  return { texts: [], media: [], _mediaCount: 0, _msgIds: [], _maxTime: 0, _minTime: 0 };
}

// Resolve o texto de uma mensagem de forma robusta. Mensagens ENCAMINHADAS e de
// tipos diferentes de "chat" às vezes trazem o texto fora de m.body (em text,
// caption, quotedMsgBody etc.), e APIs baseadas em bibliotecas estilo Baileys
// aninham o texto dentro de um objeto "message" (m.message.conversation,
// m.message.extendedTextMessage.text) em vez de uma string simples — por isso
// testamos tanto campos string diretos quanto caminhos aninhados de objeto.
export function getMessageBody(m) {
  const candidates = [
    m.body, m.text, m.caption, m.content,
    m.quotedMsgBody, m.conversation,
    m.extendedTextMessage?.text,
    m.msg,
    // Campos que podem ser string OU objeto aninhado, dependendo da lib subjacente:
    typeof m.message === 'string' ? m.message : undefined,
    m.message?.conversation,
    m.message?.extendedTextMessage?.text,
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation,
    m.contextInfo?.quotedMessage?.conversation,
    typeof m.data === 'string' ? m.data : undefined,
    m.data?.body,
    m.data?.message,
  ];
  // Retorna o candidato MAIS LONGO (não o primeiro não-vazio). Motivo: evidência
  // real mostrou m.body chegando como um PREVIEW curto (só a primeira linha) em
  // algumas mensagens de terceiros, enquanto outro campo já testado aqui (ex.:
  // m.text, m.message.conversation) pode conter o texto completo. Se sempre
  // pegássemos o primeiro campo não-vazio, o texto completo nesses outros campos
  // nunca seria alcançado — m.body "ganhava" antes por estar primeiro na lista.
  let best = '';
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > best.length) best = c.trim();
  }
  return best;
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
    const body = getMessageBody(m).trim();

    // Diagnóstico: revela o payload cru de mensagens sem body/texto reconhecido
    // (ex.: encaminhadas com o texto em outro campo) para depurar casos perdidos.
    if (!body && m.type !== 'image' && m.type !== 'document' && m.type !== 'video') {
      console.error(`[parser] mensagem sem texto reconhecido — payload cru: ${JSON.stringify(m).slice(0, 500)}`);
    }

    // Diagnóstico: mensagens de texto de terceiros (não do médico/bot) com corpo
    // suspeitosamente curto são um forte indício de que o WhatsApp/UltraMsg entrega
    // só um cabeçalho/template — os campos preenchidos (Paciente/Procedimento/
    // Telefone) nunca chegam ao servidor, independente de ser forward ou cópia.
    // NÃO exige isForwarded (evidência real mostrou o corte acontecer também sem
    // esse flag). Dump COMPLETO do payload cru — sem cap curto — para expor
    // qualquer campo de template (ex.: hydratedTemplate) que estejamos perdendo.
    if (m.type === 'chat' && m.fromMe === false && body && body.length < 250) {
      console.error(`[parser] ⚠️ mensagem curta (${body.length} chars) de terceiro — possível perda de campos de template. payload cru COMPLETO: ${JSON.stringify(m)}`);
    }

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

    // Detecta os marcadores xxxx / ❌❌❌❌ mesmo quando estão COLADOS ao conteúdo
    // na MESMA mensagem. Evidência real: usuários enviam "xxxx\n\n[card da anamnese]"
    // ou "[conteúdo]\n❌❌❌❌" numa única mensagem — antes, isso não era reconhecido
    // como marcador (exigíamos a mensagem inteira ser só o marcador) e o card era
    // descartado. Agora olhamos a PRIMEIRA e a ÚLTIMA linha da mensagem.
    const lines = body.split('\n');
    let opensHere = false;
    let closesHere = false;
    if (lines.length && isCaseOpener(lines[0])) { opensHere = true; lines.shift(); }
    if (lines.length && isSeparator(lines[lines.length - 1])) { closesHere = true; lines.pop(); }
    const inner = lines.join('\n').trim();

    // xxxx no início → abre novo caso (fecha o anterior se estava aberto sem ❌).
    if (opensHere) {
      pushCurrent();
      current = newContainer();
    }

    // Conteúdo (o que sobrou depois de remover marcadores das pontas).
    if (inner) {
      if (current) {
        addToContainer(m, inner, current);
      } else {
        // FORA de qualquer caso (sem xxxx ativo): IGNORAR (regra ABSOLUTA).
        console.error(`[parser] ignorando mensagem fora de bloco: type=${m.type} body="${inner.slice(0, 40)}"`);
      }
    }

    // ❌❌❌❌ no fim → fecha o caso atual.
    if (closesHere) {
      pushCurrent();
    }
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
