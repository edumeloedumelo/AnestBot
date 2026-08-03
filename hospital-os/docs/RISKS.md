# Registro de Riscos — Hospital OS

Escala: Probabilidade (P) e Impacto (I) em Baixo/Médio/Alto/Crítico.
Revisão obrigatória a cada fase e a cada incidente.

| ID | Risco | P | I | Mitigação | Dono |
|---|---|---|---|---|---|
| R-01 | **Escopo gigante** — o prompt mestre descreve ~10 anos de produto; tentar tudo leva a nada pronto | Alto | Crítico | Roadmap faseado com critérios de saída; MVP restrito ao perioperatório; módulos extras só com caso de negócio; Diretor Executivo com veto de escopo | Dir. Executivo |
| R-02 | **Segurança clínica de software imaturo** — erro de dado no ponto de cuidado pode ferir paciente | Médio | Crítico | Piloto com operação assistida e coexistência com processo em papel; safety review por módulo; alertas graduados; identificação positiva; princípio 1 como critério de desempate | Dir. Médico |
| R-03 | **Lacuna regulatória de assinatura digital** — sem ICP-Brasil/NGS2, o prontuário não elimina papel; piloto pode assumir o contrário | Alto | Alto | Decisão D-04; enquanto pendente, contrato do piloto explicita operação híbrida (impressão + assinatura física onde exigido) | Compliance |
| R-04 | **Prescrição sem base farmacológica confiável** — construir interações/doses "na mão" é inseguro e reinventa roda licenciável | Alto | Crítico | Prescrição fora do MVP; D-07 (licenciar base comercial) como pré-requisito bloqueante da Fase 3 | Dir. Médico + CTO |
| R-05 | **Integração com monitores/dispositivos subestimada** — protocolos proprietários, hardware de gateway, ruído de sinal | Alto | Médio | Fora do MVP; ficha anestésica nasce excelente em registro manual; piloto de integração isolado na Fase 3 com um fabricante | Integration Architect |
| R-06 | **Fadiga de alarmes** — replicar o vício dos legados destrói a proposta de valor | Médio | Alto | Alertas graduados por severidade com orçamento de interrupção; métricas de alertas ignorados desde o MVP | Dir. Enfermagem + UX |
| R-07 | **Dependência da plataforma Base44** — o AnestBot atual roda em BaaS proprietário; o Hospital OS não pode herdar esse lock-in | Médio | Alto | ADR-002/ADR-003: plataforma nova em stack próprio; AnestBot permanece como produto separado até a migração do fluxo de triagem | CTO |
| R-08 | **Capacidade de execução vs ambição** — organização multiagente simulada não substitui homologação humana, validação clínica real e vendas | Alto | Crítico | D-06 (capacidade real); piloto único; escopo de MVP pequeno; gates de homologação humana | Dir. Executivo |
| R-09 | **Migração de dados de legados** — todo cliente vem de outro sistema; sem importadores, não há venda | Alto | Alto | Estratégia de coexistência (camada perioperatória); importadores mínimos no épico de piloto (F2-E9) | CTO |
| R-10 | **LGPD/vazamento de dados sensíveis** — dado de saúde é a classe mais sensível da lei | Médio | Crítico | SECURITY.md integral; pentest pré-piloto; dados sintéticos fora de prod; auditoria de leitura; resposta a incidentes | Compliance |
| R-11 | **Confiabilidade em tempo real do mapa cirúrgico** — dado desatualizado no mapa causa decisão errada de sala/equipe | Médio | Alto | Indicador de status de sincronização visível (stale = explícito); locks otimistas; testes de concorrência; degradação para modo leitura com aviso | Frontend/Backend Architects |
| R-12 | **Alucinação/erro de IA na triagem pré-anestésica** — sugestão errada aceita por cansaço ("automation bias") | Médio | Alto | Validação humana obrigatória com fricção proporcional ao risco; origem citada; nunca preencher silenciosamente; monitorar taxa de correção humana como métrica de qualidade | AI Engineer + Dir. Médico |
| R-13 | **Indicadores errados orientando gestão** — dashboard confiável demais sem qualidade de dado | Médio | Médio | Dicionário de indicadores obrigatório com limitações declaradas; warehouse separado; validação por amostragem no piloto | Analytics |
| R-14 | **Concorrência e ciclo de venda hospitalar longo** — incumbentes têm contratos e integração profunda | Alto | Médio | Entrada por nicho (centros cirúrgicos independentes, grupos de anestesia) sem exigir substituição do HIS | Dir. Produto |

## Riscos aceitos conscientemente (por ora)

- MVP sem prescrição eletrônica: o perioperatório usará registro de drogas na
  ficha anestésica (documentação), não prescrição formal — aceitável no escopo
  de centro cirúrgico independente, revisitar para hospital com internação.
- MVP sem integração de monitores: registro manual bem desenhado; risco de
  transcrição aceito e mitigado por UX de ≤2 toques.
- PWA em vez de app nativo no MVP: risco de limitação em hardware específico,
  aceito até demanda comprovada (ADR-005).
