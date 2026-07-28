// Baixa uma mídia (imagem/PDF/link) e devolve um bloco pronto para o Claude.
// Robusto a lixo/framing no início do arquivo (visto em produção: 4 bytes antes
// do "%PDF") — varre uma janela e CORTA o buffer no cabeçalho real.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);
const PDF_COMPRESS_THRESHOLD = 10 * 1024 * 1024; // 10 MB
const MAGIC_SCAN_WINDOW = 32;

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
    await execFileAsync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${outPath}`, inPath]);
    const compressed = await readFile(outPath);
    console.error(`[media] pdf comprimido: ${buffer.byteLength} → ${compressed.length}`);
    return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
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

export async function downloadMediaBlock(url) {
  const res = await fetch(url);
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  if (ct.includes('text/html')) {
    throw new Error('arquivo veio como página HTML (link externo protegido) — envie o arquivo direto pelo WhatsApp.');
  }

  let buffer = await res.arrayBuffer();
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
    if (bytes.length > PDF_COMPRESS_THRESHOLD) {
      try { buffer = await compressPdf(buffer); bytes = new Uint8Array(buffer); }
      catch (e) { console.error('[media] compressão falhou, usando original:', e.message); }
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buffer) } };
  }
  if (kind) {
    return { type: 'image', source: { type: 'base64', media_type: kind, data: toBase64(buffer) } };
  }
  throw new Error('formato de arquivo não suportado/ilegível');
}
