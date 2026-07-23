// Cliente da API UltraMsg: envio de texto e download de mídia recebida.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);

const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;

// WhatsApp aceita ~65k mas mensagens longas falham/cortam; mantemos pedaços seguros.
const MAX_LEN = 4000;

// PDFs acima deste tamanho são comprimidos pelo Ghostscript antes de ir ao Claude.
const PDF_COMPRESS_THRESHOLD = 10 * 1024 * 1024; // 10 MB

export async function sendText(to, body) {
  if (!body) return;
  const chunks = splitMessage(body, MAX_LEN);
  for (const chunk of chunks) {
    const res = await fetch(`${BASE}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN, to, body: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      console.error('[ultramsg] send error', res.status, JSON.stringify(data));
    }
  }
}

// Quebra texto respeitando, na medida do possível, quebras de linha.
export function splitMessage(text, max = MAX_LEN) {
  if (text.length <= max) return [text];
  const out = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + '\n' + line).length > max) {
      if (buf) out.push(buf);
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
        buf = '';
      } else {
        buf = line;
      }
    } else {
      buf = buf ? buf + '\n' + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Comprime um PDF usando Ghostscript. Retorna ArrayBuffer do arquivo comprimido.
async function compressPdf(buffer) {
  const id = randomBytes(8).toString('hex');
  const inPath = `${tmpdir()}/pdf-in-${id}.pdf`;
  const outPath = `${tmpdir()}/pdf-out-${id}.pdf`;
  try {
    await writeFile(inPath, Buffer.from(buffer));
    await execFileAsync('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outPath}`,
      inPath,
    ]);
    const compressed = await readFile(outPath);
    console.error(`[pdf] comprimido: ${buffer.byteLength} → ${compressed.length} bytes`);
    return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// Baixa a mídia (imagem/pdf/link) de uma URL e devolve bloco pronto p/ Claude.
// isLink=true indica URL compartilhada como texto (ex: Acrobat Reader, Google Drive).
export async function downloadMediaBlock(url, isLink = false) {
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  console.error(`[media] url=${url.substring(0, 80)} status=${res.status} content-type=${contentType}`);

  if (!res.ok) throw new Error(`download falhou (${res.status})`);

  // Link de nuvem que retornou uma página HTML = requer autenticação, não temos acesso.
  if (contentType.includes('text/html')) {
    throw new Error(
      'PDF enviado como link externo (Acrobat, Drive etc.) — não é possível acessar. ' +
      'Peça para enviar o arquivo diretamente pelo WhatsApp.'
    );
  }

  let buffer = await res.arrayBuffer();
  let bytes = new Uint8Array(buffer);

  if (bytes.length === 0) throw new Error('arquivo vazio');

  const magic = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');

  // Alguns downloads (observado em produção: PDFs via UltraMsg) chegam com bytes
  // de lixo/framing na frente do arquivo real (ex.: 4 bytes de length-prefix antes
  // do "%PDF-"). Sem isso, um arquivo 100% válido era rejeitado como "conteúdo
  // inválido". Varremos uma janela inicial procurando a marca real e CORTAMOS o
  // buffer nesse ponto — não basta identificar o tipo, o conteúdo enviado ao
  // Claude/Ghostscript precisa começar exatamente na marca.
  const found = findMagicOffset(bytes);
  if (found && found.offset > 0) {
    console.error(`[media] marca de arquivo encontrada no offset ${found.offset} (não em 0) — removendo ${found.offset} byte(s) de lixo inicial`);
    buffer = buffer.slice(found.offset);
    bytes = new Uint8Array(buffer);
  }
  let kind = found ? found.kind : null;
  console.error(`[media] size=${bytes.length} magic=${magic} sniff=${kind}`);

  if (!kind) {
    if (contentType.includes('pdf')) kind = 'pdf';
    else if (contentType.startsWith('image/')) {
      kind = contentType.includes('png') ? 'image/png'
        : contentType.includes('webp') ? 'image/webp'
        : contentType.includes('gif') ? 'image/gif'
        : 'image/jpeg';
    }
  }
  console.error(`[media] kind-final=${kind}`);

  if (kind === 'pdf') {
    if (sniffType(bytes) !== 'pdf') throw new Error('rotulado como PDF mas conteúdo inválido');
    if (bytes.length > PDF_COMPRESS_THRESHOLD) {
      console.error(`[pdf] PDF grande (${bytes.length} bytes), comprimindo...`);
      try {
        buffer = await compressPdf(buffer);
        bytes = new Uint8Array(buffer);
      } catch (e) {
        console.error('[pdf] compressão falhou, usando original:', e.message);
      }
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bufferToBase64(buffer) } };
  }

  if (kind) {
    return { type: 'image', source: { type: 'base64', media_type: kind, data: bufferToBase64(buffer) } };
  }

  // Tipo não reconhecido: tenta como texto se for legível, senão descarta.
  const textContent = new TextDecoder().decode(buffer).substring(0, 10000);
  if (/[\x20-\x7E]/.test(textContent) && !/[\x00-\x08]/.test(textContent.substring(0, 200))) {
    return { type: 'text', text: `### ARQUIVO ENVIADO\n${textContent}` };
  }
  throw new Error('formato de arquivo não suportado/ilegível');
}

// Bytes a examinar em busca de uma marca de arquivo conhecida antes de desistir.
// Cobre o caso real observado (4 bytes de length-prefix) com folga.
const MAGIC_SCAN_WINDOW = 32;

// Varre uma janela inicial (não só o byte 0) procurando marcas de arquivo
// conhecidas. Retorna { kind, offset } ou null. Tolera bytes de lixo/framing
// na frente do conteúdo real (ex.: length-prefix, artefato de CDN/proxy).
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

function sniffType(bytes) {
  const found = findMagicOffset(bytes);
  return found ? found.kind : null;
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
