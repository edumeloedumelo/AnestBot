# Registro de Decisões — Hospital OS

Formato: ADRs (decisões tomadas, reversíveis apenas com novo ADR) e Decisões
pendentes (bloqueadoras ou não), numeradas D-xx.

## ADRs — decisões tomadas na Fase 0

### ADR-001 · Entrada de mercado pelo perioperatório
Contexto: o prompt mestre pede um HIS completo; construir tudo é o maior risco
do projeto (R-01). Decisão: o MVP é o perioperatório (centro cirúrgico +
anestesia), vendável de forma independente a centros cirúrgicos e grupos de
anestesia, coexistindo com o HIS do cliente. Consequência: prescrição,
internação, faturamento ficam nas fases 3–4; a arquitetura mantém os domínios
preparados para expansão.

### ADR-002 · AnestBot preservado como ativo, não como base de código
Contexto: o repositório contém o AnestBot (Base44 + React), app real de
triagem pré-anestésica com IA. Decisão: o AnestBot **não é alterado** e
continua operando; seu fluxo clínico e aprendizado de produto são o insumo do
módulo de avaliação pré-anestésica (F2-E5), que será reimplementado na
plataforma nova. Consequência: nenhum código do Hospital OS depende do SDK
Base44; migração dos usuários do AnestBot planejada ao fim da Fase 2.

### ADR-003 · Stack: NestJS + Next.js + PostgreSQL + FastAPI para IA
Justificativas em ARCHITECTURE.md §2. Consequência: monorepo TypeScript com um
serviço Python isolado.

### ADR-004 · Monólito modular; microserviços somente com motivo medido
Justificativa em ARCHITECTURE.md §1. Candidatos a extração listados lá.

### ADR-005 · PWA antes de app nativo
Contexto: tablets no centro cirúrgico e celulares de plantão. Decisão: web
responsiva + PWA no MVP; app nativo só se um requisito de hardware/offline
comprovado exigir. Consequência: `apps/mobile` sai da estrutura inicial.

### ADR-006 · Trilha de auditoria como fundação (Fase 1), não como módulo tardio
Contexto: princípios 2 e 6. Decisão: nenhum domínio clínico é implementado
antes do SDK de auditoria existir. Consequência: épico F1-E3 precede todo o MVP.

### ADR-007 · IA sem acesso direto ao banco; permissões do usuário solicitante
Justificativa em ARCHITECTURE.md §5 e SECURITY.md §6.

### ADR-008 · Alinhamento conceitual a FHIR sem FHIR-nativo
Contexto: FHIR server como banco primário adiciona complexidade sem ganho no
MVP. Decisão: modelo próprio alinhado semanticamente a recursos FHIR
(Patient, Encounter, Procedure), com camada de exposição FHIR no gateway.
Consequência: interoperabilidade barata depois, produtividade agora.

### ADR-009 · Multi-tenancy: banco único com Row-Level Security (resolve D-01)
Homologado em 2026-08-03 junto com a Fase 0. Decisão: banco único, coluna
`tenant_id` em toda tabela de domínio, políticas RLS com
`current_setting('app.tenant_id')` definida por transação pela aplicação;
instância dedicada apenas quando contrato de grande porte exigir.
Consequência: migrations únicas, RLS testada em CI desde a Fase 1.

### ADR-010 · Hospedagem em hyperscaler com região Brasil (resolve D-03)
Homologado em 2026-08-03. Diretriz: qualquer hyperscaler com região São Paulo,
dados em repouso no Brasil. O provedor específico será fixado no contrato do
piloto (depende de D-02); a infraestrutura como código permanece agnóstica.

### Registro de homologação — Fase 0
Em 2026-08-03 o responsável humano aprovou os artefatos de Fase 0 e o
protótipo navegável ("Tudo aprovado"), autorizando o início da Fase 1.

## Decisões pendentes (exigem resposta humana)

### Bloqueiam o piloto (não bloqueiam o código da Fundação)
- **D-02 · Instituição-piloto**: qual centro cirúrgico/hospital parceiro para o
  MVP? Sem piloto real definido, requisitos de convênio, escala e fluxo ficam
  hipotéticos. *(Continua sendo a decisão mais importante do projeto.)*
- **D-06 · Capacidade real de execução**: quem homologa (humanos), qual ritmo,
  qual orçamento de infraestrutura/licenças? Define calibragem de prazos do
  roadmap.

### Importantes, não bloqueiam a Fase 1
- **D-04 · Assinatura digital**: fornecedor de assinatura em nuvem ICP-Brasil
  (ex.: certificado A3 em nuvem) e meta de certificação SBIS NGS2 — necessário
  antes de prometer eliminação de papel (R-03).
- **D-05 · Marca/nome definitivo**: "Hospital OS" é provisório.
- **D-07 · Base de conhecimento farmacológico**: fornecedor a licenciar
  (pré-requisito da prescrição, Fase 3). Iniciar conversa durante a Fase 2.
- **D-08 · Modelo comercial**: SaaS por sala cirúrgica/mês? Por cirurgia? Por
  leito? Afeta métricas de produto e tenancy.
- **D-09 · Idioma e internacionalização**: pt-BR apenas no MVP (recomendado) ou
  arquitetura i18n desde já? Recomendação: strings externalizadas desde o
  início, sem tradução ativa.

## Como registrar novas decisões
Toda decisão arquitetural ou de escopo relevante vira ADR aqui, com contexto,
decisão e consequência. Decisões clínicas de produto citam o agente clínico
revisor e a evidência/norma de referência.
