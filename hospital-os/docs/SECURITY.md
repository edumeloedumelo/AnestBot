# Estratégia de Segurança, Privacidade e Conformidade — Hospital OS

## 1. Postura

Security by design, privacy by design, safety by design. Segurança não é
módulo: é requisito de aceite de toda entrega. Nenhuma funcionalidade é
declarada pronta sem revisão de segurança independente (GOVERNANCE.md §3).

## 2. Identidade e acesso

- Autenticação com MFA (obrigatório para papéis clínicos e administrativos
  privilegiados); suporte a login corporativo (OIDC/SAML) para hospitais com
  diretório próprio.
- **RBAC + contexto**: permissão = papel × unidade × setor × relação com o
  paciente. Um anestesiologista vê os pacientes das suas salas/escala, não o
  hospital inteiro.
- **Acesso emergencial ("break the glass")**: acesso fora de escopo permitido
  mediante justificativa registrada, com alerta ao responsável de privacidade e
  revisão obrigatória posterior.
- Sessões: bloqueio automático por inatividade (agressivo em estação
  compartilhada de centro cirúrgico), dispositivos confiáveis, revogação
  central.
- Delegação temporária (férias/plantão) com vigência e trilha.
- Revisão periódica de acessos (relatório trimestral por gestor de unidade).

## 3. Proteção de dados

- Criptografia em trânsito (TLS 1.2+) e em repouso (volumes e backups).
- Segredos em cofre (nunca em código — CI bloqueia por varredura de segredos).
- Mascaramento de identificadores em logs; logs nunca contêm dado clínico.
- Controle e auditoria de exportações (quem exportou o quê; marca d'água em
  PDFs com identificação do emissor).
- Backups criptografados, testados por restauração automática mensal.
- Hospedagem em região brasileira (requisito LGPD/latência — D-03).

## 4. Segurança de aplicação

- Validação de entrada em todas as bordas (DTOs tipados + schema validation).
- Rate limiting e proteção de APIs públicas (portal do paciente é a maior
  superfície).
- Gestão de vulnerabilidades: varredura de dependências no CI, SLA de correção
  por severidade.
- Threat modeling por módulo antes da implementação (artefato obrigatório;
  primeiro alvo: fluxo de agendamento + prontuário perioperatório).
- Testes de segurança automatizados no pipeline + pentest externo antes do
  primeiro piloto em produção.

## 5. Safety (segurança clínica)

Distinta de security, com processo próprio:

- Análise de modos de falha clínica (o que acontece se o mapa mostrar dado
  velho? se duas fichas anestésicas abrirem para o mesmo caso?) registrada na
  especificação de cada módulo.
- Alertas graduados por severidade clínica para evitar fadiga de alarme;
  todo alerta ignorável registra o "ignorar" na auditoria.
- Identificação positiva do paciente em toda ação clínica (nome completo +
  data de nascimento + identificador; foto quando disponível).
- Plano de contingência de indisponibilidade (downtime procedures): relatórios
  de sala imprimíveis, modo leitura degradado, procedimento em papel definido
  por implantação (princípio 13).
- Nenhuma integração de dispositivo sobrescreve dado silenciosamente: dado de
  monitor entra como fonte identificada, conflitos são exibidos, nunca
  resolvidos de forma autônoma.

## 6. IA — governança específica

- IA não decide, não prescreve, não classifica risco de forma autônoma.
- Toda saída: identificada como sugestão, com fontes e incerteza; confirmação
  humana auditada antes de qualquer efeito no prontuário.
- IA opera com as permissões do usuário solicitante (nunca acesso ampliado).
- Prompts e respostas registrados para auditoria (com mesma proteção de dado
  clínico).
- Avaliação de vieses e de taxa de erro por caso de uso antes de habilitar em
  produção; kill switch por funcionalidade e por tenant.

## 7. Conformidade regulatória (Brasil)

| Norma | Implicação | Status |
|---|---|---|
| LGPD | Base legal, direitos do titular, RIPD, DPO do cliente | Estratégia definida (DATA_MODEL §5); RIPD por módulo na implementação |
| CFM 1.821/2007 + SBIS (NGS1/NGS2) | Requisitos para prontuário eletrônico; **eliminar papel exige assinatura digital ICP-Brasil (NGS2)** | Decisão D-04 pendente (integração com certificação/assinatura em nuvem) |
| Lei 13.787/2018 | Digitalização e guarda de prontuário (20 anos) | Refletida na retenção da auditoria |
| CFM 2.299/2021 e correlatas | Telemedicina (fase futura) | Fora do MVP |
| RDC 36/2013 ANVISA | Segurança do paciente (núcleo, notificações) | Módulo quality, Fase 4 |
| TISS (ANS) | Padrão obrigatório de troca com operadoras, versionado | Autorização no MVP; faturamento na Fase 4 |

Ponto de atenção (registrado em RISKS.md R-03): enquanto não houver assinatura
digital qualificada, o sistema opera como apoio com impressão/assinatura física
onde a norma exigir — isso deve ficar explícito no contrato com o piloto.

## 8. Resposta a incidentes

Plano mínimo antes do primeiro piloto: classificação de severidade, papéis,
comunicação a titulares/ANPD quando aplicável (LGPD art. 48), post-mortem sem
culpados, registro de lições no repositório.
