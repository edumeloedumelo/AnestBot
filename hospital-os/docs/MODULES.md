# Mapa de Módulos e Domínios — Hospital OS

## 1. Domínios de negócio (bounded contexts)

O sistema é organizado em domínios com limites explícitos. Cada domínio possui
seu próprio modelo de dados, regras e API interna; comunicação entre domínios
ocorre por contratos versionados e eventos.

| Domínio | Responsabilidade | Fase |
|---|---|---|
| `identity` | Autenticação, MFA, perfis, papéis, sessões, acesso emergencial | 1 |
| `organization` | Instituições, unidades, setores, salas, leitos | 1 |
| `audit` | Trilha de auditoria imutável (transversal, append-only) | 1 |
| `master-data` | Cadastros mestres: procedimentos, códigos (TUSS/CBHPM/CID), materiais, medicamentos, convênios | 1 |
| `patients` | Cadastro de paciente, identificação segura, deduplicação | 1 |
| `scheduling` | Agendas, agendamento cirúrgico, bloqueios | 2 |
| `surgery` | Mapa cirúrgico, jornada perioperatória, checklist de cirurgia segura | 2 |
| `anesthesia` | Avaliação pré-anestésica, ficha anestésica, RPA (recuperação) | 2 |
| `ehr` | Prontuário longitudinal, evoluções, documentos, consentimentos | 2 (básico) → 3 |
| `analytics` | Indicadores, relatórios, dashboards, dicionário de indicadores | 2 (básico) → 4 |
| `prescription` | Prescrição eletrônica, validação farmacêutica, checagem | 3 |
| `nursing` | SAE, checagem beira-leito, escalas de risco, balanço hídrico | 3 |
| `pharmacy` | Farmácia hospitalar, dispensação, rastreabilidade | 3 |
| `diagnostics` | Pedidos e resultados de exames (lab, imagem), integração LIS/RIS/PACS | 3 |
| `emergency` | Urgência/emergência, classificação de risco | 3 |
| `admissions` | Internação, gestão de leitos, transferências, alta | 3 |
| `icu` | Terapia intensiva | 3 |
| `billing` | Faturamento TISS/SUS, contas, glosas, auditoria de contas | 4 |
| `finance` | Financeiro, custos, controladoria | 4 |
| `supply` | Compras, estoque, OPME, patrimônio, CME | 4 |
| `hr` | RH, escalas de profissionais, credenciamento | 4 |
| `quality` | Qualidade, segurança do paciente, notificações de eventos adversos, SCIH | 4 |
| `patient-portal` | Portal e app do paciente | 4 |
| `ai-assist` | Serviços de IA assistiva (transversal, com governança própria) | 2 (triagem pré-op) → 5 |
| `integrations` | Gateway FHIR/HL7/TISS, conectores, filas, reconciliação | 1 (base) → contínuo |

## 2. Dependências entre domínios (ordem de construção)

```
identity ─┬─► organization ─┬─► patients ──► scheduling ──► surgery ──► anesthesia
          │                 │                                  │
audit ────┘ (transversal)   └─► master-data ───────────────────┤
                                                               ▼
                                          ehr (básico) ◄── analytics (básico)
                                                               │
Fase 3: prescription ◄── pharmacy        emergency  admissions │ diagnostics
        (dependem de master-data medicamentos + ehr + nursing) ▼
Fase 4: billing ◄── supply, finance, hr, quality      (dependem de consumo
                                                       fechado em surgery)
```

Regras de dependência que travam o roadmap:

1. **Nada existe sem `identity` + `audit` + `organization`** — são pré-requisito
   de qualquer tela.
2. **`surgery` depende de `master-data`** (procedimentos, equipes) e
   **`patients`** — não há mapa cirúrgico sem cadastro confiável.
3. **`prescription` depende de base de medicamentos estruturada e de fonte de
   conhecimento de interações** (decisão pendente D-07) — por isso está na
   Fase 3, não no MVP.
4. **`billing` depende de consumo fechado** no perioperatório — faturar antes de
   registrar consumo corretamente gera glosa, não receita.

## 3. Inventário de módulos funcionais

Visão por módulo de produto (o que o usuário compra/usa), mapeado a domínios:

### Fase 2 — MVP clínico-cirúrgico
- Dashboard operacional do centro cirúrgico
- Cadastro do paciente com deduplicação
- Agendamento cirúrgico com bloqueio de itens críticos incompletos
- Mapa cirúrgico inteligente (dia/semana/sala, drag-and-drop, status em tempo real)
- Jornada perioperatória com rastreio de status
- Checklist de cirurgia segura (Sign In / Time Out / Sign Out)
- Avaliação pré-anestésica (evolução do AnestBot: triagem de exames assistida por IA)
- Ficha anestésica digital (linha temporal, registro rápido)
- Recuperação pós-anestésica (escalas, critérios de alta)
- Relatórios do centro cirúrgico e indicadores anestésicos básicos

### Fase 3 — Expansão assistencial
- Prontuário longitudinal completo (timeline)
- Prescrição eletrônica + validação farmacêutica + checagem de enfermagem
- Farmácia e dispensação
- Pedidos/resultados de exames, integração laboratório e imagem
- Urgência/emergência com classificação de risco
- Internação e gestão de leitos
- UTI

### Fase 4 — Gestão completa
- Faturamento TISS/SUS, glosas, auditoria
- Financeiro, custos, compras, estoque, OPME, CME
- RH e escalas
- Qualidade, eventos adversos, SCIH
- Portal do paciente
- BI executivo

### Fase 5 — Inteligência e automação
- Resumo de prontuário, busca em linguagem natural
- Previsão de duração cirúrgica, atraso e ocupação
- Sugestão de encaixe e otimização de mapa
- Apoio à codificação e ao faturamento
- Detecção de inconsistências e campos ausentes em escala

### Planejados, sem fase comprometida
Maternidade, pediatria, oncologia, hemodiálise, endoscopia, hemodinâmica,
anatomia patológica, hemoterapia, nutrição, fisioterapia, ouvidoria, hotelaria,
higienização, transporte, engenharia clínica, manutenção, contratos,
credenciamento, treinamento. Cada um só entra no roadmap com caso de negócio e
os 20 artefatos obrigatórios (GOVERNANCE.md §4).
