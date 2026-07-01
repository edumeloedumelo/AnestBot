// Recebe o payload do webhook UltraMsg (uma instância por tenant, URL própria
// configurada como /webhook/:tenantId no painel de cada instância) e processa
// comandos + buffer de mídia/texto.
import { isCommand, handleCommand, bufferMessage } from './commands.js';
import { getTenantConnection } from './tenant.js';
import { getConfig } from './config.js';
import { claimWebhookEvent } from './idempotency.js';
import { runSerialized } from './sessions.js';

export async function handleWebhook(tenantId, payload) {
  if (!payload) return;

  // Aceita message_received (de outros) e message_create (do próprio número
  // conectado) — permite que a secretária/médica dispare /analisar do próprio
  // WhatsApp Business conectado.
  const et = payload.event_type;
  const isMsg = !et || et === 'message_received' || et === 'message_create' || et === 'message_created';
  if (!isMsg) return;

  const m = payload.data;
  if (!m || !m.id) return;

  // Dedupe: a UltraMsg pode reentregar o mesmo evento se a resposta demorar.
  const isNew = await claimWebhookEvent(m.id, 'ultramsg');
  if (!isNew) return;

  const conn = await getTenantConnection(tenantId);
  if (!conn) {
    console.warn(`[router] tenant desconhecido ou sem instância: ${tenantId}`);
    return;
  }
  if (conn.tenantStatus !== 'active') {
    console.log(`[router] ignorando mensagem — tenant ${tenantId} está '${conn.tenantStatus}', não 'active'`);
    return;
  }

  const chatId = m.from;
  const ctx = { tenantId, instanceId: conn.instanceId, token: conn.token, chatId };
  const body = (m.body || '').trim();

  // Cada webhook é uma requisição HTTP independente, processada sem esperar a
  // resposta — sem isso, duas mensagens do mesmo chat podem terminar de
  // processar fora de ordem (ex: /analisar rodando antes de uma imagem anterior
  // terminar de entrar no buffer). runSerialized garante ordem de chegada.
  await runSerialized(tenantId, chatId, async () => {
    if (m.type === 'chat' && isCommand(body)) {
      const config = await getConfig(tenantId);
      await handleCommand({ ...ctx, config }, body, m);
      return;
    }

    // Não é comando: entra no buffer da sessão pra quando /analisar rodar.
    bufferMessage(ctx, { id: m.id, type: m.type, body: m.body || '', media: m.media || null });
  });
}
