import jwt from 'jsonwebtoken';
import { getTenant } from '../tenants.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'auth_required' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.tenantId = payload.tenantId;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

export async function requireOwner(req, res, next) {
  try {
    const tenant = await getTenant(req.tenantId);
    if (!tenant?.is_owner) return res.status(403).json({ error: 'forbidden' });
    req.tenant = tenant;
    next();
  } catch (e) {
    next(e);
  }
}
