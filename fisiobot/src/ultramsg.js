import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);
const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;
const MAX_LEN = 4000;
const PDF_COMPRESS_THRESHOLD = 10 * 1024 * 1024;

export async function sendText(to, body) {
  if (!body) return;
  for (const chunk of splitMessage(body, MAX_LEN)) {
    const res = await fetch(`${BASE}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN, to, body: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) console.error('[ultramsg] send error', res.status, JSON.stringify(data));
  }
}

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
      } else { buf = line; }
    } else { buf = buf ? buf + '\n' + line : line; }
  }
  if (buf) out.push(buf);
  return out;
}

async function compressPdf(buffer) {
  const id = randomBytes(8).toString('hex');
  const inPath = `${tmpdir()}/pdf-in-${id}.pdf`;
  const outPath = `${tmpdir()}/pdf-out-${id}.pdf`;
  try {
    await writeFile(inPath, Buffer.from(buffer));
    await execFileAsync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${outPath}`, inPath]);
    const compressed = await readFile(outPath);
    console.error(`[pdf] comprimido: ${buffer.byteLength} → ${compressed.length} bytes`);
    return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

export async function downloadMediaBlock(url, isLink = false) {
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  console.error(`[media] url=${url.substring(0, 80)} status=${res.status} content-type=${contentType}`);
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  if (contentType.includes('text/html')) {
    throw new Error('Arquivo enviado como link externo (Drive, Acrobat etc.) — sem acesso. Envie o arquivo diretamente pelo WhatsApp.');
  }

  let buffer = await res.arrayBuffer();
  let bytes = new Uint8Array(buffer);
  if (bytes.length === 0) throw new Error('arquivo vazio');

  let kind = sniffType(bytes);
  if (!kind) {
    if (contentType.includes('pdf')) kind = 'pdf';
    else if (contentType.startsWith('image/')) {
      kind = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : contentType.includes('gif') ? 'image/gif' : 'image/jpeg';
    }
  }
  console.error(`[media] size=${bytes.length} kind=${kind}`);

  if (kind === 'pdf') {
    if (sniffType(bytes) !== 'pdf') throw new Error('rotulado como PDF mas conteúdo inválido');
    if (bytes.length > PDF_COMPRESS_THRESHOLD) {
      try { buffer = await compressPdf(buffer); bytes = new Uint8Array(buffer); }
      catch (e) { console.error('[pdf] compressão falhou, usando original:', e.message); }
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bufferToBase64(buffer) } };
  }
  if (kind) return { type: 'image', source: { type: 'base64', media_type: kind, data: bufferToBase64(buffer) } };

  const textContent = new TextDecoder().decode(buffer).substring(0, 10000);
  if (/[\x20-\x7E]/.test(textContent) && !/[\x00-\x08]/.test(textContent.substring(0, 200))) {
    return { type: 'text', text: `### ARQUIVO ENVIADO\n${textContent}` };
  }
  throw new Error('formato de arquivo não suportado');
}

function sniffType(bytes) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}
