# Proposta do Primeiro Protótipo Navegável — Hospital OS

Objetivo: validar fluxo, densidade de informação e linguagem visual com
usuários reais (anestesiologistas, cirurgiões, enfermagem de CC, coordenação)
**antes** de implementar o núcleo clínico. Protótipo = navegável, com dados
sintéticos, sem backend real.

## 1. Forma técnica

- Protótipo em Next.js + design system embrionário (Radix + Tailwind), com
  dados sintéticos em memória — já exercita o stack real (ADR-003) e vira
  fundação do `apps/web`, evitando protótipo descartável em Figma.
- Interativo o suficiente para testes de usabilidade moderados (5–8 sessões,
  roteiro por persona).
- Nenhuma persistência, nenhum dado real, banner permanente "PROTÓTIPO".

## 2. Telas do protótipo (8)

### P1 · Dashboard operacional do dia
Salas em colunas com caso atual/próximo, status colorido por prioridade
clínica, pendências agregadas, ocupação do dia, alertas graduados. Pergunta de
validação: um coordenador entende o estado do centro cirúrgico em <10 s?

### P2 · Cadastro do paciente
Busca-antes-de-criar (deduplicação), formulário mínimo viável, identificação
positiva no topo (nome, nascimento, foto, alergias em destaque permanente).

### P3 · Agendamento cirúrgico
Fluxo guiado: paciente → procedimento(s) TUSS + lateralidade → equipe →
recursos (OPME, sangue, UTI, equipamentos) → duração → revisão. Demonstrar o
**bloqueio de item crítico faltante** e o painel de pendências.

### P4 · Mapa cirúrgico
Grade sala × horário (dia e semana), drag-and-drop com alerta de conflito
simulado (equipe em duas salas), cores por status da jornada, filtros
(especialidade, cirurgião, status), indicador de sincronização.

### P5 · Avaliação pré-anestésica
Formulário estruturado em seções navegáveis (antecedentes, medicamentos,
alergias, via aérea, ASA, plano); painel lateral de triagem de exames com
sugestões de IA claramente marcadas como sugestão, com fonte, exigindo
aceitar/rejeitar item a item (herda o conceito validado no AnestBot).

### P6 · Ficha anestésica
Linha temporal horizontal (drogas, fluidos, eventos, marcos); paleta de
registro rápido (≤2 toques: droga → dose confirmada); modo tablet; registro
retroativo visualmente distinto.

### P7 · Recuperação pós-anestésica
Admissão, observações seriadas, Aldrete com cálculo automático, critérios de
alta com estado (atingido/não), intercorrências.

### P8 · Relatórios do centro cirúrgico
Indicadores do mês (volume, ocupação, atraso, cancelamento por causa, tempo de
RPA), cada card com "ⓘ" abrindo definição/fórmula/fonte (dicionário de
indicadores desde o protótipo).

## 3. O que o protótipo NÃO valida

Performance real, tempo real multiusuário, permissões, auditoria, integrações.
Esses são validados na implementação com testes próprios.

## 4. Critérios de aceite do protótipo

1. Usuário de cada persona completa sua jornada-alvo sem instrução prévia.
2. Feedback estruturado coletado e registrado em `docs/` (relatório de
   usabilidade por sessão).
3. Ajustes de fluxo incorporados antes do início da implementação do MVP.
4. Aprovação registrada dos agentes: clínico (anestesiologia + cirurgia +
   enfermagem CC), UX e segurança do paciente.

## 5. Estimativa e ordem

Ordem de construção: P4 (mapa) → P3 (agendamento) → P5 (pré-anestésica) → P6
(ficha) → P1 → P7 → P2 → P8. O mapa vem primeiro por ser o coração da proposta
de valor e o maior risco de UX.

**Este protótipo só inicia após homologação humana da Fase 0** (Etapa 5 da
primeira missão).
