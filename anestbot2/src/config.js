// Config editável (cirurgias, limites de exame, prompt extra). O config.json do
// repositório é o "molde"; na 1ª execução é copiado para /data e, a cada boot,
// novas cirurgias/limites do molde são mescladas sem apagar edições de runtime.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED = path.join(__dirname, '..', 'config.json');
const STATE_DIR = process.env.STATE_DIR || '/data';
const PERSIST = path.join(STATE_DIR, 'config.json');

function atomicWrite(target, obj) {
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, target);
}

function resolvePath() {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { /* ok */ }
  if (!fs.existsSync(PERSIST)) {
    try { fs.copyFileSync(BUNDLED, PERSIST); return PERSIST; }
    catch (e) { console.error('[config] sem volume, usando molde:', e.message); return BUNDLED; }
  }
  try {
    const b = JSON.parse(fs.readFileSync(BUNDLED, 'utf-8'));
    const p = JSON.parse(fs.readFileSync(PERSIST, 'utf-8'));
    let changed = false;
    for (const s of (b.surgeries || [])) {
      if (!p.surgeries?.find((e) => e.key === s.key)) { (p.surgeries ||= []).push(s); changed = true; }
    }
    for (const l of (b.examLimits || [])) {
      if (!p.examLimits?.find((e) => e.exam_name === l.exam_name)) { (p.examLimits ||= []).push(l); changed = true; }
    }
    if (changed) atomicWrite(PERSIST, p);
  } catch (e) { console.error('[config] merge falhou:', e.message); }
  return PERSIST;
}

const CONFIG_PATH = resolvePath();
let cache = null;

function readSafe() {
  for (const p of [CONFIG_PATH, BUNDLED]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
    catch (e) { console.error(`[config] falha lendo ${p}:`, e.message); }
  }
  return {};
}

export function getConfig() {
  if (!cache) {
    cache = readSafe();
    cache.surgeries ||= [];
    cache.examLimits ||= [];
    cache.extraPrompt ||= '';
  }
  return cache;
}

export function saveConfig(cfg) {
  cache = cfg;
  try { atomicWrite(CONFIG_PATH, cfg); }
  catch (e) { console.error('[config] falha ao salvar:', e.message); }
}

export function updateConfig(mutator) {
  const cfg = getConfig();
  mutator(cfg);
  saveConfig(cfg);
  return cfg;
}
