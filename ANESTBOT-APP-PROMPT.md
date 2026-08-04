# PROMPT COMPLETO — ANESTBOT: de bot de WhatsApp a plataforma comercial de anestesiologia

> **Como usar:** cole este prompt inteiro na ferramenta de geração (Claude Code, Lovable,
> Bolt, Cursor, etc.). Ele descreve o produto completo, tela a tela, modelo de dados,
> regras clínicas, integração com o bot existente e o modelo de negócio. Gere o app
> exatamente como especificado, perguntando apenas o que estiver marcado como [DECIDIR].

---

## 1. VISÃO DO PRODUTO

Construa o **ANESTBOT Platform**: um SaaS para equipes de anestesiologia (foco inicial:
equipes que atendem cirurgia plástica de alto padrão no Brasil) que transforma o
WhatsApp — onde a equipe já trabalha — no canal de entrada, e entrega no app tudo que o
WhatsApp não consegue: dashboard, prontuário anestésico, faturamento por TUSS/CBHPM e
biblioteca de consulta rápida.

**Princípio de produto:** o WhatsApp continua sendo a porta de entrada (zero fricção
para a equipe); o app é o cérebro e o cofre. Nada obriga a equipe a mudar de hábito no
dia 1 — o valor aparece sozinho no dashboard.

**Já existe e deve ser integrado (não reconstruído):** um bot Node.js/Express em
produção (Railway) que recebe fichas de anamnese e exames num grupo de WhatsApp
(UltraMsg), delimitados por `xxxx` ... `❌❌❌❌`, analisa com a API do Claude e devolve
um parecer com STATUS, exames conferidos item a item e PENDÊNCIAS numeradas. O bot já
resolve: captura de texto completo via webhook, roteamento de mídia atrasada por
timestamp de envio, timeouts/watchdog anti-travamento, orçamento de payload anti-413 e
regras clínicas (Hb≥12, BIRADS→mastologista, sorologias, GLP-1 21 dias, ASA, jejum).
O app consome os dados desse bot via API interna + eventos.

---

## 2. ARQUITETURA

- **Backend:** Node.js (NestJS ou Express modular) + PostgreSQL (Prisma). O bot atual
  vira um serviço do monorepo (`apps/bot`), e passa a **publicar eventos** (caso
  recebido, parecer emitido, pendência resolvida) numa tabela/fila que o backend
  consome. Armazenamento de arquivos: S3-compatível (exames em PDF/imagem, criptografados).
- **Frontend:** React + Vite + Tailwind + shadcn/ui, PWA (instalável no celular do
  anestesista). Gráficos com Recharts.
- **Auth:** e-mail + senha com 2FA opcional; convite por link; papéis:
  `admin` (dono da equipe), `anestesista`, `secretaria` (sem acesso a dados clínicos
  sensíveis além do necessário), `leitura`.
- **Multi-tenant desde o dia 1:** tudo escopado por `team_id`. Um grupo de WhatsApp
  conecta-se a um tenant via token de pareamento.
- **LGPD (obrigatório, é argumento de venda):** dados de saúde = dado sensível.
  Criptografia em repouso, log de auditoria imutável (quem viu qual paciente e quando),
  exportação e exclusão de dados do paciente sob demanda, termo de consentimento
  registrável, retenção configurável. Anonimização automática nos dashboards agregados.

---

## 3. MÓDULOS (telas e comportamento)

### 3.1 Dashboard (home)
- Cards do topo: casos analisados no mês, % liberados de primeira, pendências abertas,
  tempo médio ficha→parecer, faturamento estimado do mês (ver módulo TUSS).
- Gráficos: casos por semana (12 semanas), distribuição por tipo de cirurgia,
  ranking das pendências mais frequentes (ex.: "HBsAg faltando" — isso orienta a equipe
  a corrigir processo), funil pendente→resolvido→liberado.
- Feed em tempo real: últimos pareceres do bot com STATUS colorido
  (🟢 liberado / 🟡 pendências / 🔴 bloqueio), clicáveis para o caso.

### 3.2 Casos / Triagem (espelho do WhatsApp)
- Lista de todos os casos que passaram pelo bot: paciente, cirurgia, data, STATUS,
  pendências abertas. Busca e filtros (período, cirurgia, status, anestesista).
