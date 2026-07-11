import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

let cache = null;

export function getConfig() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    cache.areas ||= [];
    cache.maxSpecialists ||= 3;
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
