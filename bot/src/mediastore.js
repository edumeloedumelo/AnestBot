// Armazena URLs de mídia recebidas via webhook de forma persistente.
// O GET /chats/messages da UltraMsg não retorna URLs de mídia — precisamos
// guardar o que chega no webhook (com "Webhook Download Media: ON").
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Grava em /data por padrão (sobrescrito por STATE_DIR se definido).
// Para persistência total entre redeploys: monte um volume Railway em /data.
const STATE_DIR = process.env.STATE_DIR || '/data';
const STORE_PATH = path.join(STATE_DIR, 'media-store.json');

let store = {};

function load() {
  try { store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')); }
  catch { store = {}; }
}

function save() {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { /* já existe */ }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store));
}

load();

export function saveMedia(msgId, item) {
  store[msgId] = { ...item, savedAt: Date.now() };
  save();
}

export function loadMedia(msgId) {
  return store[msgId] || null;
}

// Remove entradas com mais de 14 dias
export function cleanupOld() {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, item] of Object.entries(store)) {
    if (item.savedAt && item.savedAt < cutoff) { delete store[id]; changed = true; }
  }
  if (changed) save();
}

// Limpeza a cada hora
setInterval(cleanupOld, 60 * 60 * 1000).unref?.();
