# Governança e Estrutura Multiagente — Hospital OS

## 1. Princípios fundamentais (os 15, na íntegra)

1. Segurança do paciente acima de velocidade ou conveniência.
2. Dados clínicos nunca alterados ou apagados sem rastreabilidade.
3. Nenhuma IA toma decisão clínica autônoma.
4. Toda sugestão de IA é identificada como sugestão e exige validação humana.
5. Nenhum dado ausente é inventado.
6. Toda alteração relevante gera registro de auditoria.
7. O sistema reduz cliques, duplicidade de trabalho e redigitação.
8. A interface se adapta ao papel do usuário.
9. Informações urgentes são apresentadas por prioridade clínica.
10. A arquitetura permite evolução modular.
11. A aplicação é segura, testável, documentada e observável.
12. Nenhum módulo crítico entra em produção sem homologação humana.
13. O sistema permanece funcional com falhas parciais de integração.
14. Privacy by design, security by design, safety by design.
15. Toda escolha técnica é justificada; nada por modernidade.

## 2. Estrutura multiagente

O projeto opera como uma organização simulada de agentes com papéis definidos.
Na prática de execução, cada papel corresponde a uma *lente de revisão*
aplicada a cada artefato — instanciada como agente de revisão independente
quando o volume justificar.

### Conselho estratégico (sempre ativo)
| Agente | Veto sobre |
|---|---|
| Diretor Executivo | Escopo, prioridade, viabilidade econômica |
| Diretor Médico | Segurança clínica, fluxos assistenciais |
| Diretor de Enfermagem | Fluxos de enfermagem, usabilidade no ponto de cuidado |
| Diretor de Tecnologia | Arquitetura, dívida técnica, escolhas de tecnologia |
| Diretor de Produto | Backlog, MVP, experiência do usuário |
| Compliance e Regulação | LGPD, normas de prontuário, retenção, assinatura |

### Agentes especialistas (ativados por demanda do módulo em desenvolvimento)
- **Clínicos**: anestesiologia, cirurgia, enfermagem, RPA, emergência, UTI,
  farmácia hospitalar, segurança do paciente, SCIH e demais listados no prompt
  mestre §3.2. No MVP, os agentes ativos são: anestesiologia, cirurgia,
  enfermagem de centro cirúrgico, RPA e segurança do paciente.
- **Administrativos**: recepção/cadastro, agendamento, autorização/convênios
  (ativos no MVP); demais ativados nas fases 3–4.
- **Produto/UX**: PM, UX Researcher, UI/UX Designer, Design System Architect,
  Accessibility Specialist, Clinical Workflow Designer.
- **Técnicos**: Solution/Software/Database/Security Architect, DevOps, QA
  Architect, AI Engineer, Technical Writer e demais do §3.5.
- **Validação independente** (§3.6): revisão de arquitetura, clínica,
  segurança, threat modeling, código, performance, usabilidade,
  acessibilidade, integrações, regressão, carga, LGPD, riscos, documentação e
  implantação.

**Regra de independência**: nenhum agente que produziu uma funcionalidade é o
único aprovador dela. Toda entrega crítica tem no mínimo: 1 revisão clínica +
1 revisão de segurança + 1 revisão técnica, por agentes que não a produziram.

## 3. Fluxo de governança por entrega

```
Solicitação → Análise do objetivo → Mapeamento de usuários → Mapeamento do
fluxo hospitalar → Identificação de riscos → Especificação funcional →
Especificação técnica → Protótipo → Revisão clínica → Revisão de UX →
Revisão de segurança → Implementação → Testes automatizados → Testes de
integração → Validação por agentes independentes → Correções →
Homologação humana → Documentação → Entrega
```

Cada etapa produz artefato verificável, versionado neste repositório.
**Homologação humana é gate obrigatório e intransferível** — nenhum agente a
substitui.

## 4. Artefatos obrigatórios por módulo (20)

Objetivo · Usuários · Problemas · Fluxo atual · Fluxo proposto · Requisitos
funcionais · Requisitos não funcionais · Regras de negócio · Dados ·
Permissões · Riscos · Casos excepcionais · Wireframes · Protótipo · Critérios
de aceite · Casos de teste · Plano de implementação · Plano de migração ·
Plano de treinamento · Plano de monitoramento.

Local: `domains/<dominio>/` quando o monorepo for criado; até lá, `docs/`.

## 5. Critérios de parada de tarefa

Uma tarefa só é concluída quando: requisitos atendidos; código compila; testes
passam; permissões validadas; segurança revisada; auditoria funcionando;
documentação atualizada; riscos registrados; nenhuma falha crítica conhecida;
critérios de aceite comprovados com evidência.

## 6. Loop de desenvolvimento

Planejar → Projetar → Implementar → Testar → Criticar (revisores
independentes) → Corrigir → Validar → Finalizar (resumo, arquivos, testes,
riscos, próximos passos). Detalhado no prompt mestre §18; vale para toda tarefa.

## 7. Padrões de código (resumo executável)

Tipado, modular, testável, documentado, seguro, legível, consistente,
observável. Obrigatórios: lint, format, testes (unit/integration/e2e),
validação de entrada, tratamento de erros, migrations, logs estruturados,
controle de acesso, documentação de APIs, versionamento, revisão independente.
Proibidos: arquivos gigantes, lógica duplicada, credenciais em código, dados
reais de pacientes em desenvolvimento, declarar pronto sem testes.

## 8. Documentos vivos

`PROJECT_STATE.md` (estado), `BACKLOG.md`, `ROADMAP.md`, `DECISIONS.md`,
`RISKS.md` são atualizados a cada entrega relevante. Desatualização desses
arquivos é bug de processo.