- Detalhe do caso: anamnese completa, galeria dos exames (viewer de PDF/imagem com
  zoom e rotação), parecer do bot na íntegra, linha do tempo (recebido → analisado →
  pendência resolvida → liberado), campo de conduta/observação do anestesista com
  assinatura (nome+CRM+timestamp).
- Ações: marcar pendência como resolvida (anexando o exame que faltava), reanalisar
  (dispara o `/resetar` do bot via API), aprovar/vetar manualmente por cima do parecer
  (o médico sempre tem a palavra final — registrar override no audit log).

### 3.3 Registro de Anestesias (prontuário anestésico digital)
- A partir de um caso triado (ou criado à mão), gerar a **ficha anestésica**:
  - Pré: avaliação pré-anestésica herdada da triagem (ASA, Mallampati, alergias,
    medicações em uso, jejum, consentimento assinado).
  - Per: técnica (geral balanceada/venosa total, raqui, peri, bloqueio de plexo,
    sedação), drogas e doses com horário (tabela de eventos), via aérea, monitorização,
    intercorrências (tags padronizadas + texto livre), sinais vitais em grade temporal
    (entrada manual rápida ou importação futura).
  - Pós: destino (RPA/UTI), Aldrete, dor, náusea/vômito, orientações.
- Templates por tipo de cirurgia (o admin cria os seus) — preencher uma ficha de rotina
  em <90 segundos é requisito de UX.
- Saída: **PDF assinado** (padrão aceito por hospitais/convênios) + registro imutável.
- Estatísticas pessoais do anestesista: nº de atos por técnica, tempo médio, taxa de
  intercorrência — ouro para titulação, recertificação e defesa profissional.

### 3.4 Faturamento — Tabelas TUSS / CBHPM
- **Base de dados embutida:** tabela TUSS (terminologia) + CBHPM (portes anestésicos,
  porte 1 a 8, e valor do porte). Estrutura: `codigo_tuss`, `descricao`,
  `porte_anestesico`, `valor_porte_padrao`. Permitir importação/atualização por CSV
  (as tabelas mudam; não hardcodar valores) e **valores negociados por convênio**:
  cada tenant cadastra seus convênios e o valor do porte de cada um (ex.: Unimed X
  paga porte 5 = R$ Y; particular = tabela própria).
- **Calculadora de honorário anestésico:** busca por código ou descrição da cirurgia →
  mostra porte → calcula honorário por convênio/particular, com regras configuráveis:
  acréscimo de urgência (%), horário noturno/fim de semana, procedimentos múltiplos
  (regra 100%/70%/50%), tempo adicional além do porte, deslocamento.
- **Vínculo automático:** cada registro de anestesia recebe o(s) código(s) TUSS e o
  valor calculado → o dashboard soma o **faturamento realizado vs. faturado vs. glosado**
  (status: a faturar / enviado / pago / glosado, com motivo da glosa).
- Relatório mensal de produção por anestesista e por convênio, exportável
  (PDF/Excel) — é o relatório que hoje toma um fim de semana da equipe.

### 3.5 Consulta de Temas (biblioteca clínica)
- Biblioteca de temas de anestesiologia editável pela equipe (Markdown): jejum,
  anticoagulantes e bloqueio de neuroeixo, GLP-1, manejo de via aérea difícil, alergia
  a látex, protocolos da própria equipe, etc. Busca instantânea.
- **Assistente de consulta (IA):** chat interno que responde citando primeiro os
  protocolos da própria equipe e deixa claro o que é referência geral. Sempre com o
  aviso "apoio à decisão — não substitui julgamento clínico". [Usar a API do Claude;
  modelo configurável por env.]
- Tabelas rápidas: doses por peso, jejum por idade/alimento, escala ASA, Aldrete,
  Mallampati — como cards offline no PWA (funciona no centro cirúrgico sem sinal).

### 3.6 Pacientes
- Cadastro mínimo (nome, nascimento, contato, convênio) alimentado automaticamente
  pela triagem; histórico de todos os casos/anestesias do paciente; alergias e alertas
  fixados no topo (látex! via aérea difícil na anestesia anterior!) — o alerta de
  "anestesia anterior com intercorrência" ao abrir um caso novo é feature matadora.

### 3.7 Configurações
- Critérios clínicos da triagem (espelha e edita o `config.json` do bot: cirurgias →
  exames exigidos, limites de referência) — editar no app é mais seguro que
  `/addcirurgia` no grupo.
