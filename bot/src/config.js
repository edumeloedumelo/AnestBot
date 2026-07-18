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
    if (changed) fs.writeFileSync(PERSISTENT_PATH, JSON.stringify(persisted, null, 2));
  } catch (e) {
    console.error('[config] merge falhou, usando volume existente:', e.message);
  }
  return PERSISTENT_PATH;
}

const CONFIG_PATH = resolvePath();

let cache = null;

export function getConfig() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    cache.surgeries ||= [];
    cache.examLimits ||= [];
    cache.extraPrompt ||= '';
  }
  return cache;
}

export function saveConfig(cfg) {
  cache = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function updateConfig(mutator) {
  const cfg = getConfig();
  mutator(cfg);
  saveConfig(cfg);
  return cfg;
}
