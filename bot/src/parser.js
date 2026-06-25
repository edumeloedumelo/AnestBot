// Divide a lista de mensagens em blocos de pacientes usando ❌ como separador.
// Garante isolamento total entre casos: cada bloco tem seus próprios textos e mídias.

const SEPARATOR_RE = /^[\s❌✖✗x×]+$/i;

function isSeparator(body) {
  if (!body) return false;
  // Linha composta só por ❌ (e variações visuais), espaços ou combinações deles
  return SEPARATOR_RE.test(body) && /❌/.test(body);
}

/**
 * Recebe array de mensagens (já filtradas e ordenadas) e retorna array de blocos:
 * [
 *   { index: 1, texts: ['...'], media: [{ url, caption, type }] },
 *   { index: 2, texts: ['...'], media: [...] },
 *   ...
 * ]
 * Blocos vazios (sem texto nem mídia) são descartados.
 */
export function splitIntoPatients(messages) {
  const blocks = [];
  let current = { texts: [], media: [] };

  for (const m of messages) {
    const body = (m.body || '').trim();

    if (isSeparator(body)) {
      // Finaliza bloco atual se tiver conteúdo
      if (current.texts.length > 0 || current.media.length > 0) {
        blocks.push(current);
      }
      current = { texts: [], media: [] };
      continue;
    }

    const isMedia = m.type === 'image' || m.type === 'document' || m.type === 'video';

    if (isMedia && m.media) {
      current.media.push({ url: m.media, caption: body, type: m.type });
      if (body) current.texts.push(body); // legenda vira contexto/anamnese
    } else if (m.type === 'chat' && body) {
      current.texts.push(body);
    }
  }

  // Último bloco (sem ❌ no final)
  if (current.texts.length > 0 || current.media.length > 0) {
    blocks.push(current);
  }

  return blocks.map((b, i) => ({ index: i + 1, ...b }));
}
