import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

type DemoQueueData = {
  kind: 'flaky' | 'scheduled';
};

const WORKER_TIMEOUT_MS = 5_000;
const SCHEDULER_INTERVAL_MS = 250;
const DEMO_SCHEDULER_ID = 'demo-reconciliation-scheduler';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  const redisUrl = requiredEnv('REDIS_QUEUE_URL');
  const queueName = `demo-order-post-processing-${randomUUID()}`;
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
  });
  const workerConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue<DemoQueueData>(queueName, { connection });
  let worker: Worker<DemoQueueData> | undefined;

  try {
    const config = (await connection.config(
      'GET',
      'maxmemory-policy',
    )) as unknown as string[];
    const queueNoEviction = config[1] === 'noeviction';

    if (!queueNoEviction) {
      throw new Error(`Expected noeviction, received ${config[1] ?? 'none'}`);
    }

    const jobId = 'demo-stable-job';
    const jobOptions = {
      jobId,
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 100,
        jitter: 0.5,
      },
      removeOnComplete: {
        age: 60,
      },
    };

    await queue.add('flaky', { kind: 'flaky' }, jobOptions);
    await queue.add('flaky', { kind: 'flaky' }, jobOptions);

    const counts = await queue.getJobCounts('wait', 'delayed', 'prioritized');
    const queued = counts.wait + counts.delayed + counts.prioritized;

    if (queued !== 1) {
      throw new Error(`Expected one deduplicated job, received ${queued}`);
    }

    let attempts = 0;
    let completed = 0;
    let scheduledRuns = 0;
    let workerError: Error | undefined;

    worker = new Worker<DemoQueueData>(
      queueName,
      async (job) => {
        if (job.data.kind === 'scheduled') {
          scheduledRuns += 1;
          return;
        }

        attempts += 1;

        if (attempts < 3) {
          throw new Error(`Intentional demo failure ${attempts}`);
        }

        completed += 1;
      },
      {
        connection: workerConnection,
      },
    );

    worker.on('error', (error: Error) => {
      workerError = error;
    });

    const deadline = Date.now() + WORKER_TIMEOUT_MS;

    while (completed < 1 && !workerError && Date.now() < deadline) {
      await delay(50);
    }

    if (workerError) {
      throw workerError;
    }

    if (attempts < 3 || completed !== 1) {
      throw new Error(
        `Expected three attempts and one completion, received attempts=${attempts} completed=${completed}`,
      );
    }

    const schedulerTemplate = {
      name: 'scheduled-reconciliation',
      data: { kind: 'scheduled' as const },
      opts: {
        removeOnComplete: {
          age: 60,
        },
      },
    };

    await queue.upsertJobScheduler(
      DEMO_SCHEDULER_ID,
      { every: SCHEDULER_INTERVAL_MS },
      schedulerTemplate,
    );
    await queue.upsertJobScheduler(
      DEMO_SCHEDULER_ID,
      { every: SCHEDULER_INTERVAL_MS },
      schedulerTemplate,
    );

    const schedulers = await queue.getJobSchedulers();
    const schedulerDeadline = Date.now() + WORKER_TIMEOUT_MS;

    while (
      scheduledRuns < 2 &&
      !workerError &&
      Date.now() < schedulerDeadline
    ) {
      await delay(50);
    }

    if (workerError) {
      throw workerError;
    }

    if (schedulers.length !== 1 || scheduledRuns < 2) {
      throw new Error(
        `Expected one scheduler and at least two runs, received schedulers=${schedulers.length} scheduled-runs=${scheduledRuns}`,
      );
    }

    console.log(`queue-noeviction=${queueNoEviction ? 1 : 0}`);
    console.log(`attempts=${attempts}`);
    console.log(`completed=${completed}`);
    console.log('added=2');
    console.log(`queued=${queued}`);
    console.log(`schedulers=${schedulers.length}`);
    console.log(`scheduled-runs=${scheduledRuns}`);
  } finally {
    await queue.removeJobScheduler(DEMO_SCHEDULER_ID).catch(() => undefined);
    await worker?.close().catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
    await workerConnection.quit().catch(() => undefined);
    await connection.quit().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
