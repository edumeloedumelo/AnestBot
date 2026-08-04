// Criptografia da API: senha (scrypt), tokens de sessão, HMAC de webhook e TOTP.
// Sem dependências externas — tudo do node:crypto (D-009).
import crypto from 'node:crypto';

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2] ?? '', 'base64url');
  const expected = Buffer.from(parts[3] ?? '', 'base64url');
  const actual = await scrypt(password, salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

// Tokens opacos: o valor viaja com o cliente; o banco guarda SÓ o sha256.
export function newOpaqueToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}
export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Verificação da assinatura do webhook de eventos (contrato packages/contracts):
// v1=hex(HMAC-SHA256(secret, `${timestamp}.${corpo_bruto}`)). Aceita segredo
// primário OU anterior (rotação sem downtime — D/R-11).
export function verifyEventSignature(
  rawBody: string, timestamp: string, signature: string, secrets: string[],
): boolean {
  if (!/^v1=[0-9a-f]{64}$/.test(signature)) return false;
  const provided = signature.slice(3);
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (safeEqual(provided, expected)) return true;
  }
  return false;
}

// ── TOTP (RFC 6238, SHA-1, 6 dígitos, passo 30s) para MFA ───────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31] ?? ''; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31] ?? '';
  return out;
}

function b32decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, nowMs: number = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(nowMs / 1000 / 30) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (((hmac[offset] ?? 0) & 0x7f) << 24) | (((hmac[offset + 1] ?? 0) & 0xff) << 16)
             | (((hmac[offset + 2] ?? 0) & 0xff) << 8) | ((hmac[offset + 3] ?? 0) & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// Aceita a janela ±1 passo (clock skew de celular).
export function verifyTotp(secret: string, code: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((off) => safeEqual(totpCode(secret, nowMs, off), code));
}
