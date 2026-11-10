/**
 * @file cluster.ts
 * @description Multi-process cluster coordination for scaling across multi-core CPUs.
 */

import cluster from 'node:cluster';
import os from 'node:os';

export interface ClusterInfo {
  isPrimary: boolean;
  isWorker: boolean;
  workerId?: number;
  workersCount: number;
}

/**
 * Resolves cluster status and determines if the current execution is primary or worker.
 *
 * @param configuredWorkers - Number of configured workers (1 for single process, >1 for multi-core cluster).
 * @returns Resolved cluster metadata.
 */
export function getClusterInfo(configuredWorkers: number): ClusterInfo {
  // If running under Bun, Bun's cluster support is experimental; default to single-process
  const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);
  if (isBun) {
    return {
      isPrimary: true,
      isWorker: false,
      workersCount: 1
    };
  }

  const workersCount = Math.max(1, configuredWorkers);
  const isPrimary = Boolean(cluster.isPrimary || (cluster as any).isMaster);
  const isWorker = Boolean(cluster.isWorker);
  const workerId = cluster.worker?.id;

  return {
    isPrimary,
    isWorker,
    workerId,
    workersCount
  };
}

/**
 * Spawns worker processes across CPU cores and monitors their health.
 *
 * @param count - Number of workers to spawn.
 */
export function forkClusterWorkers(count: number): void {
  const cpuCount = typeof os.cpus === 'function' ? os.cpus().length : 1;
  console.log(`[Cluster] Spawning ${count} worker processes across ${cpuCount} available CPU core(s)...`);

  for (let i = 0; i < count; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    if (!worker.exitedAfterDisconnect) {
      console.warn(`[Cluster] Worker #${worker.id} exited (code: ${code}, signal: ${signal}). Respawning...`);
      cluster.fork();
    }
  });
}

/**
 * Gracefully disconnects all active cluster worker processes.
 */
export function shutdownClusterWorkers(): Promise<void> {
  return new Promise((resolve) => {
    if (!cluster.workers) {
      resolve();
      return;
    }

    const workerList = Object.values(cluster.workers).filter(Boolean);
    if (workerList.length === 0) {
      resolve();
      return;
    }

    let remaining = workerList.length;
    const timeout = setTimeout(() => {
      // Force kill remaining workers if graceful disconnect timed out
      for (const w of workerList) {
        try { w?.kill('SIGKILL'); } catch {}
      }
      resolve();
    }, 3000);

    for (const w of workerList) {
      if (!w) {
        remaining--;
        continue;
      }
      w.once('disconnect', () => {
        remaining--;
        if (remaining <= 0) {
          clearTimeout(timeout);
          resolve();
        }
      });
      try {
        w.disconnect();
      } catch {
        remaining--;
        if (remaining <= 0) {
          clearTimeout(timeout);
          resolve();
        }
      }
    }
  });
}
