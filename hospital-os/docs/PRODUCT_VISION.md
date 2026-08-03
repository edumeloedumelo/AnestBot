# Visão do Produto — Hospital OS

## 1. Visão

Ser o sistema operacional da instituição de saúde brasileira: uma plataforma
modular que cobre a jornada assistencial e administrativa completa, com
experiência de uso radicalmente melhor que os sistemas legados (Tasy, MV,
TrakCare), rastreabilidade total e IA assistiva — nunca decisória.

**Norte de longo prazo, não promessa de curto prazo.** O Hospital OS não nasce
tentando substituir um Epic. Nasce vencendo em um nicho onde os incumbentes são
comprovadamente fracos e onde o time fundador tem autoridade clínica real: **o
perioperatório** (centro cirúrgico + anestesiologia). A partir dessa cabeça de
ponte, expande módulo a módulo.

## 2. Proposta de valor

### Para o problema central

Sistemas hospitalares legados no Brasil compartilham os mesmos defeitos:

- interfaces densas, lentas e hostis, desenhadas para o faturamento e não para o cuidado;
- redigitação e retrabalho sistemáticos (a mesma alergia digitada 4 vezes);
- dados não estruturados que impedem indicadores confiáveis;
- módulos cirúrgico e anestésico tratados como apêndice do faturamento;
- curva de aprendizado de semanas e dependência de "super usuários";
- alertas em volume que gera fadiga e é ignorado.

### Diferenciais do Hospital OS

1. **Perioperatório como cidadão de primeira classe** — mapa cirúrgico em tempo
   real, checklist de cirurgia segura nativo, ficha anestésica digital com linha
   temporal, avaliação pré-anestésica com triagem assistida por IA (herdada do
   AnestBot, já validada em uso real).
2. **UX orientada ao fluxo, não ao formulário** — a tela segue a jornada do
   paciente; redução de cliques é métrica de produto.
3. **Rastreabilidade como fundação, não como recurso** — trilha de auditoria
   imutável em todos os dados clínicos desde o primeiro commit.
4. **IA assistiva com governança** — resume, transcreve, detecta ausências e
   inconsistências, sempre citando fonte e exigindo confirmação humana.
5. **Dados estruturados por padrão** — todo indicador tem definição, fórmula,
   fonte e limitações declaradas.
6. **Arquitetura moderna sem modismo** — monólito modular, extração de serviços
   apenas com justificativa concreta.

## 3. Mercado inicial (recomendado)

Ordem de ataque, do menor risco ao maior:

1. **Centros cirúrgicos independentes e hospitais-dia** (5–15 salas): dor aguda
   de gestão de mapa cirúrgico, sem TI própria robusta, ciclo de venda curto,
   não exigem substituir o HIS existente — o Hospital OS convive como "camada
   perioperatória" integrada.
2. **Hospitais de pequeno/médio porte** insatisfeitos com o módulo cirúrgico do
   HIS atual.
3. **Grupos de anestesiologia** que atendem múltiplos hospitais e precisam de
   ficha anestésica, indicadores e produção consolidada entre instituições.
4. Somente depois: hospital geral completo (exige prescrição, farmácia,
   faturamento TISS/SUS maduros).

## 4. Perfis de usuários (personas)

| Persona | Contexto | O que precisa |
|---|---|---|
| **Anestesiologista** | Alterna salas, interrompido constantemente, usa luvas | Avaliação pré-anestésica rápida, ficha com registro em ≤2 toques, indicadores de produção |
| **Cirurgião** | Agenda em múltiplos hospitais | Solicitar cirurgia completa em minutos, ver pendências (OPME, autorização), mapa do seu dia |
| **Enfermeiro de centro cirúrgico** | Coordena salas, materiais e transporte | Mapa em tempo real, checklist sign in/time out/sign out, pendências por sala |
| **Coordenador do centro cirúrgico** | Responde por ocupação e cancelamento | Mapa semanal, taxa de ocupação, atrasos, causas de cancelamento |
| **Recepção/agendamento** | Alto volume, telefone tocando | Cadastro sem duplicidade, agendamento guiado que bloqueia item crítico faltante |
| **Faturista/auditor** | Caça glosas | Consumo fechado por cirurgia, documentação completa, códigos corretos |
| **Gestor/diretor** | Decide com dados | Dashboards com origem dos dados explicada |
| **Paciente** | Ansioso, leigo | Preparo, jejum, documentos, acompanhamento de autorização |

Detalhamento de jornadas por persona será produzido na especificação de cada
módulo (artefato obrigatório nº 2 e 4 do processo — ver GOVERNANCE.md).

## 5. O que o produto NÃO é (controle de escopo)

- Não é um clone visual de sistema existente.
- Não é um substituto de Epic/Tasy no primeiro ano.
- Não é um dispositivo médico de decisão clínica (a IA não diagnostica, não
  prescreve, não classifica risco de forma autônoma).
- Não é um PACS, um LIS ou um ERP financeiro completo — integra-se a eles.

## 6. Métricas de sucesso do MVP

| Métrica | Alvo |
|---|---|
| Tempo para agendar uma cirurgia completa | < 3 min (vs ~10–15 min em legados) |
| Cliques para registrar um evento na ficha anestésica | ≤ 2 |
| Adesão ao checklist de cirurgia segura (3 fases completas) | > 95% das cirurgias |
| Cirurgias canceladas por pendência não detectada | Redução mensurável vs baseline do piloto |
| Tempo de aprendizado de um usuário novo | < 1 turno de trabalho, sem treinamento formal |
| Preenchimento estruturado da avaliação pré-anestésica | > 90% dos campos obrigatórios |
