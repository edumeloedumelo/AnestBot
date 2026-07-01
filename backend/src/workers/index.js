// Inicia os 5 workers de reconciliação como loops independentes. Cada um só
// grava heartbeat de sucesso quando termina o ciclo sem lançar — é isso que
// permite o meta-monitor (e o painel do dono) detectar um worker travado.
import { reconcilePayments } from './payment.js';
import { reconcileProvisioning } from './provisioning.js';
import { reconcileConnections } from './connection.js';
import { reconcileExecutionFailures } from './execution.js';
import { checkWorkerHealth } from './metamonitor.js';
import { beatHeartbeat, recordWorkerError } from '../events.js';

const WORKERS = [
  { name: 'payment', run: reconcilePayments, intervalMs: 60_000 },
  { name: 'provisioning', run: reconcileProvisioning, intervalMs: 60_000 },
  { name: 'connection', run: reconcileConnections, intervalMs: 120_000 },
  { name: 'execution', run: reconcileExecutionFailures, intervalMs: 60_000 },
  { name: 'metamonitor', run: checkWorkerHealth, intervalMs: 60_000 },
];

async function tick(worker) {
  try {
    await worker.run();
    await beatHeartbeat(worker.name);
  } catch (e) {
    console.error(`[worker:${worker.name}] ciclo falhou:`, e.message);
    await recordWorkerError(worker.name, e.message).catch(() => {});
  }
}

export function startWorkers() {
  for (const worker of WORKERS) {
    tick(worker); // roda uma vez imediatamente, não espera o primeiro intervalo
    setInterval(() => tick(worker), worker.intervalMs).unref?.();
  }
  console.log(`⚙️  ${WORKERS.length} workers de reconciliação iniciados.`);
}
