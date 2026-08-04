// Baixa uma mídia (imagem/PDF/link) e devolve um bloco pronto para o Claude.
// Robusto a lixo/framing no início do arquivo (visto em produção: 4 bytes antes
// do "%PDF") — varre uma janela e CORTA o buffer no cabeçalho real.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);
// 4 MB (era 10): casos com MUITOS exames somavam dezenas de MB e estouravam o
// limite TOTAL de ~32MB por requisição da API (413 request_too_large em produção
// com 15 exames). /ebook = 150dpi, laudos continuam legíveis.
const PDF_COMPRESS_THRESHOLD = 4 * 1024 * 1024;
const MAGIC_SCAN_WINDOW = 32;
// Limites da API do Claude para imagens: 5 MB e 8000 px por lado. Validar ANTES
// de enviar evita o 400 "Could not process image" que derruba o caso inteiro.
const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;
const MAX_IMAGE_DIM = 7900;

// Dimensões de JPEG: varre os marcadores até um SOF (C0–CF, exceto C4/C8/CC).
export function jpegDims(bytes) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xFF) { i++; continue; }
    // Marcadores standalone (sem length): TEM, RST0-7, SOI, EOI — só pula os 2 bytes.
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue; }
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

// Dimensões de PNG: IHDR fixo após a assinatura de 8 bytes.
// Aritmética sem bit-shift: << é int32 com sinal e um IHDR malformado (byte alto
// setado) viraria número NEGATIVO, passando batido pela checagem de limite.
export function pngDims(bytes) {
  if (bytes.length < 24) return null;
  return {
    width: bytes[16] * 0x1000000 + bytes[17] * 0x10000 + bytes[18] * 0x100 + bytes[19],
    height: bytes[20] * 0x1000000 + bytes[21] * 0x10000 + bytes[22] * 0x100 + bytes[23],
  };
}

// Dimensões de GIF: Logical Screen Descriptor (little-endian) após "GIF8xa".
export function gifDims(bytes) {
  if (bytes.length < 10) return null;
  return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
}

// Dimensões de WEBP: cobre VP8X (extended), VP8L (lossless) e VP8 (lossy).
export function webpDims(bytes) {
  if (bytes.length < 30) return null;
  const four = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (four === 'VP8X') {
    return {
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    };
  }
  if (four === 'VP8L' && bytes[20] === 0x2F) {
    return {
      width: 1 + (((bytes[22] & 0x3F) << 8) | bytes[21]),
      height: 1 + (((bytes[24] & 0x0F) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xC0) >> 6)),
    };
  }
  if (four === 'VP8 ' && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3FFF,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3FFF,
    };
  }
  return null;
}

// Lança erro claro se a imagem excede os limites da API (tamanho/dimensão).
export function assertImageWithinLimits(kind, bytes) {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`imagem muito grande (${(bytes.length / 1048576).toFixed(1)} MB, limite 5 MB) — reenviar em qualidade menor`);
  }
  const dims = kind === 'image/jpeg' ? jpegDims(bytes)
             : kind === 'image/png' ? pngDims(bytes)
             : kind === 'image/gif' ? gifDims(bytes)
             : kind === 'image/webp' ? webpDims(bytes)
             : null;
  if (dims && (dims.width > MAX_IMAGE_DIM || dims.height > MAX_IMAGE_DIM)) {
    throw new Error(`imagem com ${dims.width}×${dims.height}px (limite 8000px) — reenviar em resolução menor`);
  }
}

// Procura a marca de arquivo (PDF/JPEG/PNG/GIF/WEBP) numa janela inicial.
function findMagicOffset(bytes) {
  const max = Math.min(bytes.length - 4, MAGIC_SCAN_WINDOW);
  for (let i = 0; i <= max; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) return { kind: 'pdf', offset: i };
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) return { kind: 'image/jpeg', offset: i };
    if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47) return { kind: 'image/png', offset: i };
    if (bytes[i] === 0x47 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x46 && bytes[i + 3] === 0x38) return { kind: 'image/gif', offset: i };
    if (bytes[i] === 0x52 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x46 && bytes[i + 3] === 0x46 &&
        bytes[i + 8] === 0x57 && bytes[i + 9] === 0x45 && bytes[i + 10] === 0x42 && bytes[i + 11] === 0x50) return { kind: 'image/webp', offset: i };
  }
  return null;
}

