// Criptografia simétrica (AES-256-GCM) pro token do provedor de WhatsApp em repouso no banco.
import crypto from 'crypto';

const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'base64');

function assertKey() {
  if (KEY.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY ausente ou inválida (precisa de 32 bytes em base64)');
  }
}

export function encryptToken(plainText) {
  assertKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(payload) {
  assertKey();
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}