- Conexão WhatsApp (status da instância UltraMsg, re-pareamento), convênios e valores,
  templates de ficha, equipe e papéis, auditoria LGPD.

---

## 4. MODELO DE DADOS (mínimo)

`teams`, `users`, `memberships(role)`, `patients`, `cases` (triagens: anamnese, status,
parecer, pendências[]), `case_files` (exames, com flags legível/degradado/descartado),
`anesthesia_records` (pré/per/pós, eventos[], vitals[], técnica, assinatura),
`tuss_codes`, `insurers`, `insurer_price_tables`, `billing_entries`
(record_id, código, valor calculado, status faturamento, motivo_glosa), `topics`
(biblioteca), `audit_logs` (imutável), `whatsapp_links` (grupo↔tenant).

---

## 5. INTEGRAÇÃO COM O BOT EXISTENTE

1. Bot ganha `POST /internal/events` → backend (ou tabela compartilhada) com:
   `case.received`, `case.analyzed` (parecer completo + arquivos), `case.reanalyzed`.
2. Backend pode comandar o bot: reanalisar caso, enviar mensagem no grupo
   ("Pendência do caso Karolliny resolvida ✅ — liberada").
3. **Notificações espelhadas:** pendência resolvida no app → aviso no grupo; parecer
   novo no grupo → push no app. Um canal nunca fica desatualizado em relação ao outro.
4. Segredos por env; token de serviço interno entre bot e backend; nunca expor a API
   da UltraMsg ao frontend.

---

## 6. MODELO DE NEGÓCIO (embutir no produto)

- **Planos por assinatura (por equipe/mês):**
  - **Starter** — triagem WhatsApp + dashboard + casos (o que o bot já faz, com cara
    de produto). Porta de entrada barata.
  - **Pro** — + registro de anestesias + PDF assinado + biblioteca/IA de consulta.
  - **Business** — + faturamento TUSS/CBHPM completo, relatórios de produção,
    multi-unidade, auditoria LGPD avançada, suporte prioritário.
  - Add-on: nº de anestesistas além do incluído.
- **Trial de 14 dias no Pro** sem cartão; onboarding guiado que conecta o WhatsApp em
  <10 minutos (é o "aha moment").
- Billing com Stripe (ou Asaas/iugu para PIX/boleto — mercado BR) [DECIDIR gateway].
- Página de landing incluída no repo: dor ("quantas cirurgias suspensas por exame
  faltando este mês?"), demo em vídeo, prova social, preços, CTA de trial.
- Métricas de produto instrumentadas: ativação (1º caso triado), retenção semanal,
  nº de fichas/mês por tenant — para orientar o comercial.

**Por que isso vende:** o cliente não compra "um bot" — compra (1) cirurgia que não
suspende por pendência descoberta na véspera, (2) o fim do fim de semana montando
relatório de produção, (3) proteção jurídica (ficha assinada + auditoria), (4) dinheiro
recuperado de glosa. Cada módulo ataca uma dor com valor monetário claro.

---

## 7. REQUISITOS NÃO FUNCIONAIS

- Tudo em pt-BR; timezone America/Sao_Paulo; datas dd/mm/aaaa.
- Mobile-first (o anestesista usa no corredor do centro cirúrgico); PWA offline para
  tabelas rápidas e fichas em rascunho.
- Testes automatizados nas regras de dinheiro (cálculo de porte/honorário) e nas regras
  clínicas de triagem — 100% das regras com teste.
- Seeds de demonstração (equipe fictícia com 30 casos) para vender em demo.
- Disclaimer clínico em toda tela com conteúdo médico: "Ferramenta de apoio à decisão.
  Não substitui avaliação médica presencial."
- Nunca inventar valor de exame ilegível; nunca afirmar que viu arquivo que não chegou
  (princípios herdados do bot — valem para o app inteiro).

## 8. ORDEM DE CONSTRUÇÃO

1. Monorepo + auth + multi-tenant + integração de eventos com o bot.
2. Casos/Triagem (espelho do WhatsApp) + Dashboard.
3. Registro de Anestesias + PDF.
4. TUSS/CBHPM + faturamento + relatórios.
5. Biblioteca/IA de consulta + Pacientes com alertas.
6. Billing/planos + landing + seeds de demo.

Entregue cada etapa funcionando de ponta a ponta antes de ir à próxima.
