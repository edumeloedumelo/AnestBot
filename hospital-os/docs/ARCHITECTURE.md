# Arquitetura Técnica — Hospital OS

Estado: proposta de Fase 0, sujeita a homologação. Toda escolha traz
justificativa; nada foi escolhido "por modernidade".

## 1. Decisão estrutural central

**Monólito modular com limites de domínio explícitos**, em monorepo, com
extração de serviços apenas mediante justificativa concreta (ADR-004).

Justificativa: time pequeno, domínio ainda em descoberta, e o custo dominante
de sistemas hospitalares é consistência transacional entre domínios (agendar
cirurgia toca paciente + sala + equipe + materiais). Microserviços prematuros
transformariam cada regra de negócio em problema distribuído.

Candidatos naturais a extração futura (quando houver motivo medido):
- gateway de integrações (HL7/FHIR/dispositivos) — isolamento de falha;
- ingestão de sinais vitais de monitores — volume e perfil de escrita distintos;
- serviços de IA — dependências pesadas e escala independente (já nasce como
  serviço separado, ver §5).

## 2. Stack de referência

| Camada | Escolha | Justificativa |
|---|---|---|
| Frontend web | TypeScript + React + Next.js | Ecossistema maduro, SSR para telas densas, time já domina React (AnestBot) |
| Design system | Próprio, sobre Radix UI + Tailwind | Já usado no AnestBot; acessibilidade nativa dos primitives Radix |
| Mobile/tablet | PWA primeiro; app nativo só se hardware exigir (câmera de código de barras, offline profundo) | Evita duplicar frontend antes de validar produto |
| Backend | TypeScript + NestJS (monólito modular) | Módulos NestJS mapeiam 1:1 com bounded contexts; DI facilita teste; mesma linguagem do frontend reduz custo cognitivo |
| Serviços de IA | Python + FastAPI (serviço separado desde o início) | Ecossistema de IA é Python; isola dependências pesadas do núcleo clínico |
| Banco principal | PostgreSQL | Transacional, JSONB para formulários clínicos versionados, RLS para multi-tenancy, ecossistema de replicação maduro |
| Cache/filas leves | Redis | Sessões, locks de agendamento, pub/sub de tempo real |
| Mensageria | Começar com filas transacionais no próprio Postgres (outbox pattern); RabbitMQ/Kafka só quando volume justificar | Evitar infraestrutura distribuída sem demanda medida |
| Objetos | Armazenamento compatível com S3 | Exames anexados, documentos, PDFs assinados |
| Busca | Postgres full-text primeiro; OpenSearch quando necessidade comprovada | Mesma filosofia anti-prematura |
| Tempo real | WebSocket (mapa cirúrgico, ficha anestésica) via gateway NestJS | Requisito central do mapa em tempo real |
| Infra | Containers + IaC (Terraform) + CI/CD (GitHub Actions) | Padrão de mercado, reprodutível |
| Observabilidade | OpenTelemetry (logs estruturados, métricas, traces) desde a Fase 1 | Princípio 11: aplicação observável |

## 3. Multi-tenancy

Decisão pendente (D-01) com recomendação: **banco único com Row-Level Security
por `tenant_id` + isolamento lógico por organização**, migrando clientes de
grande porte para instância dedicada quando contrato exigir. Alternativa
(schema-per-tenant) aumenta custo operacional de migrations sem benefício
proporcional no estágio atual.

## 4. Padrões transversais obrigatórios

1. **Auditoria imutável**: toda escrita clínica gera evento em trilha
   append-only (tabela particionada, sem UPDATE/DELETE concedidos ao papel da
   aplicação; correções são novos registros com referência ao anterior).
   Detalhes em DATA_MODEL.md §4.
2. **Versionamento de registros clínicos**: documentos clínicos nunca são
   sobrescritos; nova versão + diff rastreável + autor + justificativa.
3. **Outbox pattern** para eventos entre domínios: consistência transacional
   entre escrita de negócio e publicação de evento.
4. **Idempotência** em todas as integrações de entrada (chave de idempotência
   obrigatória no gateway).
5. **Feature flags** por tenant para liberação gradual de módulos.
6. **API-first**: contratos OpenAPI versionados em `packages/contracts`;
   frontend consome tipos gerados.
7. **Degradação graciosa**: cada integração externa tem circuit breaker e modo
   de contingência definido no seu artefato de especificação (princípio 13).

## 5. Arquitetura de IA assistiva

- Serviço separado (`apps/ai`), sem acesso direto ao banco clínico: consome
  APIs internas com as permissões do usuário solicitante (a IA nunca vê o que o
  usuário não pode ver).
- Toda resposta carrega: fontes citadas, grau de incerteza, disclaimer de
  sugestão, e é registrada na trilha de auditoria (`ai_interaction`).
- Ações sugeridas pela IA entram em estado `proposed` e só se materializam com
  confirmação humana explícita (evento auditado com o humano como autor).
- Nenhum modelo é treinado com dados de pacientes sem base legal e anonimização
  validada pelo agente de Compliance.

## 6. Interoperabilidade

Gateway de integrações como módulo isolado desde a Fase 1 (base), expandindo por demanda:

| Padrão | Uso | Quando |
|---|---|---|
| FHIR R4 | Modelo canônico de troca; API FHIR para leitura de recursos-chave (Patient, Encounter, Procedure) | Fase 2 (leitura) |
| HL7 v2 (MLLP) | Integração com LIS/RIS legados | Fase 3 |
| TISS/TUSS | Autorização e faturamento com operadoras | Fase 2 (autorização) / Fase 4 (faturamento) |
| DICOM/PACS | Visualização de imagem via visualizador do PACS (não construir PACS) | Fase 3 |
| Dispositivos (monitores, estações de anestesia) | Gateway dedicado, protocolos por fabricante; dados chegam como *stream anexado* à ficha, nunca sobrescrevem registro manual silenciosamente | Fase 3+ (piloto controlado) |

Toda integração: autenticação própria, logs, retentativas com backoff, fila de
falhas (DLQ), reconciliação periódica, versionamento de conector, monitoramento.

## 7. Estrutura de monorepo proposta

Conforme prompt mestre §21, a validar antes da criação (Fase 1):

```
hospital-os/
├── apps/
│   ├── web/          # Next.js
│   ├── api/          # NestJS (monólito modular)
│   ├── ai/           # FastAPI (serviços de IA)
│   └── worker/       # jobs assíncronos (mesma base do api)
├── packages/
│   ├── ui/           # design system
│   ├── contracts/    # OpenAPI + tipos gerados + eventos
│   ├── database/     # schema, migrations, seeds sintéticos
│   ├── audit/        # SDK de auditoria
│   └── integrations/ # conectores versionados
├── domains/          # documentação e regras por bounded context
├── docs/
├── tests/            # e2e e carga
├── infrastructure/   # IaC
└── scripts/
```

Ajuste em relação ao prompt: `apps/mobile` sai da estrutura inicial (PWA
primeiro, ADR-005); `packages/auth`, `clinical-core`, `observability` nascem
como módulos internos do `api` e só viram pacotes quando reutilizados por mais
de um app.

## 8. Ambientes

`dev` → `staging` (dados 100% sintéticos) → `homolog` (validação humana formal)
→ `prod`. Nenhum dado real de paciente fora de `prod`. Backups testados por
restauração automática mensal; RPO/RTO definidos por contrato na Fase 1.
