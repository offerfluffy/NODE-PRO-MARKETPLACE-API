import dataSource from '../data-source.js';

type ClaimedJobRow = {
  id: string;
};

type PendingCountRow = {
  count: number;
};

type WorkerStatsRow = {
  total: number;
  completed: number;
  processed_twice: number;
  processed_not_once: number;
  worker_count: number;
};

const JOB_COUNT = 12;
const WORKER_COUNT = 4;
const WORK_MS = 100;
const JOB_TYPE = 'worker_demo';

async function prepareWorkerJobs(): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await manager.query(
      `
        DELETE FROM jobs
        WHERE type = $1
      `,
      [JOB_TYPE],
    );

    await manager.query(
      `
        INSERT INTO jobs (type, payload)
        SELECT
          $1,
          jsonb_build_object('taskNumber', task_number)
        FROM generate_series(1, $2) AS task_number
      `,
      [JOB_TYPE, JOB_COUNT],
    );
  });
}

async function claimOne(workerName: string): Promise<boolean> {
  return dataSource.transaction(async (manager) => {
    const rows = await manager.query<ClaimedJobRow[]>(
      `
        SELECT id
        FROM jobs
        WHERE type = $1
          AND status = 'pending'
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [JOB_TYPE],
    );

    const job = rows[0];

    if (!job) {
      return false;
    }

    await sleep(WORK_MS);

    await manager.query(
      `
        UPDATE jobs
        SET status = 'done',
            worker = $1,
            processed = processed + 1,
            updated_at = now()
        WHERE id = $2
      `,
      [workerName, job.id],
    );

    return true;
  });
}

async function runWorker(workerName: string): Promise<number> {
  let processedByWorker = 0;

  for (;;) {
    const claimed = await claimOne(workerName);

    if (claimed) {
      processedByWorker += 1;
      continue;
    }

    const rows = await dataSource.query<PendingCountRow[]>(
      `
        SELECT count(*)::integer AS count
        FROM jobs
        WHERE type = $1
          AND status = 'pending'
      `,
      [JOB_TYPE],
    );

    const pending = rows[0];

    if (!pending) {
      throw new Error('Pending-job count was not returned');
    }

    if (pending.count === 0) {
      return processedByWorker;
    }

    await sleep(10);
  }
}

async function runWorkerPool(): Promise<number> {
  const workerNames = Array.from(
    { length: WORKER_COUNT },
    (_, index) => `worker-${index + 1}`,
  );

  const startedAt = Date.now();

  const processedCounts = await Promise.all(
    workerNames.map((workerName) => runWorker(workerName)),
  );

  const elapsedMs = Date.now() - startedAt;

  const distribution = workerNames
    .map((workerName, index) => `${workerName}=${processedCounts[index] ?? 0}`)
    .join(', ');

  console.log(`Distribution: ${distribution}`);
  console.log(`Elapsed time: ${elapsedMs} ms`);

  return elapsedMs;
}

async function verifyWorkerResults(elapsedMs: number): Promise<void> {
  const rows = await dataSource.query<WorkerStatsRow[]>(
    `
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (
          WHERE status = 'done'
        )::integer AS completed,
        count(*) FILTER (
          WHERE processed > 1
        )::integer AS processed_twice,
        count(*) FILTER (
          WHERE processed <> 1
        )::integer AS processed_not_once,
        count(DISTINCT worker)::integer AS worker_count
      FROM jobs
      WHERE type = $1
    `,
    [JOB_TYPE],
  );

  const stats = rows[0];

  if (!stats) {
    throw new Error('Worker statistics were not returned');
  }

  const sequentialMs = JOB_COUNT * WORK_MS;

  console.log(`Completed: ${stats.completed}/${stats.total}`);
  console.log(`Оброблено двічі: ${stats.processed_twice}`);
  console.log(`Workers used: ${stats.worker_count}`);
  console.log(`Sequential baseline: ${sequentialMs} ms`);

  if (
    stats.total !== JOB_COUNT ||
    stats.completed !== JOB_COUNT ||
    stats.processed_not_once !== 0 ||
    stats.worker_count < 2 ||
    elapsedMs >= sequentialMs
  ) {
    throw new Error('Worker-pool invariant failed');
  }
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    await prepareWorkerJobs();
    const elapsedMs = await runWorkerPool();
    await verifyWorkerResults(elapsedMs);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch((error: unknown) => {
  console.error('Worker demo failed:', error);
  process.exitCode = 1;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
