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
        // linha gigante: corta no braço
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
// Usa /ebook (150 dpi) — boa legibilidade para laudos, tamanho reduzido.
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
    // Retorna como ArrayBuffer
    return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// Baixa a mídia (imagem/pdf) de uma URL e devolve bloco pronto p/ Claude.
// Detecta o tipo REAL pelos magic bytes — o content-type/URL do UltraMsg às vezes
// mente (ex: arquivo .pdf que na verdade é imagem, ou download que retornou erro).
export async function downloadMediaBlock(url) {
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  console.error(`[media] url=${url.substring(0, 80)} status=${res.status} content-type=${contentType}`);
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  let buffer = await res.arrayBuffer();
  let bytes = new Uint8Array(buffer);

  if (bytes.length === 0) throw new Error('arquivo vazio');

  const magic = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2,'0')).join(' ');
  // 1ª escolha: magic bytes (confiável). 2ª escolha: content-type do servidor.
  let kind = sniffType(bytes);
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
    // Só envia como PDF se realmente começar com %PDF (Claude valida isso).
    if (sniffType(bytes) === 'pdf') {
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
    throw new Error('rotulado como PDF mas conteúdo inválido');
  }
  if (kind) {
    // kind é o media_type da imagem (image/jpeg, image/png, etc.)
    return { type: 'image', source: { type: 'base64', media_type: kind, data: bufferToBase64(buffer) } };
  }

  // Tipo não reconhecido: tenta como texto se for legível, senão descarta.
  const textContent = new TextDecoder().decode(buffer).substring(0, 10000);
  if (/[\x20-\x7E]/.test(textContent) && !/[\x00-\x08]/.test(textContent.substring(0, 200))) {
    return { type: 'text', text: `### ARQUIVO ENVIADO\n${textContent}` };
  }
  throw new Error('formato de arquivo não suportado/ilegível');
}

// Identifica o tipo pelos primeiros bytes. Retorna 'pdf', um media_type de imagem, ou null.
function sniffType(bytes) {
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  // WEBP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
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
