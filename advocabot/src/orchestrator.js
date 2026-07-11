// Orquestrador multi-agente jurídico.
// Fluxo: Classificador → Especialistas (paralelo) → CEO (síntese final).
import { analyze } from './anthropic.js';
import { downloadMediaBlock } from './ultramsg.js';
import { buildClassifierPrompt, buildSpecialistPrompt, buildCEOPrompt } from './prompt.js';

const AREA_LABELS = {
  tributario:     'Direito Tributário',
  trabalhista:    'Direito Trabalhista',
  civel:          'Direito Civil',
  penal:          'Direito Penal',
  empresarial:    'Direito Empresarial/Financeiro',
  consumidor:     'Direito do Consumidor',
  familia:        'Direito de Família e Sucessões',
  previdenciario: 'Direito Previdenciário',
};

// ── 1. Classificador ───────────────────────────────────────────────────────
async function classifyCase(anamnesis) {
  const system = buildClassifierPrompt();
  const prompt = `Classifique este caso jurídico:\n\n${anamnesis.substring(0, 3000)}`;
  try {
    const raw = await analyze(system, [{ type: 'text', text: prompt }], { maxTokens: 300, timeoutMs: 30_000 });
    // Extrai JSON mesmo se houver texto ao redor
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON não encontrado');
    const parsed = JSON.parse(match[0]);
    return {
      areas: Array.isArray(parsed.areas) ? parsed.areas.slice(0, 3) : ['civel'],
      jurisdiction: parsed.jurisdicao || 'não informada',
      urgent: !!parsed.urgente,
      caseType: parsed.tipo || 'consulta jurídica',
    };
  } catch (e) {
    console.error('[classifier] falhou, usando fallback:', e.message);
    return { areas: ['civel'], jurisdiction: 'não informada', urgent: false, caseType: 'consulta' };
  }
}

// ── 2. Especialista individual ─────────────────────────────────────────────
async function runSpecialist(area, caseBlocks) {
  const system = buildSpecialistPrompt(area);
  const label = AREA_LABELS[area] || area;
  try {
    const text = await analyze(system, caseBlocks, { maxTokens: 2500, timeoutMs: 180_000 });
    console.error(`[specialist] ${area} concluído (${text.length} chars)`);
    return { area, label, text, ok: true };
  } catch (e) {
    console.error(`[specialist] ${area} falhou:`, e.message);
    return { area, label, text: `(análise indisponível: ${e.message})`, ok: false };
  }
}

// ── 3. CEO — síntese final ─────────────────────────────────────────────────
async function runCEO(classification, specialistResults, { clientName, anamnesis, config }) {
  const system = buildCEOPrompt(config);

  let content = `## DADOS DO CASO\n`;
  content += `Cliente: ${clientName || '(não informado)'}\n`;
  content += `Jurisdição: ${classification.jurisdiction}\n`;
  content += `Tipo: ${classification.caseType}\n`;
  content += `Urgente: ${classification.urgent ? 'SIM ⚠️' : 'Não'}\n\n`;
  content += `## RELATO ORIGINAL DO CASO\n${anamnesis}\n\n`;
  content += `## ANÁLISES DOS ESPECIALISTAS\n\n`;

  for (const r of specialistResults) {
    content += `### ${r.label}\n${r.text}\n\n`;
  }

  content += `---\nProduza agora o PARECER JURÍDICO FINAL conforme o formato obrigatório definido no seu papel.`;

  const text = await analyze(system, [{ type: 'text', text: content }], { maxTokens: 4096, timeoutMs: 300_000 });
  console.error(`[ceo] síntese concluída (${text.length} chars)`);
  return text;
}

// ── Ponto de entrada público ───────────────────────────────────────────────
export async function runLegalAnalysis({ clientName, anamnesis, media, config }) {
  const errors = [];

  // Baixa todos os arquivos uma única vez (PDF, imagens, etc.)
  const mediaBlocks = [];
  for (const m of media || []) {
    if (!m.url) { errors.push('arquivo sem URL (reenvie o documento)'); continue; }
    try {
      const block = await downloadMediaBlock(m.url, m.type === 'link');
      mediaBlocks.push(block);
      console.error(`[orchestrator] mídia baixada: type=${block.type}`);
    } catch (e) {
      errors.push(e.message);
      console.error('[orchestrator] mídia falhou:', m.url, e.message);
    }
  }

  // Bloco do caso para os especialistas (texto + documentos)
  const caseBlocks = [
    { type: 'text', text: `## CASO PARA ANÁLISE\n\n${anamnesis}` },
    ...mediaBlocks,
  ];

  // Passo 1: classificar áreas relevantes
  console.error(`[orchestrator] classificando caso...`);
  const classification = await classifyCase(anamnesis);
  console.error(`[orchestrator] áreas=${classification.areas.join(',')} jurisdição=${classification.jurisdiction} urgente=${classification.urgent}`);

  // Filtra áreas habilitadas na config
  const activeAreas = (config?.areas || []).filter(a => a.active).map(a => a.key);
  const selectedAreas = classification.areas.filter(a => activeAreas.includes(a));
  if (selectedAreas.length === 0) selectedAreas.push('civel'); // fallback

  // Passo 2: rodar especialistas em paralelo
  console.error(`[orchestrator] rodando ${selectedAreas.length} especialista(s) em paralelo...`);
  const specialistResults = await Promise.all(
    selectedAreas.map(area => runSpecialist(area, caseBlocks))
  );

  // Passo 3: CEO sintetiza tudo
  console.error(`[orchestrator] CEO sintetizando...`);
  const finalOpinion = await runCEO(classification, specialistResults, { clientName, anamnesis, config });

  return { finalOpinion, classification, specialistResults, errors };
}
