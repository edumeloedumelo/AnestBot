// Validação de entrada por JSON Schema (Ajv). Toda rota que aceita corpo
// valida ANTES de tocar o banco; erro de schema é 400 com detalhes seguros.
import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsImport from 'ajv-formats';
import type { Request, Response, NextFunction } from 'express';

// Interop CJS↔ESM sob NodeNext: ajv-formats expõe a função em .default no ESM.
type AddFormats = (ajv: Ajv) => Ajv;
const addFormats: AddFormats =
  (addFormatsImport as unknown as { default?: AddFormats }).default ?? (addFormatsImport as unknown as AddFormats);

const ajv = new Ajv({ allErrors: false, removeAdditional: false, coerceTypes: false });
addFormats(ajv);

export function compile<T>(schema: object): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

export function validateBody<T>(validator: ValidateFunction<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!validator(req.body)) {
      const err = validator.errors?.[0];
      res.status(400).json({ error: 'corpo inválido', detail: `${err?.instancePath || '/'} ${err?.message || ''}`.trim() });
      return;
    }
    next();
  };
}

// ── Schemas de requisição ───────────────────────────────────────────────────
export interface RegisterBody { email: string; password: string; full_name: string; team_name: string; crm?: string }
export const registerSchema = compile<RegisterBody>({
  type: 'object', additionalProperties: false,
  required: ['email', 'password', 'full_name', 'team_name'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 10, maxLength: 200 },
    full_name: { type: 'string', minLength: 2, maxLength: 120 },
    team_name: { type: 'string', minLength: 2, maxLength: 120 },
    crm: { type: 'string', minLength: 4, maxLength: 20 },
  },
});

export interface LoginBody { email: string; password: string; totp?: string }
export const loginSchema = compile<LoginBody>({
  type: 'object', additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
    totp: { type: 'string', pattern: '^[0-9]{6}$' },
  },
});

export interface InviteBody { email: string; role: 'admin' | 'anesthesiologist' | 'secretary' | 'viewer' }
export const inviteSchema = compile<InviteBody>({
  type: 'object', additionalProperties: false,
  required: ['email', 'role'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    role: { type: 'string', enum: ['admin', 'anesthesiologist', 'secretary', 'viewer'] },
  },
});

export interface AcceptInviteBody { token: string; password?: string; full_name?: string; crm?: string }
export const acceptInviteSchema = compile<AcceptInviteBody>({
  type: 'object', additionalProperties: false,
  required: ['token'],
  properties: {
    token: { type: 'string', minLength: 10, maxLength: 200 },
    password: { type: 'string', minLength: 10, maxLength: 200 },
    full_name: { type: 'string', minLength: 2, maxLength: 120 },
    crm: { type: 'string', minLength: 4, maxLength: 20 },
  },
});

export interface PairingBody { chat_ref: string; label?: string }
export const pairingSchema = compile<PairingBody>({
  type: 'object', additionalProperties: false,
  required: ['chat_ref'],
  properties: {
    chat_ref: { type: 'string', minLength: 3, maxLength: 128 },
    label: { type: 'string', maxLength: 120 },
  },
});

export interface PatientBody { full_name: string; birth_date?: string; phone?: string; insurer?: string }
export const patientSchema = compile<PatientBody>({
  type: 'object', additionalProperties: false,
  required: ['full_name'],
  properties: {
    full_name: { type: 'string', minLength: 2, maxLength: 160 },
    birth_date: { type: 'string', format: 'date' },
    phone: { type: 'string', maxLength: 30 },
    insurer: { type: 'string', maxLength: 120 },
  },
});

export interface ReviewBody { decision: 'approved' | 'blocked' | 'needs_items'; note?: string }
export const reviewSchema = compile<ReviewBody>({
  type: 'object', additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', enum: ['approved', 'blocked', 'needs_items'] },
    note: { type: 'string', maxLength: 2000 },
  },
});

export interface OverrideBody { decision: 'approved' | 'blocked'; reason: string }
export const overrideSchema = compile<OverrideBody>({
  type: 'object', additionalProperties: false,
  required: ['decision', 'reason'],
  properties: {
    decision: { type: 'string', enum: ['approved', 'blocked'] },
    reason: { type: 'string', minLength: 5, maxLength: 2000 },
  },
});

export interface PendingItemBody { description: string }
export const pendingItemSchema = compile<PendingItemBody>({
  type: 'object', additionalProperties: false,
  required: ['description'],
  properties: { description: { type: 'string', minLength: 1, maxLength: 500 } },
});

// Envelope de evento (espelha packages/contracts/event-envelope.schema.json).
export interface EventEnvelope {
  event_id: string; event_type: string; schema_version: number; occurred_at: string;
  source: string; correlation_id: string; chat_ref: string; payload: Record<string, unknown>;
}
export const envelopeSchema = compile<EventEnvelope>({
  type: 'object', additionalProperties: false,
  required: ['event_id', 'event_type', 'schema_version', 'occurred_at', 'source', 'correlation_id', 'chat_ref', 'payload'],
  properties: {
    event_id: { type: 'string', format: 'uuid' },
    event_type: { type: 'string', pattern: '^[a-z_]+(\\.[a-z_]+)*\\.v[0-9]+$' },
    schema_version: { type: 'integer', const: 1 },
    occurred_at: { type: 'string', format: 'date-time' },
    source: { type: 'string', enum: ['anestbot2', 'platform'] },
    correlation_id: { type: 'string', minLength: 1, maxLength: 128 },
    chat_ref: { type: 'string', minLength: 1, maxLength: 128 },
    payload: { type: 'object' },
  },
});
