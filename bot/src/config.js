import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_PATH = path.join(__dirname, '..', 'config.json');
const STATE_DIR = process.env.STATE_DIR || '/data';
const PERSISTENT_PATH = path.join(STATE_DIR, 'config.json');

// On first run (or after volume wipe), copy bundled config to the volume so that
// runtime admin changes (addcirurgia, addlimite, setprompt) survive Railway redeploys.
function resolvePath() {
  if (fs.existsSync(PERSISTENT_PATH)) return PERSISTENT_PATH;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.copyFileSync(BUNDLED_PATH, PERSISTENT_PATH);
    console.error('[config] copied bundled config to persistent volume:', PERSISTENT_PATH);
  } catch (e) {
    console.error('[config] could not write to volume, using bundled config:', e.message);
    return BUNDLED_PATH;
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
