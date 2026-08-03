# Backlog Inicial — Hospital OS

Priorizado por fase. Convenção: `F<fase>-E<épico>`. Histórias detalhadas (com
critérios de aceite completos) serão escritas por épico no início de cada fase;
aqui está o backlog de descoberta com critérios de aceite resumidos.

## Fase 1 — Fundação

### F1-E1 · Monorepo e pipeline
- Estrutura de monorepo validada (ARCHITECTURE.md §7), lint/format/typecheck,
  CI com testes e varredura de segredos/dependências, ambientes dev/staging.
- Aceite: PR não mergeia com pipeline vermelho.

### F1-E2 · Identidade e acesso
- Autenticação com MFA; RBAC contextual (papel × unidade); sessões com bloqueio
  por inatividade; acesso emergencial com justificativa; delegação temporária.
- Aceite: matriz de permissões testada por testes automatizados; acesso
  emergencial gera alerta e registro.

### F1-E3 · Trilha de auditoria imutável
- `audit_event` append-only com hash encadeado; SDK interno de auditoria;
  auditoria de leitura de prontuário.
- Aceite: tentativa de UPDATE/DELETE pela aplicação falha; relatório "quem viu
  este paciente" funcional.

### F1-E4 · Organizações e cadastros mestres
- Instituição/unidade/setor/sala; procedimentos TUSS/CBHPM versionados;
  convênios; profissionais e equipes.
- Aceite: importação de tabela TUSS com vigência; sala vinculada a unidade.

### F1-E5 · Cadastro de paciente com deduplicação
- Busca fonética + documento; detecção de duplicidade na criação; mesclagem
  auditada de cadastros; identificação positiva (nome + nascimento + foto).
- Aceite: criação de homônimo dispara verificação; mesclagem preserva
  histórico das duas origens.

### F1-E6 · Design system clínico
- Tokens, densidade alta legível, componentes: tabela densa, timeline,
  formulário clínico, banner de alerta graduado, barra de identificação do
  paciente onipresente.
- Aceite: acessibilidade AA verificada; uso com teclado completo.

## Fase 2 — MVP perioperatório

### F2-E1 · Solicitação e agendamento cirúrgico
- Solicitação com procedimento(s) + lateralidade + equipe + anestesia prevista
  + materiais/OPME + reserva de sangue/UTI + duração prevista.
- **Bloqueio de agendamento com item crítico incompleto** (configurável por
  instituição: o que é crítico).
- Status de autorização do convênio acompanhável.
- Aceite: impossível agendar sem itens críticos; pendências visíveis no mapa.

### F2-E2 · Mapa cirúrgico inteligente
- Visões dia/semana × sala; drag-and-drop com lock otimista e detecção de
  conflito (sala, equipe, equipamento); status em tempo real via WebSocket;
  gestão de encaixe de urgência; cálculo de ocupação; comunicação de alteração
  aos envolvidos.
- Aceite: dois usuários movendo o mesmo caso → um recebe conflito explícito;
  latência de atualização < 2 s.

### F2-E3 · Jornada perioperatória
- Linha de status: solicitado → autorizado → pré-op ok → pré-anestésico ok →
  confirmado → admitido → em preparo → em sala → em RPA → destino → fechado.
- Painel de pendências por caso.
- Aceite: transições registradas com autor/hora; painel de sala reflete estado
  em tempo real.

### F2-E4 · Checklist de cirurgia segura
- Sign In / Time Out / Sign Out conforme prompt mestre §6.4; cada confirmação
  registra usuário, horário, resposta, alteração e justificativa.
- Aceite: relatório de adesão por fase; item "não conforme" exige justificativa.

### F2-E5 · Avaliação pré-anestésica (evolução do AnestBot)
- Formulário estruturado (antecedentes, comorbidades, alergias, medicamentos,
  via aérea, ASA, jejum, escalas, plano, pendências, adiamento).
- Triagem de exames anexados assistida por IA (herda pipeline do AnestBot) com
  validação humana obrigatória e origem citada.
- Aceite: nenhum dado da IA entra no registro sem confirmação; documento
  versionado.

### F2-E6 · Ficha anestésica digital
- Linha temporal com marcos; registro de drogas/fluidos/eventos em ≤2 toques;
  eventos parametrizados por instituição; sinais vitais manuais nesta fase;
  edição com rastreabilidade; assinatura e impressão/PDF.
- Aceite: registro retroativo marcado como tal; exportação íntegra.

### F2-E7 · Recuperação pós-anestésica
- Admissão, observações seriadas, escalas (Aldrete), dor/náusea/sangramento,
  critérios de alta com validação, intercorrências, tempo de permanência.
- Aceite: alta sem critérios atingidos exige justificativa médica.

### F2-E8 · Relatórios e dashboard do centro cirúrgico
- Indicadores: volume, ocupação de sala, atraso de início, cancelamento (com
  causa), tempo de RPA, produção por profissional — todos com entrada no
  dicionário de indicadores.
- Dashboard do dia (salas, status, pendências) para coordenação.
- Aceite: cada indicador exibe definição/fórmula/fonte ao clicar.

### F2-E9 · Piloto
- Seeds sintéticos completos; plano de implantação, migração mínima (pacientes
  e agenda futura), treinamento e monitoramento; operação assistida.
- Aceite: critérios de saída da Fase 2 (ROADMAP.md).

## Fases 3–5

Épicos macro já identificados em MODULES.md e ROADMAP.md; detalhamento ocorrerá
ao fim da Fase 2. Itens que exigem preparação antecipada:
- **D-07** (base de medicamentos licenciada) — negociação comercial longa,
  iniciar durante a Fase 2.
- Credenciamento TISS com operadoras-alvo do piloto — iniciar na Fase 2 para a
  autorização, reaproveitar na Fase 4.
