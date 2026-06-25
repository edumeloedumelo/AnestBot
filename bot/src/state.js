// Persiste a posição de leitura por grupo (estado mínimo para não reprocessar).
// Grava em state.json na raiz do bot.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '..', 'state.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data) {
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
