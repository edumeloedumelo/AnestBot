// Cadastro/login próprios — não depende do Base44. Cria o tenant em pending_payment;
// vira ativo só depois do fluxo de pagamento + provisionamento.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createTenant, getTenantByEmail } from '../tenants.js';
import { asyncHandler } from '../asyncHandler.js';

export const authRouter = Router();

function sign(tenant) {
  return jwt.sign({ tenantId: tenant.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

authRouter.post('/signup', asyncHandler(async (req, res) => {
  const { name, email, password, plan } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'nome, email e senha são obrigatórios' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'senha precisa ter ao menos 8 caracteres' });
  }
  if (await getTenantByEmail(email)) {
    return res.status(409).json({ error: 'já existe uma conta com esse email' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const tenant = await createTenant({
    name,
    email,
    passwordHash,
    plan: ['starter', 'pro', 'clinica'].includes(plan) ? plan : 'starter',
  });

  res.status(201).json({ token: sign(tenant), tenantId: tenant.id, status: tenant.status });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const tenant = await getTenantByEmail(email || '');
  if (!tenant || !(await bcrypt.compare(password || '', tenant.password_hash))) {
    return res.status(401).json({ error: 'email ou senha inválidos' });
  }
  res.json({ token: sign(tenant), tenantId: tenant.id, status: tenant.status });
}));
