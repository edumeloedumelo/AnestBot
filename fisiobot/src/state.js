import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.STATE_DIR || '/data';
const STATE_PATH = path.join(STATE_DIR, 'state.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); }
  catch { return {}; }
}

function save(data) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { /* já existe */ }
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2));
}

export function getLastTime(chatId) { return load()[chatId]?.lastTime ?? 0; }

export function setLastTime(chatId, timestamp) {
  const data = load();
  data[chatId] = { lastTime: timestamp };
  save(data);
}

export function resetGroup(chatId) {
  const data = load();
  delete data[chatId];
  save(data);
}
