# Threat Model — Fundação (Fase 1)

Escopo: identidade, auditoria, RLS/multi-tenancy, cadastros (pacientes,
procedimentos, convênios) e o pipeline. Método: STRIDE por componente, com
estado da mitigação verificado no código/testes atuais. Revisão obrigatória a
cada novo domínio (o domínio cirúrgico da Fase 2 estende esta tabela).

## Ativos protegidos

1. Dados de identificação e futuros dados clínicos de pacientes (classe mais
   sensível — LGPD art. 11).
2. Integridade da trilha de auditoria (valor probatório).
3. Credenciais e sessões de profissionais.
4. Disponibilidade do sistema no ponto de cuidado.

## Análise STRIDE

| Ameaça | Vetor | Mitigação atual | Estado |
|---|---|---|---|
| **S**poofing — login por força bruta ou credencial vazada | `/auth/login` | bcrypt (custo 12), MFA TOTP, mensagens que não revelam existência de e-mail, falhas auditadas | ⚠ Parcial: falta rate limiting e lockout progressivo (F1-E2 restante) |
| Spoofing — token forjado/roubado | JWT | Assinatura HS256 com segredo por ambiente, expiração 15 min, `JWT_SECRET` obrigatório (boot falha sem ele) | ⚠ Parcial: sem revogação de sessão nem refresh rotativo (F1-E2 restante) |
| **T**ampering — alteração de registro clínico/auditoria | SQL direto, bug de aplicação | Trigger bloqueia UPDATE/DELETE/TRUNCATE em `audit_event`; papel da app sem DELETE em tabela alguma; hash encadeado por tenant com `verifyChain()`; testes provam detecção de adulteração forçada | ✅ Testado |
| Tampering — migration alterada após aplicada | Repositório | Runner compara checksum e aborta em divergência | ✅ Testado |
| **R**epudiation — "não fui eu que fiz" | Qualquer escrita | Todo evento com ator, papel, IP, timestamp; login sucesso/falha auditados; acesso emergencial com justificativa obrigatória | ✅ Testado (leitura de prontuário ainda não auditada — entra com o domínio EHR) |
| **I**nformation disclosure — vazamento entre tenants | Consulta sem filtro | RLS `FORCE` em toda tabela de domínio; app conecta por papel **sem bypass** (superusuário proibido — defeito real encontrado e corrigido em `0004_app_role.sql`); testes de leitura e escrita cruzada | ✅ Testado |
| Information disclosure — segredos em código/logs | Repositório, logs | Segredos só por variável de ambiente; proibição em GOVERNANCE §7; logs sem dado clínico (regra) | ⚠ Parcial: adicionar varredura de segredos no CI e revisão de logs quando houver logger estruturado |
| Information disclosure — enumeração de pacientes | `/patients` busca | Endpoint autenticado; RLS por tenant | ⚠ Aceito por ora: controle por relação-com-paciente (papel × setor) chega com escalas/plantões na Fase 2 |
| **D**enial of service — exaustão por requisições | API pública | Validação de entrada estrita (whitelist), limite de 10k linhas por importação | ⚠ Parcial: rate limiting global pendente (junto com o de login) |
| **E**levation of privilege — usuário comum vira admin | `/org-units`, `/procedures/import` etc. | Guard de papéis por rota; papéis com vigência; atribuição de papel auditada | ✅ Testado (revisão periódica de acessos pendente — F1-E2) |
| EoP — IA com acesso ampliado | Serviço de IA (futuro) | Arquitetura já decidida: IA opera com permissões do usuário solicitante, sem acesso direto ao banco (ADR-007) | ✅ Por construção (validar na implementação) |

## Riscos residuais aceitos nesta fase

1. **Sem rate limiting/lockout** — aceitável apenas enquanto não há ambiente
   exposto à internet; **obrigatório antes do piloto** (entra em F1-E2).
2. **Sem revogação de sessão** — tokens de 15 min limitam a janela; revogação
   e refresh rotativo entram em F1-E2.
3. **Busca de pacientes por qualquer autenticado do tenant** — o refinamento
   papel×setor×relação depende de escalas (Fase 2); auditoria de leitura de
   prontuário entra junto com o domínio EHR.

## Ações que este threat model gera (vão ao backlog)

- F1-E2b: rate limiting no login + lockout progressivo + revogação de sessão.
- CI: varredura de segredos (gitleaks ou equivalente) no workflow.
- Fase 2: estender esta tabela para o domínio cirúrgico (ex.: adulteração de
  checklist, transição de status indevida, conflito de agendamento forjado).

Com este documento, o critério de saída da Fase 1 ("threat model da fundação
revisado") está atendido para efeito de desenvolvimento; a revisão humana
final ocorre na homologação do MVP.
