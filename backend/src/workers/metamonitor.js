// Meta-monitor: "quem vigia os workers". Cada worker grava heartbeat só quando
// termina um ciclo com sucesso (ver workers/index.js) — se um travar, o
// heartbeat para de avançar e aparece em /admin/overview (workersSemHeartbeat).
// Aqui só reforça isso em log; disparo de push/e-mail pro dono é um provedor
// externo (APNs/FCM/SES) que ainda não está plugado nesta Fase 1 — a visão fica
// disponível no painel enquanto isso.
import { staleWorkers } from '../events.js';

export async function checkWorkerHealth() {
  const stale = await staleWorkers(5);
  for (const w of stale) {
    console.warn(`[metamonitor] ALERTA: worker "${w.worker_name}" sem heartbeat desde ${w.last_ok_at} — último erro: ${w.last_error || 'nenhum registrado'}`);
  }
}
