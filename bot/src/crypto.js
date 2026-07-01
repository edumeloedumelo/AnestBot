// Mesmo esquema do backend/src/crypto.js (AES-256-GCM) — precisa da MESMA
// TOKEN_ENCRYPTION_KEY nos dois serviços pra conseguir decifrar o que o backend
// gravou durante o Embedded Signup.
import crypto from 'crypto';

const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'base64');

export function decryptToken(payload) {
  if (KEY.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY ausente ou inválida (precisa de 32 bytes em base64)');
  }
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}
