# Roadmap — Hospital OS

Fases sequenciais com critérios de saída. Prazos serão calibrados após a
homologação da Fase 0 e definição de capacidade real de execução (D-06).

## Fase 0 — Descoberta ✦ EM ANDAMENTO

**Entregas**: visão, escopo, personas, mapa de módulos, domínios, dependências,
arquitetura inicial, estratégias (segurança, dados, interoperabilidade),
roadmap, MVP, backlog, riscos, decisões pendentes — este conjunto de documentos.

**Critério de saída**: homologação humana dos artefatos + resposta às decisões
bloqueadoras D-01, D-02, D-03 e D-06 (DECISIONS.md).

## Fase 1 — Fundação

**Escopo**: monorepo e CI/CD; identidade (auth, MFA, RBAC contextual, acesso
emergencial); organizações/unidades/setores/salas; trilha de auditoria imutável;
design system (tokens, componentes críticos, densidade clínica); observabilidade
(logs estruturados, métricas, traces); cadastros mestres mínimos (procedimentos
TUSS/CBHPM, convênios, equipes); cadastro de paciente com deduplicação; base do
gateway de integrações; ambientes dev/staging/homolog.

**Critério de saída**: usuário real autentica com MFA, cadastra paciente sem
duplicidade, toda ação aparece na trilha de auditoria imutável, pipeline com
testes e varredura de segurança verde, threat model da fundação revisado.

## Fase 2 — MVP clínico-cirúrgico (perioperatório)

**Escopo** (detalhe no BACKLOG.md):
1. Agendamento cirúrgico com bloqueio de itens críticos incompletos.
2. Mapa cirúrgico inteligente (dia/semana/sala, drag-and-drop com lock, status
   em tempo real, alertas de conflito).
3. Jornada perioperatória com linha de status.
4. Checklist de cirurgia segura (Sign In / Time Out / Sign Out) com registro
   por confirmação.
5. Avaliação pré-anestésica — evolução do fluxo do AnestBot (triagem de exames
   assistida por IA com validação humana) para dentro da plataforma.
6. Ficha anestésica digital (linha temporal, registro ≤2 toques, eventos
   parametrizados; sem integração de monitores nesta fase).
7. Recuperação pós-anestésica (Aldrete, critérios de alta, intercorrências).
8. Relatórios do centro cirúrgico + indicadores anestésicos básicos com
   dicionário de indicadores.
9. Dashboard operacional do dia.

**Critério de saída**: piloto em 1 instituição parceira (D-02) operando o ciclo
completo solicitação → agendamento → checklist → ficha → RPA → relatório, com
adesão >90% e sem incidente crítico de segurança/segurança clínica; homologação
formal do piloto.

## Fase 3 — Expansão assistencial

Prescrição eletrônica (pré-requisito: base de medicamentos licenciada, D-07) →
validação farmacêutica → checagem de enfermagem; prontuário longitudinal
completo; pedidos/resultados de exames (integração LIS/RIS); farmácia;
internação e leitos; urgência/emergência com classificação de risco; UTI;
integração com monitores em piloto controlado.

**Critério de saída**: um hospital opera internação + prescrição + farmácia no
sistema com segurança validada por agente clínico e farmacêutico independentes.

## Fase 4 — Gestão completa

Faturamento TISS e SUS, glosas, auditoria de contas; financeiro, custos;
compras, estoque, OPME, CME; RH e escalas; qualidade, eventos adversos, SCIH;
portal do paciente; BI executivo.

**Critério de saída**: ciclo receita completo (atendimento → conta → envio TISS
→ gestão de glosa) auditável de ponta a ponta.

## Fase 5 — Inteligência e automação

Resumo de prontuário; busca em linguagem natural; previsões (duração, atraso,
ocupação, demanda); sugestão de encaixe e escala; apoio à codificação;
detecção de inconsistências em escala; automações com confirmação humana.

**Critério de saída por funcionalidade de IA**: avaliação de acurácia
documentada, auditoria funcionando, kill switch testado, aprovação do Diretor
Médico simulado + homologação humana.

## Regras do roadmap

- Não iniciar fase sem critério de saída da anterior cumprido.
- Módulos "planejados sem fase" (MODULES.md) só entram com caso de negócio
  aprovado pelo Diretor Executivo.
- Todo desvio de roadmap é registrado em DECISIONS.md.
