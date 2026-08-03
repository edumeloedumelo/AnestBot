# Estratégia de Dados — Hospital OS

Modelo conceitual de Fase 0. O modelo físico (migrations) será produzido na
Fase 1, domínio a domínio, com revisão independente.

## 1. Princípios de dados

1. **Nada clínico é apagado ou sobrescrito.** Correção = nova versão com autor,
   timestamp e justificativa. `DELETE` físico não existe para dados clínicos;
   apenas anulação lógica auditada (`entered-in-error`, semântica FHIR).
2. **Dado estruturado por padrão, texto livre como complemento** — nunca o
   contrário. Todo campo estruturado tem terminologia de referência declarada.
3. **Proveniência obrigatória**: todo registro clínico sabe quem, quando, onde
   (dispositivo/estação), em qual papel, e por qual via (manual, importado,
   dispositivo, sugestão de IA confirmada).
4. **Separação identidade × dado clínico**: dados demográficos identificadores
   vivem em tabelas próprias, permitindo pseudonimização para analytics e
   atendimento à LGPD.
5. **Nenhum dado real em desenvolvimento**: seeds e fixtures 100% sintéticos,
   gerados por script versionado.

## 2. Modelo conceitual do núcleo (MVP)

Entidades centrais e relações (alinhadas a recursos FHIR quando existir
correspondência, para baratear interoperabilidade futura):

```
Organization ──< OrgUnit (unidade) ──< Sector ──< Room (sala cirúrgica) / Bed
User ──< RoleAssignment (papel × unidade × vigência)
Patient (FHIR Patient) ──< PatientIdentifier (CPF, CNS, prontuário, convênio)
Patient ──< Encounter (FHIR Encounter: ambulatorial, cirúrgico, internação)

SurgeryRequest (solicitação) ──► Authorization (convênio/TISS)
SurgeryRequest ──► SurgeryCase (caso cirúrgico agendado)
SurgeryCase ──< CaseProcedure (procedimento + código TUSS/CBHPM + lateralidade)
SurgeryCase ──< CaseTeamMember (cirurgião, anestesiologista, instrumentador...)
SurgeryCase ──< CaseResource (sala, equipamento, OPME, hemocomponente, leito/UTI)
SurgeryCase ──► ScheduleSlot (sala × intervalo; lock otimista p/ drag-and-drop)
SurgeryCase ──< CaseStatusEvent (linha do tempo de status da jornada)
SurgeryCase ──< ChecklistExecution (SignIn/TimeOut/SignOut) ──< ChecklistAnswer

PreAnestheticAssessment (avaliação pré-anestésica, versionada)
  ├── AssessmentFinding (comorbidade, alergia, via aérea, ASA...)
  ├── ExamReview (exame anexado + análise assistida por IA + validação humana)
  └── AnestheticPlan (técnica, necessidade de UTI, pendências)

AnestheticRecord (ficha anestésica) ──< AnestheticEvent
  # evento tipado com timestamp: droga (dose/via), fluido, hemoderivado,
  # sinal vital, evento clínico, marco temporal (indução, incisão, fim)
  # origem: manual | atalho | voz | dispositivo — sempre distinguível

PacuStay (RPA) ──< PacuObservation (sinais, dor, escalas) ──► DischargeCriteria
```

## 3. Terminologias e tabelas de referência

| Dado | Terminologia | Observação |
|---|---|---|
| Procedimentos | TUSS/CBHPM (+ SIGTAP para SUS futuramente) | Tabelas versionadas com vigência |
| Diagnósticos | CID-10 (CID-11 quando adoção nacional) | |
| Medicamentos | Base própria mínima no MVP (apenas drogas anestésicas parametrizadas); base comercial licenciada é pré-requisito da prescrição (D-07) | Não inventar base farmacológica |
| Alergias | Lista estruturada própria + texto | Codificação SNOMED avaliada na Fase 3 |
| Escalas clínicas | ASA, Aldrete, Mallampati, capacidade funcional (METs), etc. | Parametrizadas por versão, com referência bibliográfica |

## 4. Trilha de auditoria

- Tabela `audit_event` append-only, particionada por mês: ator, papel, tenant,
  ação, entidade, versão anterior/nova (diff), IP/dispositivo, justificativa
  (quando exigida), hash encadeado por partição para evidência de integridade.
- O papel de banco usado pela aplicação **não possui** UPDATE/DELETE nessa
  tabela; retenção conforme prazos legais de prontuário (20 anos, CFM/lei
  13.787/2018 — validar com agente de Compliance).
- Acesso a prontuário (leitura) também é auditado — quem viu o quê e quando.

## 5. Dados de identificação e LGPD

- Classificação de dados em três níveis: identificador direto, sensível
  clínico, operacional. Políticas de acesso, exportação, mascaramento e
  retenção por nível.
- Base legal de tratamento: tutela da saúde (art. 11, II, f LGPD) para dados
  assistenciais; consentimento apenas onde exigível (portal, comunicações).
- Pseudonimização para analytics: `analytics` nunca consome identificadores
  diretos; chave de re-identificação segregada e auditada.

## 6. Analytics e indicadores

- Warehouse separado do transacional (réplica → transformação em camadas),
  alimentado por eventos de domínio; nenhum dashboard consulta o banco
  transacional diretamente.
- **Dicionário de indicadores obrigatório**: cada indicador publicado possui
  definição, fórmula, fonte, período, filtros, responsável, data de atualização
  e limitações — sem entrada no dicionário, o indicador não vai ao dashboard.

## 7. Migração de dados de sistemas legados

Reconhecida como risco/lacuna (R-09): todo cliente virá de outro sistema.
Estratégia mínima: importadores por entidade (paciente, agenda futura,
procedimentos) com relatório de reconciliação e coexistência temporária
(Hospital OS como camada perioperatória convivendo com o HIS legado). Plano de
migração é artefato obrigatório de cada implantação.
