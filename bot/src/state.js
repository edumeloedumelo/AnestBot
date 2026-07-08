// Persiste a posição de leitura por grupo (estado mínimo para não reprocessar).
// Por padrão grava em state.json na raiz do bot.
// Para persistir entre redeploys no Railway: monte um volume em /data e defina
// a variável de ambiente STATE_DIR=/data no painel do Railway.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, '..');
const STATE_PATH = path.join(STATE_DIR, 'state.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch { /* already exists */ }
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2));
}

// Retorna o Unix timestamp (segundos) da última mensagem processada no grupo.
// Se nunca processou, retorna 0 (vai ler tudo disponível).
export function getLastTime(chatId) {
  return load()[chatId]?.lastTime ?? 0;
}

// Salva o timestamp da última mensagem que foi processada com sucesso.
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
