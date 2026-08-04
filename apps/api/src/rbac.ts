// Matriz EXPLÍCITA de permissões por papel (seção 11 do prompt-mestre).
// A secretaria acessa apenas o operacional: lista/status/pendências/contatos —
// NUNCA anamnese, parecer ou análises (campos clínicos).
export type Role = 'owner' | 'admin' | 'anesthesiologist' | 'secretary' | 'viewer';

export type Permission =
  | 'team:manage'          // renomear equipe, papéis, remover membros
  | 'invite:create'
  | 'pairing:manage'       // vincular grupo WhatsApp ao tenant
  | 'patient:read'
  | 'patient:write'
  | 'case:read'            // metadados operacionais do caso
  | 'case:read_clinical'   // anamnese, parecer, análises
  | 'case:manage_pending'  // criar/resolver pendências
  | 'case:review'          // revisão médica (exige CRM no perfil)
  | 'case:override'        // decisão por cima do parecer (exige CRM + motivo)
  | 'record:read'          // prontuário anestésico (conteúdo clínico)
  | 'record:write'         // criar/editar rascunho, eventos, vitais, templates
  | 'record:sign'          // assinar (exige CRM) e adendar
  | 'billing:read'         // produção, entradas, relatórios
  | 'billing:write'        // importar terminologia, convênios, entradas, eventos
  | 'audit:read';

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    'team:manage', 'invite:create', 'pairing:manage', 'patient:read', 'patient:write',
    'case:read', 'case:read_clinical', 'case:manage_pending', 'case:review', 'case:override',
    'record:read', 'record:write', 'record:sign', 'billing:read', 'billing:write', 'audit:read',
  ]),
  admin: new Set<Permission>([
    'team:manage', 'invite:create', 'pairing:manage', 'patient:read', 'patient:write',
    'case:read', 'case:read_clinical', 'case:manage_pending', 'record:read',
    'billing:read', 'billing:write', 'audit:read',
  ]),
  anesthesiologist: new Set<Permission>([
    'patient:read', 'patient:write', 'case:read', 'case:read_clinical',
    'case:manage_pending', 'case:review', 'case:override',
    'record:read', 'record:write', 'record:sign', 'billing:read',
  ]),
  // Secretaria FAZ o faturamento (operacional, não clínico) — mas não vê prontuário.
  secretary: new Set<Permission>([
    'patient:read', 'patient:write', 'case:read', 'case:manage_pending',
    'billing:read', 'billing:write',
  ]),
  viewer: new Set<Permission>([
    'patient:read', 'case:read', 'case:read_clinical', 'record:read',
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false; // papel desconhecido ⇒ NEGA
}

export const ALL_ROLES: readonly Role[] = ['owner', 'admin', 'anesthesiologist', 'secretary', 'viewer'];
