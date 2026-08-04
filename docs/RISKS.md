# RISKS — riscos conhecidos e mitigação

Atualizado: 04/08/2026 (Marco 0/1). Severidade: 🔴 alta · 🟠 média · 🟡 baixa.

## Riscos do bot em produção

| # | Risco | Sev. | Estado / Mitigação |
|---|---|---|---|
| R-01 | Webhook aceitava payload forjado (inclusive `fromMe` falso ⇒ admin) | 🔴 | **Mitigado no Marco 0** com `WEBHOOK_TOKEN` (D-003). ⚠️ Exige configurar a env em produção e acrescentar `?token=` na URL do webhook no painel UltraMsg — enquanto não configurado, o bot roda em modo compatibilidade (aceita e avisa no log). |
| R-02 | `ADMIN_NUMBERS` vazio dava admin a todos | 🔴 | **Mitigado no Marco 0** (fail-closed, D-002). Se alguém do grupo perder acesso legítimo, configurar `ADMIN_NUMBERS`. |
| R-03 | Anamnese/nome de paciente/URLs de exame nos logs do Railway | 🔴 | **Mitigado no Marco 0** (D-004) + teste anti-regressão. Logs ANTIGOS do Railway ainda contêm PHI — recomenda-se limpar retenção de logs antigos no painel (ação humana, produção). |
| R-04 | Store JSON sem lock entre processos — múltiplas réplicas se corrompem | 🟠 | Documentado (1 réplica só). Persistirá até a plataforma assumir o estado (Marco 2+). |
| R-05 | Sem rate-limit fino no webhook | 🟡 | Token bloqueia não autenticados; limite de payload reduzido a 5mb (D-005). Rate-limit por IP entra com a API da plataforma. |
| R-06 | Prompt clínico configurável via `/setprompt` permite injetar instrução no system prompt | 🟠 | Agora restrito a admin real (R-01/R-02 mitigados). Risco residual: admin legítimo pode degradar o protocolo — mitigação futura: regras determinísticas versionadas (Marco clínico, seção 6 do prompt-mestre). |
| R-07 | Dependência de serviços terceiros (UltraMsg) sem SLA — mídia pode nunca chegar | 🟡 | Já tratado no design (categorias "falha no recebimento"); monitorar. |
| R-08 | Logs antigos e volume `/data` contêm dados clínicos reais | 🟠 | Fora do alcance do código: exige política de retenção/limpeza em produção (ação humana). Registrado para o runbook. |

## Riscos da plataforma (Marcos 1–2)

| # | Risco | Sev. | Estado / Mitigação |
|---|---|---|---|
| R-10 | Outbox em arquivo no volume: perda do volume = perda de eventos não entregues | 🟠 | Aceito por ora (mesma garantia do store de produção). Replay manual documentado; a plataforma persiste tudo que recebeu (inbox) — janela de exposição é só a fila pendente. |
| R-11 | Segredo HMAC compartilhado bot↔plataforma sem rotação automática | 🟠 | Suporte a 2 segredos ativos (primário + anterior) no receptor para rotação sem downtime; rotação é procedimento do runbook. |
| R-12 | Ambiente desta sessão não tem Docker/Postgres real | 🟠 | Testes de integração do Marco 2 rodam com `pg-mem` (Postgres em memória) quando `DATABASE_URL` não existe; CI/dev com Postgres real usam a MESMA suíte via env. Registrado em BASELINE/STATUS — validar contra Postgres real antes de qualquer uso sério. |
| R-13 | Sessões/tokens da API: comprometimento de `SESSION_SECRET` | 🟠 | Sessões opacas com hash em banco (revogáveis); segredo só assina cookies/CSRF. Rotação via env. |
| R-14 | LGPD: dados de saúde em desenvolvimento | 🔴 | Regra absoluta: seeds/testes/fixtures SÓ com dados sintéticos (nomes fictícios explícitos). Teste de CI procura padrões proibidos nos seeds. |

## Dívidas conscientes (não são bugs)

- Bot permanece em JS puro (sem TS) — reescrever agora violaria a seção 3 do
  prompt-mestre; a plataforma nasce TS estrito.
- Sem CI hospedado ainda (não há `.github/workflows` na main); workflow entra
  nesta branch, mas só passa a rodar após revisão/merge pelo dono.
- `/resetar` liberado para todos (decisão de produto de 04/08, commit `943bf96`)
  — mantido: é operacional e não destrutivo.
