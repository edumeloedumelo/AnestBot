import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_PATH = path.join(__dirname, '..', 'config.json');
const STATE_DIR = process.env.STATE_DIR || '/data';
const PERSISTENT_PATH = path.join(STATE_DIR, 'config.json');

// On first run: copy bundled config to volume.
// On subsequent runs: merge any NEW surgery keys and exam limits from bundled config
// into the persisted config so deploys with new entries take effect automatically
// without wiping runtime admin changes (setprompt, addlimite etc.).
function resolvePath() {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { /* já existe */ }

  if (!fs.existsSync(PERSISTENT_PATH)) {
    try {
      fs.copyFileSync(BUNDLED_PATH, PERSISTENT_PATH);
      console.error('[config] first run: bundled config copied to', PERSISTENT_PATH);
    } catch (e) {
      console.error('[config] could not write to volume, using bundled config:', e.message);
      return BUNDLED_PATH;
    }
    return PERSISTENT_PATH;
  }

  // Merge new surgery keys and exam limits from bundled config (preserves runtime changes).
  try {
    const bundled = JSON.parse(fs.readFileSync(BUNDLED_PATH, 'utf-8'));
    const persisted = JSON.parse(fs.readFileSync(PERSISTENT_PATH, 'utf-8'));
    let changed = false;
    for (const s of (bundled.surgeries || [])) {
      if (!persisted.surgeries?.find((e) => e.key === s.key)) {
        (persisted.surgeries = persisted.surgeries || []).push(s);
        changed = true;
        console.error('[config] nova cirurgia adicionada ao volume:', s.key);
      }
    }
    for (const l of (bundled.examLimits || [])) {
      if (!persisted.examLimits?.find((e) => e.exam_name === l.exam_name)) {
        (persisted.examLimits = persisted.examLimits || []).push(l);
        changed = true;
        console.error('[config] novo limite adicionado ao volume:', l.exam_name);
      }
    }
    if (changed) atomicWrite(PERSISTENT_PATH, persisted);
  } catch (e) {
    console.error('[config] merge falhou, usando volume existente:', e.message);
  }
  return PERSISTENT_PATH;
}

// Escrita ATÔMICA: grava em .tmp e renomeia. Evita config.json truncado se o
// processo for morto no meio de um deploy (o que corromperia todas as leituras).
function atomicWrite(target, obj) {
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, target);
}

const CONFIG_PATH = resolvePath();

function readConfigSafe() {
  // Tenta o caminho persistente; se corrompido, cai para o bundled (nunca lança).
  for (const p of [CONFIG_PATH, BUNDLED_PATH]) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (p !== CONFIG_PATH) console.error('[config] config persistido corrompido — usando bundled como fallback');
      return c;
    } catch (e) {
      console.error(`[config] falha ao ler ${p}:`, e.message);
    }
  }
  console.error('[config] nenhum config legível — usando estrutura vazia');
  return {};
}

let cache = null;

export function getConfig() {
  if (!cache) {
    cache = readConfigSafe();
    cache.surgeries ||= [];
    cache.examLimits ||= [];
    cache.extraPrompt ||= '';
  }
  return cache;
}

export function saveConfig(cfg) {
  cache = cfg;
  try {
    atomicWrite(CONFIG_PATH, cfg);
  } catch (e) {
    console.error('[config] falha ao salvar (mantido em memória):', e.message);
  }
}

export function updateConfig(mutator) {
  const cfg = getConfig();
  mutator(cfg);
  saveConfig(cfg);
  return cfg;
}
