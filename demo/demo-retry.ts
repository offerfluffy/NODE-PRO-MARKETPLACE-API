import { EntityManager } from 'typeorm';
import dataSource from '../src/database/data-source.js';
import { RetryResult, withTransactionRetry } from './transaction-retry.js';

const CUSTOMER_EMAIL = 'customer.three@example.com';
const INITIAL_BALANCE_CENTS = 10_000;
const CREDIT_CENTS = 5_000;
const DEBIT_CENTS = -3_000;
const EXPECTED_BALANCE_CENTS =
  INITIAL_BALANCE_CENTS + CREDIT_CENTS + DEBIT_CENTS;

type BalanceRow = {
  balance_cents: number;
};

async function prepareRetryFixture(): Promise<string> {
  const [rows] = await dataSource.query<[{ id: string }[], number]>(
    `
      UPDATE users
      SET balance_cents = $2,
          updated_at = now()
      WHERE email = $1
        AND role = 'customer'
      RETURNING id
    `,
    [CUSTOMER_EMAIL, INITIAL_BALANCE_CENTS],
  );

  const customer = rows[0];

  if (!customer) {
    throw new Error('Retry-demo customer was not found');
  }

  return customer.id;
}

function createBarrier(participants: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;

  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;

    if (arrived === participants) {
      release();
    }

    await allArrived;
  };
}

async function changeBalance(
  manager: EntityManager,
  customerId: string,
  adjustmentCents: number,
  waitUntilBothHaveRead: () => Promise<void>,
): Promise<number> {
  const rows = await manager.query<BalanceRow[]>(
    `
      SELECT balance_cents
      FROM users
      WHERE id = $1
    `,
    [customerId],
  );

  const customer = rows[0];

  if (!customer) {
    throw new Error('Retry-demo customer disappeared');
  }

  await waitUntilBothHaveRead();

  const nextBalanceCents = customer.balance_cents + adjustmentCents;

  await manager.query(
    `
      UPDATE users
      SET balance_cents = $2,
          updated_at = now()
      WHERE id = $1
    `,
    [customerId, nextBalanceCents],
  );

  return nextBalanceCents;
}

async function readBalance(customerId: string): Promise<number> {
  const rows = await dataSource.query<BalanceRow[]>(
    `
      SELECT balance_cents
      FROM users
      WHERE id = $1
    `,
    [customerId],
  );

  const customer = rows[0];

  if (!customer) {
    throw new Error('Retry-demo customer was not found after the operations');
  }

  return customer.balance_cents;
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const customerId = await prepareRetryFixture();
    const waitUntilBothHaveRead = createBarrier(2);

    const [creditResult, debitResult] = await Promise.all([
      withTransactionRetry('credit', (manager) =>
        changeBalance(manager, customerId, CREDIT_CENTS, waitUntilBothHaveRead),
      ),
      withTransactionRetry('debit', (manager) =>
        changeBalance(manager, customerId, DEBIT_CENTS, waitUntilBothHaveRead),
      ),
    ]);

    const finalBalanceCents = await readBalance(customerId);
    const totalRetries = countRetries(creditResult, debitResult);

    console.log(`Initial balance: ${INITIAL_BALANCE_CENTS} cents`);
    console.log(`Credit: +${CREDIT_CENTS} cents`);
    console.log(`Debit: ${DEBIT_CENTS} cents`);
    console.log(`Retries: ${totalRetries}`);
    console.log(`Final balance: ${finalBalanceCents} cents`);
    console.log(`Expected balance: ${EXPECTED_BALANCE_CENTS} cents`);

    if (totalRetries < 1) {
      throw new Error('Expected at least one transaction retry');
    }

    if (finalBalanceCents !== EXPECTED_BALANCE_CENTS) {
      throw new Error(
        `Incorrect final balance: expected ${EXPECTED_BALANCE_CENTS}, ` +
          `received ${finalBalanceCents}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

function countRetries(...results: RetryResult<unknown>[]): number {
  return results.reduce((total, result) => total + result.retries, 0);
}

main().catch((error: unknown) => {
  console.error('Retry demo failed:', error);
  process.exitCode = 1;
});
