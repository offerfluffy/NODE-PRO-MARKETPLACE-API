import dataSource from '../data-source.js';
import { seedDatabase } from './seed-database.js';

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    const counts = await seedDatabase(dataSource);

    console.table(counts);
    console.log('Seed completed successfully');
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