async function compressPdf(buffer) {
  const id = randomBytes(8).toString('hex');
  const inPath = `${tmpdir()}/pdf-in-${id}.pdf`;
  const outPath = `${tmpdir()}/pdf-out-${id}.pdf`;
  try {
    await writeFile(inPath, Buffer.from(buffer));
    // Timeout: ghostscript pode travar indefinidamente num PDF malformado —
    // sem isso, o /analisar prende o lock do grupo até o processo reiniciar.
    await execFileAsync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${outPath}`, inPath],
      { timeout: 60_000, killSignal: 'SIGKILL' });
    const compressed = await readFile(outPath);
    console.error(`[media] pdf comprimido: ${buffer.byteLength} → ${compressed.length}`);
    return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// Normaliza uma FOTO de exame antes de enviar ao Claude (aprovado pelo loop):
// corrige orientação EXIF, limita a 2600px (teto efetivo do modelo), melhora
// contraste com contrast-stretch suave e nitidez leve — operações GLOBAIS que
// nunca fabricam conteúdo (binarização/morfologia/median são PROIBIDAS).
// Saída sempre JPEG q92. Falhou por qualquer motivo (sem ImageMagick, timeout,
// erro)? Devolve null e o chamador usa o buffer ORIGINAL — comportamento atual.
export async function processImage(buffer, { maxDim = 2600, quality = 92 } = {}) {
  const id = randomBytes(8).toString('hex');
  const inPath = `${tmpdir()}/img-in-${id}`;
  const outPath = `${tmpdir()}/img-out-${id}.jpg`;
  try {
    await writeFile(inPath, Buffer.from(buffer));
    await execFileAsync('convert', [
      inPath,
      '-limit', 'memory', '256MiB', '-limit', 'map', '256MiB', '-limit', 'thread', '1',
      '-auto-orient',
      '-resize', `${maxDim}x${maxDim}>`,
      '-contrast-stretch', '0.5%x0.5%',
      '-unsharp', '0x1',
      '-quality', String(quality),
      `jpg:${outPath}`,
    ], { timeout: 30_000, killSignal: 'SIGKILL' });
    const out = await readFile(outPath);
    // Sanidade: saída precisa ser um JPEG real e não-trivial, senão fallback.
    if (out.length < 5000 || out[0] !== 0xFF || out[1] !== 0xD8) throw new Error('saída inválida do convert');
    console.error(`[media] imagem normalizada: ${buffer.byteLength} → ${out.length} bytes`);
    return { buffer: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), kind: 'image/jpeg' };
  } catch (e) {
    console.error('[media] processImage indisponível/falhou, usando original:', e.message);
    return null;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

const DOWNLOAD_TIMEOUT_MS = 60_000; // servidor-a-servidor, mas PDFs de laudo podem ter 15-20MB

// `aggressive: true` (usado quando o CASO INTEIRO excede o orçamento de payload
// da API): força compressão do PDF mesmo pequeno e reduz imagens a 1600px/q80 —
// ainda legível para laudos; se ficar ilegível, o modelo declara ilegível (falha
// segura), nunca inventa.
export async function downloadMediaBlock(url, { aggressive = false } = {}) {
  // Timeout: sem isso, um host de mídia que nunca responde trava o /analisar
  // do grupo PARA SEMPRE (o lock em commands.js só libera quando o await volta).
  // O timer cobre a requisição INTEIRA, inclusive a leitura do corpo: um
  // servidor que responde headers rápido mas goteja o body devagar travaria o
  // arrayBuffer() para sempre se o timeout fosse cancelado após o fetch().
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let buffer;
  let ct = ''; // fora do try: o fallback por content-type (abaixo) usa depois
  try {
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`download travou (sem resposta em ${DOWNLOAD_TIMEOUT_MS / 1000}s)`);
      throw e;
    }
    ct = res.headers.get('content-type') || '';
    if (!res.ok) { res.body?.cancel()?.catch(() => {}); throw new Error(`download falhou (${res.status})`); }
    if (ct.includes('text/html')) {
      res.body?.cancel()?.catch(() => {});
      throw new Error('arquivo veio como página HTML (link externo protegido) — envie o arquivo direto pelo WhatsApp.');
    }
    try {
      buffer = await res.arrayBuffer();
    } catch (e) {
      if (e.name === 'AbortError' || controller.signal.aborted) throw new Error(`download travou (corpo não chegou em ${DOWNLOAD_TIMEOUT_MS / 1000}s)`);
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
  let bytes = new Uint8Array(buffer);
  if (bytes.length === 0) throw new Error('arquivo vazio');

  // Corta lixo inicial se a marca não estiver no byte 0.
  const found = findMagicOffset(bytes);
  if (found && found.offset > 0) {
    console.error(`[media] cortando ${found.offset} byte(s) de lixo inicial`);
    buffer = buffer.slice(found.offset);
    bytes = new Uint8Array(buffer);
  }
  let kind = found ? found.kind : null;
  if (!kind) {
    if (ct.includes('pdf')) kind = 'pdf';
    else if (ct.startsWith('image/')) {
      kind = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp'
           : ct.includes('gif') ? 'image/gif' : 'image/jpeg';
    }
  }

  if (kind === 'pdf') {
    if (findMagicOffset(bytes)?.kind !== 'pdf') throw new Error('rotulado PDF mas conteúdo inválido');
    if (aggressive || bytes.length > PDF_COMPRESS_THRESHOLD) {
      try { buffer = await compressPdf(buffer); bytes = new Uint8Array(buffer); }
      catch (e) { console.error('[media] compressão falhou, usando original:', e.message); }
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buffer) } };
  }
  if (kind) {
    // Normalização (orientação/contraste/tamanho) — nunca no branch de PDF.
    const processed = await processImage(buffer, aggressive ? { maxDim: 1600, quality: 80 } : {});
    if (processed) {
      buffer = processed.buffer;
      bytes = new Uint8Array(buffer);
      kind = processed.kind; // saída é JPEG — media_type reflete o conteúdo real
    }
    // Guarda final SEMPRE nos bytes pós-processamento (condição do CEO).
    assertImageWithinLimits(kind, bytes);
    return { type: 'image', source: { type: 'base64', media_type: kind, data: toBase64(buffer) } };
  }
  throw new Error('formato de arquivo não suportado/ilegível');
}
