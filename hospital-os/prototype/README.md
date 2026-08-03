# Hospital OS — Protótipo navegável

Protótipo do MVP perioperatório conforme `../docs/PROTOTYPE_SPEC.md`.

**Dados 100% sintéticos, sem backend, sem persistência. Não usar para assistência.**

## Executar

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # export estático em out/
```

## Telas (8)

| Rota | Tela | O que valida |
|---|---|---|
| `/` | Dashboard do dia | Estado do CC em <10 s; alertas graduados; pendências |
| `/mapa` | Mapa cirúrgico | Drag-and-drop com bloqueio de conflito de sala/equipe; visão dia/semana |
| `/agendamento` | Agendamento | Fluxo guiado; bloqueio com itens críticos incompletos |
| `/pacientes` | Pacientes | Buscar-antes-de-criar; deduplicação em tempo real |
| `/pre-anestesica` | Avaliação pré-anestésica | Sugestões de IA com fonte/incerteza; aceite item a item |
| `/ficha` | Ficha anestésica | Linha temporal; registro droga→dose em 2 toques; retroativo marcado |
| `/rpa` | Recuperação (RPA) | Aldrete com cálculo; critérios de alta; alta antecipada exige justificativa |
| `/relatorios` | Relatórios | Indicadores com dicionário (ⓘ: definição/fórmula/fonte/limitações) |

## O que este protótipo NÃO é

Não há autenticação, permissões, auditoria, tempo real multiusuário nem
integrações — esses itens são validados na implementação (Fases 1–2), não aqui.
Stack: Next.js + Tailwind (Radix entra com o design system real na Fase 1).
